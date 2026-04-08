"""Persistent background worker that processes the ingest queue.

Runs as a long-lived asyncio task. Claims batches of pending items from
MongoDB, generates titles (scripted or AI), bulk-inserts KnowledgeItems,
and updates counts periodically (not per-item).
"""

import asyncio
import logging
import re
from datetime import datetime, timezone


from app.models.knowledge_base import KnowledgeItem
from app.repositories.ingest_queue_repo import IngestQueueRepository
from app.repositories.knowledge_repo import KnowledgeRepository

logger = logging.getLogger(__name__)

POLL_INTERVAL = 1  # seconds between polls when idle
BATCH_SIZE = 50  # process this many items per cycle
STALE_CHECK_INTERVAL = 30
STALE_TIMEOUT = 120
COUNT_UPDATE_INTERVAL = 50  # update KB item count every N items
JOB_CHECK_INTERVAL = 100  # check job completion every N items

DIGEST_PROMPT = (
    "You are a data analyst. Summarize the following content into a structured digest. "
    "Include: key topics discussed, participants/entities mentioned, notable patterns or trends, "
    "sentiment/tone, and any significant events or decisions. "
    "Be comprehensive but concise. Use bullet points for clarity.\n\n"
    "Content:\n{content}"
)


class IngestWorker:
    def __init__(
        self,
        queue_repo: IngestQueueRepository,
        knowledge_repo: KnowledgeRepository,
        llm_service,
        vector_service=None,
    ):
        self.queue_repo = queue_repo
        self.knowledge_repo = knowledge_repo
        self.llm_service = llm_service
        self.vector_service = vector_service
        self._running = False
        self._task: asyncio.Task | None = None
        self._items_since_count_update: dict[str, int] = {}  # kb_id → count
        self._items_since_job_check: dict[str, int] = {}  # job_id → count

    async def start(self) -> None:
        if self._running:
            return
        self._running = True

        reset = await self.queue_repo.reset_stale_processing()
        if reset:
            print(f"[worker] startup: reset {reset} stale items", flush=True)

        status = await self.queue_repo.get_global_queue_status()
        print(f"[worker] queue on startup: {status}", flush=True)

        self._task = asyncio.create_task(self._run())
        print(f"[worker] started (batch_size={BATCH_SIZE})", flush=True)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        # Final count updates
        await self._flush_counts()
        print("[worker] stopped", flush=True)

    async def _run(self) -> None:
        """Main loop — claims batches of items and processes them."""
        stale_counter = 0

        while self._running:
            try:
                stale_counter += 1
                if stale_counter >= STALE_CHECK_INTERVAL:
                    stale_counter = 0
                    reset = await self.queue_repo.reset_stale_processing()
                    if reset:
                        print(f"[worker] auto-reset {reset} stale items", flush=True)

                # Claim a batch of pending items
                items = await self.queue_repo.claim_batch(BATCH_SIZE)

                if items:
                    await self._process_scripted_batch(items)
                else:
                    await asyncio.sleep(POLL_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Ingest worker loop error")
                await asyncio.sleep(POLL_INTERVAL)

    async def _process_scripted_batch(self, items: list) -> None:
        """Process a batch of items with scripted titles — bulk insert."""
        knowledge_items = []
        for item in items:
            title = self._scripted_title(item.content)
            source_timestamp = self._extract_timestamp(item.content, item.source)
            knowledge_items.append(KnowledgeItem(
                knowledge_base_id=item.kb_id,
                batch_id=item.batch_id,
                title=title,
                content=item.content,
                source=item.source,
                chunk_index=item.chunk_index,
                source_timestamp=source_timestamp,
            ))

        # Bulk insert all KnowledgeItems at once
        inserted_ids = []
        if knowledge_items:
            inserted_ids = await self.knowledge_repo.add_items_bulk(knowledge_items)

        # Generate embeddings and upsert to vector DB
        if inserted_ids and self.vector_service:
            await self._embed_and_upsert(knowledge_items, inserted_ids)

        # Bulk mark queue items as done
        await self.queue_repo.mark_done_bulk([item.id for item in items])

        # Track counts for periodic updates
        for item in items:
            self._items_since_count_update[item.kb_id] = \
                self._items_since_count_update.get(item.kb_id, 0) + 1
            self._items_since_job_check[item.job_id] = \
                self._items_since_job_check.get(item.job_id, 0) + 1

        # Periodic count updates
        await self._maybe_update_counts()
        await self._maybe_check_jobs()

    async def _maybe_update_counts(self) -> None:
        """Update KB item counts periodically, not per-item."""
        for kb_id, count in list(self._items_since_count_update.items()):
            if count >= COUNT_UPDATE_INTERVAL:
                await self.knowledge_repo.update_item_count(kb_id)
                self._items_since_count_update[kb_id] = 0

    async def _maybe_check_jobs(self) -> None:
        """Check job completion and auto-purge periodically."""
        for job_id, count in list(self._items_since_job_check.items()):
            if count >= JOB_CHECK_INTERVAL:
                progress = await self.queue_repo.get_job_progress(job_id)
                if progress["pending"] == 0 and progress["processing"] == 0:
                    # Generate digest for completed source before purging queue items
                    job_doc = await self.queue_repo.collection.find_one({"job_id": job_id})
                    if job_doc:
                        source = job_doc.get("source")
                        batch_id_val = job_doc.get("batch_id")
                        kb_id_val = job_doc.get("kb_id")
                        if source and kb_id_val:
                            await self._generate_source_digest(kb_id_val, source, batch_id_val or "")

                    purged = await self.queue_repo.purge_done_for_job(job_id)
                    if purged:
                        print(f"[worker] job {job_id} complete, purged {purged} items", flush=True)
                    del self._items_since_job_check[job_id]
                else:
                    self._items_since_job_check[job_id] = 0

    async def _flush_counts(self) -> None:
        """Flush all pending count updates (called on shutdown)."""
        for kb_id in list(self._items_since_count_update.keys()):
            try:
                await self.knowledge_repo.update_item_count(kb_id)
            except Exception:
                pass
        self._items_since_count_update.clear()

        for job_id in list(self._items_since_job_check.keys()):
            try:
                progress = await self.queue_repo.get_job_progress(job_id)
                if progress["pending"] == 0 and progress["processing"] == 0:
                    await self.queue_repo.purge_done_for_job(job_id)
            except Exception:
                pass
        self._items_since_job_check.clear()

    @staticmethod
    def _extract_timestamp(content: str, source: str | None = None) -> datetime | None:
        """Extract the earliest recognizable timestamp from content or source.

        Tries ISO 8601 first (most precise), then common log/date formats.
        Pure CPU — no LLM call. Returns None if nothing parseable is found.
        """
        ISO_RE = re.compile(
            r"\b(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
            r"(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:?\d{2})?)?)"
        )

        candidates: list[str] = []
        if source:
            m = ISO_RE.search(source)
            if m:
                candidates.append(m.group(1))

        sample = content[:2000]
        for m in ISO_RE.finditer(sample):
            candidates.append(m.group(1))
            if len(candidates) >= 5:
                break

        for raw in candidates:
            try:
                raw = raw.replace(" ", "T")
                if "T" not in raw:
                    raw += "T00:00:00"
                if re.match(r".*T\d{2}:\d{2}$", raw):
                    raw += ":00"
                raw_parsed = raw.replace("Z", "+00:00")
                dt = datetime.fromisoformat(raw_parsed)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if 1970 <= dt.year <= 2100:
                    return dt
            except ValueError:
                continue

        return None

    @staticmethod
    def _scripted_title(content: str) -> str:
        """Extract a title from content without LLM — instant and free."""
        for line in content.split("\n"):
            line = line.strip().lstrip("#").strip()
            if len(line) > 10:
                for end in (".", ":", " - ", " — "):
                    idx = line.find(end)
                    if 10 < idx < 100:
                        return line[:idx + len(end)].strip()
                return line[:100].strip()
        return content[:80].strip() or "Untitled"

    async def _generate_source_digest(self, kb_id: str, source: str, batch_id: str) -> None:
        """Generate a digest summary for all chunks from a single source document."""
        try:
            # Get all chunks for this source
            chunks = await self.knowledge_repo.find_items_by_source(kb_id, source)
            if not chunks or len(chunks) < 2:
                return  # Don't digest single-chunk sources

            # Combine chunk content (cap at ~50k chars to stay within context limits)
            combined = ""
            for chunk in chunks:
                combined += chunk.content + "\n\n"
                if len(combined) > 50000:
                    combined = combined[:50000] + "\n\n[... truncated ...]"
                    break

            # Resolve model — use system default
            model = await self.llm_service.resolve_model(None, None, task_type="digest")

            # Generate digest via LLM
            prompt = DIGEST_PROMPT.format(content=combined)
            messages = [{"role": "user", "content": prompt}]

            digest_content = await self.llm_service.complete_simple(model, messages, temperature=0.3, max_tokens=2048)
            if not digest_content:
                return

            # Build title for the digest
            source_label = source or "unknown"
            if len(source_label) > 60:
                source_label = "..." + source_label[-57:]
            title = f"[Digest] {source_label}"

            # Extract timestamp from source chunks (use earliest)
            timestamps = [c.source_timestamp for c in chunks if c.source_timestamp]
            earliest_ts = min(timestamps) if timestamps else None

            # Store as a KnowledgeItem with item_type="digest"
            digest_item = KnowledgeItem(
                knowledge_base_id=kb_id,
                batch_id=batch_id,
                title=title,
                content=digest_content,
                source=source,
                chunk_index=0,
                item_type="digest",
                digest_scope="source",
                source_timestamp=earliest_ts,
            )
            inserted_ids = await self.knowledge_repo.add_items_bulk([digest_item])

            # Embed the digest in Qdrant too
            if inserted_ids and self.vector_service:
                await self._embed_and_upsert([digest_item], inserted_ids)

            # Update item count
            await self.knowledge_repo.update_item_count(kb_id)
            logger.info("Generated source digest for %s in KB %s", source, kb_id)

        except Exception as e:
            logger.warning("Failed to generate digest for source %s in KB %s: %s", source, kb_id, e)

    async def _embed_and_upsert(
        self, knowledge_items: list, item_ids: list[str]
    ) -> None:
        """Generate embeddings and upsert to vector DB. Failures are logged, not raised."""
        try:
            texts = [ki.content for ki in knowledge_items]
            embeddings = await self.vector_service.generate_embeddings_batch(texts)

            vector_items = []
            for ki, item_id, emb in zip(knowledge_items, item_ids, embeddings):
                if emb:
                    entry: dict = {
                        "id": item_id,
                        "vector": emb,
                        "kb_id": ki.knowledge_base_id,
                        "title": ki.title,
                    }
                    if ki.source_timestamp is not None:
                        entry["source_timestamp"] = ki.source_timestamp.timestamp()
                    vector_items.append(entry)

            if vector_items:
                await self.vector_service.upsert_items(vector_items)
        except Exception as e:
            logger.warning("Vector embedding/upsert failed (non-fatal): %s", e)
