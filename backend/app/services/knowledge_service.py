"""Knowledge base service — ingestion (chunking + titling) and retrieval."""

import logging
import re

import httpx
import litellm

from app.models.knowledge_base import KnowledgeBase, KnowledgeItem
from app.repositories.knowledge_repo import KnowledgeRepository
from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)

# Rough token estimate: 1 token ≈ 4 chars
TARGET_CHUNK_CHARS = 3200  # ~800 tokens
MAX_CHUNK_CHARS = 4800     # ~1200 tokens
DEEP_MAX_LINKS = 10        # Max related URLs to follow in deep research


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
    def __init__(self, knowledge_repo: KnowledgeRepository, llm_service: LLMService):
        self.repo = knowledge_repo
        self.llm_service = llm_service
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
    ) -> int:
        """Chunk content and store as knowledge items with batch tracking."""
        model = await self._resolve_ingest_model(kb_id)
        chunks = self._chunk_text(content)

        if limits and limits.at_item_limit:
            logger.warning("Ingest item limit reached (%d), skipping", limits.max_items)
            return 0
        if limits:
            chunks = chunks[:limits.items_remaining]

        # Create a batch for rollback tracking
        batch_id = await self.repo.create_batch(kb_id, source)

        items = []
        for i, chunk in enumerate(chunks):
            self._update_status(
                f"Generating title for chunk {i + 1}/{len(chunks)}",
                source=source,
            )
            title = await self._generate_title(chunk, model)
            items.append(KnowledgeItem(
                knowledge_base_id=kb_id,
                batch_id=batch_id,
                title=title,
                content=chunk,
                source=source,
                chunk_index=i,
            ))

        count = await self.repo.add_items_bulk(items)
        await self.repo.update_batch_count(batch_id, count)
        await self.repo.update_item_count(kb_id)

        if limits:
            limits.items_created += count

        return count

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
        from urllib.parse import urljoin
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

    async def _generate_title(self, chunk: str, model: str | None = None) -> str:
        """Use the LLM to generate a brief title for a documentation chunk."""
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
            return title[:200]
        except Exception:
            first_line = chunk.split("\n")[0].strip()
            return first_line[:100] or "Untitled chunk"

    def _chunk_text(self, text: str) -> list[str]:
        """Split text into chunks by paragraphs, merging small ones."""
        blocks = re.split(r"\n\s*\n|\n(?=#{1,3}\s)", text.strip())
        blocks = [b.strip() for b in blocks if b.strip()]

        chunks = []
        current = ""

        for block in blocks:
            if len(current) + len(block) + 2 <= TARGET_CHUNK_CHARS:
                current = f"{current}\n\n{block}" if current else block
            else:
                if current:
                    chunks.append(current)
                if len(block) > MAX_CHUNK_CHARS:
                    chunks.extend(self._split_large_block(block))
                    current = ""
                else:
                    current = block

        if current:
            chunks.append(current)

        return chunks

    def _split_large_block(self, block: str) -> list[str]:
        """Split an oversized block at sentence boundaries."""
        sentences = re.split(r"(?<=[.!?])\s+", block)
        chunks = []
        current = ""

        for sentence in sentences:
            if len(current) + len(sentence) + 1 <= TARGET_CHUNK_CHARS:
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
