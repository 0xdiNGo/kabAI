"""Knowledge base service — ingestion (chunking + titling) and retrieval."""

import asyncio
import logging
import re
from urllib.parse import urljoin

import httpx
import litellm

from app.models.knowledge_base import KnowledgeBase, KnowledgeItem
from app.repositories.knowledge_repo import KnowledgeRepository
from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)

# Chunk size presets (chars): name → (target, max)
CHUNK_PRESETS = {
    "small": (1600, 2400),    # ~400 tokens — more granular retrieval
    "medium": (3200, 4800),   # ~800 tokens — default balance
    "large": (6400, 9600),    # ~1600 tokens — fewer LLM calls, faster ingest
    "xlarge": (12800, 19200), # ~3200 tokens — very fast, coarse chunks
}
DEFAULT_CHUNK_SIZE = "medium"
CONCURRENT_TITLES = 5  # Max concurrent LLM calls for title generation
DEEP_MAX_LINKS = 10


class IngestLimits:
    """Tracks usage against limits during an ingest operation."""
    def __init__(self, max_items: int = 200, max_urls: int = 10):
        self.max_items = max_items
        self.max_urls = max_urls
        self.items_created = 0
        self.urls_processed = 0

    @property
    def items_remaining(self) -> int:
        return max(0, self.max_items - self.items_created)

    @property
    def urls_remaining(self) -> int:
        return max(0, self.max_urls - self.urls_processed)

    @property
    def at_item_limit(self) -> bool:
        return self.items_created >= self.max_items

    @property
    def at_url_limit(self) -> bool:
        return self.urls_processed >= self.max_urls


class KnowledgeService:
    def __init__(self, knowledge_repo: KnowledgeRepository, llm_service: LLMService, queue_repo=None):
        self.repo = knowledge_repo
        self.llm_service = llm_service
        self._queue_repo = queue_repo
        # Status callback set by the API layer for background ingests
        self._status_callback = None

    def _update_status(self, msg: str, **kwargs):
        if self._status_callback:
            self._status_callback(msg, **kwargs)

    async def _resolve_ingest_model(self, kb_id: str) -> str:
        """Resolve the ingest model: KB override → system ingest default → system default."""
        # 1. KB-specific override
        kb = await self.repo.find_base_by_id(kb_id)
        if kb and kb.ingest_model:
            try:
                enabled = await self.llm_service._get_enabled_provider_types()
                if await self.llm_service._is_model_available(kb.ingest_model, enabled):
                    return kb.ingest_model
            except Exception:
                pass

        # 2. System ingest default
        settings = await self.llm_service.settings_repo.get()
        if settings.default_ingest_model:
            try:
                enabled = await self.llm_service._get_enabled_provider_types()
                if await self.llm_service._is_model_available(settings.default_ingest_model, enabled):
                    return settings.default_ingest_model
            except Exception:
                pass

        # 3. System default model
        return await self.llm_service.resolve_model(None)

    # --- Ingestion ---

    async def ingest(
        self, kb_id: str, content: str, source: str | None = None,
        limits: IngestLimits | None = None,
        chunk_size: str = DEFAULT_CHUNK_SIZE,
        ai_titles: bool = False,
    ) -> dict:
        """Chunk content and enqueue for persistent background processing.

        Returns dict with job_id, batch_id, and chunk count.
        The ingest worker handles title generation and item creation.
        """
        from app.models.ingest_queue import IngestQueueItem
        from uuid import uuid4

        content = self._preprocess_content(content, source)
        target, max_sz = CHUNK_PRESETS.get(chunk_size, CHUNK_PRESETS[DEFAULT_CHUNK_SIZE])
        chunks = self._chunk_text(content, target, max_sz)

        if limits and limits.at_item_limit:
            logger.warning("Ingest item limit reached (%d), skipping", limits.max_items)
            return {"job_id": None, "chunks_enqueued": 0}
        if limits:
            chunks = chunks[:limits.items_remaining]

        # Create batch and job
        batch_id = await self.repo.create_batch(kb_id, source)
        job_id = str(uuid4())

        # Enqueue all chunks to persistent queue
        queue_items = [
            IngestQueueItem(
                kb_id=kb_id,
                batch_id=batch_id,
                job_id=job_id,
                content=chunk,
                source=source,
                chunk_index=i,
                ai_titles=ai_titles,
            )
            for i, chunk in enumerate(chunks)
        ]

        count = 0
        if self._queue_repo:
            count = await self._queue_repo.enqueue_bulk(queue_items)

        self._update_status(
            f"Enqueued {count} chunks for processing",
            chunks_total=count,
        )

        if limits:
            limits.items_created += count

        return {
            "job_id": job_id,
            "batch_id": batch_id,
            "chunks_enqueued": count,
            "source": source,
        }

    async def ingest_url(
        self, kb_id: str, url: str, deep: bool = False,
        limits: IngestLimits | None = None,
    ) -> dict:
        """Fetch a URL, extract text content, and ingest it.

        Returns dict with items_created and metadata.
        IETF RFC URLs get special handling regardless of deep mode.
        When deep=True for generic URLs, follows related links.
        """
        if limits is None:
            # Load limits from settings
            settings = await self.llm_service.settings_repo.get()
            limits = IngestLimits(
                max_items=settings.ingest_max_items,
                max_urls=settings.ingest_max_urls,
            )

        from app.services.rfc_ingestor import extract_rfc_number, ingest_rfc_lineage, is_ietf_url

        # IETF RFCs always get full lineage treatment
        if is_ietf_url(url):
            rfc_num = extract_rfc_number(url)
            self._update_status(f"Fetching RFC {rfc_num} lineage from IETF")
            result = await ingest_rfc_lineage(
                rfc_num, kb_id,
                lambda kid, content, source=None: self.ingest(kid, content, source, limits),
                self.llm_service,
            )
            return {
                "items_created": result.total_items,
                "source": url,
                "rfc": rfc_num,
                "rfcs_ingested": result.rfcs_ingested,
                "lineage_summary": result.lineage_summary,
                "deep": True,
                "limits": {"items_used": limits.items_created, "max_items": limits.max_items},
            }

        # Generic URL ingestion
        self._update_status(f"Fetching {url}")
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
        limits.urls_processed += 1

        content_type = response.headers.get("content-type", "")
        raw_html = response.text
        body = self._strip_html(raw_html) if "html" in content_type else raw_html

        self._update_status(f"Chunking and titling content from {url}")
        total = await self.ingest(kb_id, body, source=url, limits=limits)
        urls_followed: list[str] = []

        # Deep research: extract and follow related links
        if deep and "html" in content_type and not limits.at_item_limit:
            self._update_status("Analyzing page for related links")
            related = await self._find_related_urls(raw_html, url, kb_id)
            for related_url in related:
                if limits.at_item_limit or limits.at_url_limit:
                    logger.info("Ingest limits reached, stopping deep research")
                    break
                try:
                    self._update_status(f"Deep: fetching {related_url}")
                    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                        resp = await client.get(related_url)
                        resp.raise_for_status()
                    limits.urls_processed += 1
                    ct = resp.headers.get("content-type", "")
                    text = self._strip_html(resp.text) if "html" in ct else resp.text
                    count = await self.ingest(kb_id, text, source=related_url, limits=limits)
                    total += count
                    urls_followed.append(related_url)
                except Exception as e:
                    logger.warning("Deep research: failed to fetch %s: %s", related_url, e)

        return {
            "items_created": total,
            "source": url,
            "deep": deep,
            "urls_followed": urls_followed,
            "limits": {"items_used": limits.items_created, "max_items": limits.max_items},
        }

    async def _find_related_urls(
        self, html: str, source_url: str, kb_id: str
    ) -> list[str]:
        """Use the LLM to identify documentation-relevant links from an HTML page."""
        # Extract all links from the HTML
        links = re.findall(r'href=["\']([^"\']+)["\']', html)

        # Resolve relative URLs
        absolute_links = []
        seen = set()
        for link in links:
            full = urljoin(source_url, link)
            # Filter to same domain and common doc patterns
            if full.startswith("http") and full not in seen and full != source_url:
                seen.add(full)
                absolute_links.append(full)

        if not absolute_links:
            return []

        # Ask the LLM to pick the most relevant documentation links
        try:
            model = await self._resolve_ingest_model(kb_id)
            kwargs = await self.llm_service._get_model_kwargs(model)

            # Truncate link list to fit context
            link_list = "\n".join(absolute_links[:100])

            response = await litellm.acompletion(
                model=model,
                messages=[{
                    "role": "user",
                    "content": (
                        f"I'm building a knowledge base from {source_url}.\n"
                        f"Below are links found on that page. Select up to {DEEP_MAX_LINKS} "
                        f"links that point to related documentation, specifications, guides, "
                        f"or technical references that would enhance understanding of the topic.\n\n"
                        f"Exclude: navigation links, login pages, social media, images, "
                        f"stylesheets, JavaScript files, and non-documentation pages.\n\n"
                        f"Return ONLY the selected URLs, one per line, no numbering or explanation.\n\n"
                        f"Links:\n{link_list}"
                    ),
                }],
                temperature=0.2,
                max_tokens=1024,
                **kwargs,
            )

            selected = response.choices[0].message.content.strip().split("\n")
            return [
                u.strip() for u in selected
                if u.strip().startswith("http") and u.strip() in seen
            ]
        except Exception as e:
            logger.warning("Deep research link selection failed: %s", e)
            return []

    def _preprocess_content(self, content: str, source: str | None = None) -> str:
        """Preprocess content based on detected format."""
        ext = (source or "").rsplit(".", 1)[-1].lower() if source else ""

        # Reject binary content
        if "\x00" in content[:1000]:
            raise ValueError(
                f"Binary file detected ({source}). Only text-based files are supported. "
                "For PDFs, convert to text first."
            )

        # HTML files
        if ext in ("html", "htm") or (content.lstrip().startswith("<") and "<html" in content[:500].lower()):
            return self._strip_html(content)

        # JSON — extract string values
        if ext == "json" or (content.lstrip().startswith(("{", "["))):
            try:
                import json
                data = json.loads(content)
                return self._extract_json_text(data)
            except (json.JSONDecodeError, ValueError):
                pass  # Not valid JSON, treat as plain text

        # XML — strip tags
        if ext == "xml" or (content.lstrip().startswith("<?xml") or content.lstrip().startswith("</")):
            return re.sub(r"<[^>]+>", " ", content).strip()

        # CSV/TSV — convert to readable lines
        if ext in ("csv", "tsv"):
            return self._csv_to_text(content, ext)

        # YAML — pass through as-is (already human-readable)
        # Log files — pass through as-is
        # Code files — pass through as-is
        # Everything else — pass through as-is
        return content

    def _extract_json_text(self, data, depth: int = 0) -> str:
        """Recursively extract string values from JSON structures."""
        if depth > 10:
            return ""
        parts = []
        if isinstance(data, str):
            if len(data) > 20:  # Skip short keys/IDs
                parts.append(data)
        elif isinstance(data, dict):
            for k, v in data.items():
                extracted = self._extract_json_text(v, depth + 1)
                if extracted:
                    parts.append(f"{k}: {extracted}")
        elif isinstance(data, list):
            for item in data:
                extracted = self._extract_json_text(item, depth + 1)
                if extracted:
                    parts.append(extracted)
        return "\n".join(parts)

    def _csv_to_text(self, content: str, ext: str) -> str:
        """Convert CSV/TSV to readable text."""
        import csv
        import io
        delimiter = "\t" if ext == "tsv" else ","
        reader = csv.reader(io.StringIO(content), delimiter=delimiter)
        rows = list(reader)
        if not rows:
            return content
        # Use first row as headers if it looks like headers
        headers = rows[0] if rows else []
        lines = []
        for row in rows[1:]:
            parts = []
            for i, val in enumerate(row):
                if val.strip():
                    header = headers[i] if i < len(headers) else f"col{i}"
                    parts.append(f"{header}: {val.strip()}")
            if parts:
                lines.append("; ".join(parts))
        return "\n".join(lines) if lines else content

    def _strip_html(self, html: str) -> str:
        """Extract readable text from HTML, stripping tags, scripts, styles."""
        html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<nav[^>]*>.*?</nav>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<header[^>]*>.*?</header>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<footer[^>]*>.*?</footer>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<(br|p|div|h[1-6]|li|tr)[^>]*>", "\n", html, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", "", html)
        text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n", "\n\n", text)
        return text.strip()

    async def _generate_title_with_tokens(
        self, chunk: str, model: str | None = None
    ) -> tuple[str, int]:
        """Generate a title and return (title, tokens_used)."""
        try:
            if not model:
                model = await self.llm_service.resolve_model(None)
            kwargs = await self.llm_service._get_model_kwargs(model)
            response = await litellm.acompletion(
                model=model,
                messages=[{
                    "role": "user",
                    "content": (
                        "Generate a brief title (under 10 words) for this documentation chunk. "
                        "Return ONLY the title, no quotes or extra text.\n\n"
                        f"{chunk[:2000]}"
                    ),
                }],
                temperature=0.2,
                max_tokens=30,
                **kwargs,
            )
            title = response.choices[0].message.content.strip().strip('"\'')
            tokens = response.usage.total_tokens if response.usage else 0
            return title[:200], tokens
        except Exception:
            first_line = chunk.split("\n")[0].strip()
            return first_line[:100] or "Untitled chunk", 0

    async def _generate_title(self, chunk: str, model: str | None = None) -> str:
        """Convenience wrapper."""
        title, _ = await self._generate_title_with_tokens(chunk, model)
        return title

    def _chunk_text(
        self, text: str,
        target_chars: int | None = None,
        max_chars: int | None = None,
    ) -> list[str]:
        """Split text into chunks by paragraphs, merging small ones."""
        t = target_chars or CHUNK_PRESETS[DEFAULT_CHUNK_SIZE][0]
        m = max_chars or CHUNK_PRESETS[DEFAULT_CHUNK_SIZE][1]
        blocks = re.split(r"\n\s*\n|\n(?=#{1,3}\s)", text.strip())
        blocks = [b.strip() for b in blocks if b.strip()]

        chunks = []
        current = ""

        for block in blocks:
            if len(current) + len(block) + 2 <= t:
                current = f"{current}\n\n{block}" if current else block
            else:
                if current:
                    chunks.append(current)
                if len(block) > m:
                    chunks.extend(self._split_large_block(block, t))
                    current = ""
                else:
                    current = block

        if current:
            chunks.append(current)

        return chunks

    def _split_large_block(self, block: str, target: int | None = None) -> list[str]:
        """Split an oversized block at sentence boundaries."""
        target = target or CHUNK_PRESETS[DEFAULT_CHUNK_SIZE][0]
        sentences = re.split(r"(?<=[.!?])\s+", block)
        chunks = []
        current = ""

        for sentence in sentences:
            if len(current) + len(sentence) + 1 <= target:
                current = f"{current} {sentence}" if current else sentence
            else:
                if current:
                    chunks.append(current)
                current = sentence

        if current:
            chunks.append(current)
        return chunks

    # --- Retrieval ---

    async def retrieve(
        self, query: str, kb_ids: list[str], limit: int = 5
    ) -> list[KnowledgeItem]:
        """Retrieve the most relevant knowledge items for a query."""
        return await self.repo.search(query, kb_ids, limit)
