"""Persistent background worker that processes the ingest queue.

Runs as a long-lived asyncio task. Claims batches of pending items from
MongoDB, generates titles (scripted or AI), bulk-inserts KnowledgeItems,
and updates counts periodically (not per-item).
"""

import asyncio
import logging

import litellm

from app.models.knowledge_base import KnowledgeItem
from app.repositories.ingest_queue_repo import IngestQueueRepository
from app.repositories.knowledge_repo import KnowledgeRepository

logger = logging.getLogger(__name__)

POLL_INTERVAL = 1  # seconds between polls when idle
BATCH_SIZE = 50  # process this many items per cycle
CONCURRENT_AI_WORKERS = 5  # for AI title generation
STALE_CHECK_INTERVAL = 30
STALE_TIMEOUT = 120
COUNT_UPDATE_INTERVAL = 50  # update KB item count every N items
JOB_CHECK_INTERVAL = 100  # check job completion every N items


class IngestWorker:
    def __init__(
        self,
        queue_repo: IngestQueueRepository,
        knowledge_repo: KnowledgeRepository,
        llm_service,
    ):
        self.queue_repo = queue_repo
        self.knowledge_repo = knowledge_repo
        self.llm_service = llm_service
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
                    # Separate scripted vs AI title items
                    scripted = [i for i in items if not i.ai_titles]
                    ai = [i for i in items if i.ai_titles]

                    # Process scripted titles in bulk (instant)
                    if scripted:
                        await self._process_scripted_batch(scripted)

                    # Process AI titles with concurrency
                    if ai:
                        await self._process_ai_batch(ai)
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
            knowledge_items.append(KnowledgeItem(
                knowledge_base_id=item.kb_id,
                batch_id=item.batch_id,
                title=title,
                content=item.content,
                source=item.source,
                chunk_index=item.chunk_index,
            ))

        # Bulk insert all KnowledgeItems at once
        if knowledge_items:
            await self.knowledge_repo.add_items_bulk(knowledge_items)

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

    async def _process_ai_batch(self, items: list) -> None:
        """Process items needing AI titles with bounded concurrency."""
        sem = asyncio.Semaphore(CONCURRENT_AI_WORKERS)

        async def process_one(item):
            async with sem:
                try:
                    await asyncio.wait_for(self._process_ai_item(item), timeout=STALE_TIMEOUT)
                except asyncio.TimeoutError:
                    await self.queue_repo.mark_failed(item.id, "AI title generation timed out")
                except Exception as e:
                    await self.queue_repo.mark_failed(item.id, str(e))

        await asyncio.gather(*[process_one(i) for i in items])

        for item in items:
            self._items_since_count_update[item.kb_id] = \
                self._items_since_count_update.get(item.kb_id, 0) + 1
            self._items_since_job_check[item.job_id] = \
                self._items_since_job_check.get(item.job_id, 0) + 1

        await self._maybe_update_counts()
        await self._maybe_check_jobs()

    async def _process_ai_item(self, item) -> None:
        """Generate AI title for a single item."""
        model = await self._resolve_model(item.kb_id)
        kwargs = await self.llm_service._get_model_kwargs(model)
        response = await litellm.acompletion(
            model=model,
            messages=[{
                "role": "user",
                "content": (
                    "Generate a brief title (under 10 words) for this documentation chunk. "
                    "Return ONLY the title, no quotes or extra text.\n\n"
                    f"{item.content[:2000]}"
                ),
            }],
            temperature=0.2,
            max_tokens=30,
            **kwargs,
        )
        title = response.choices[0].message.content.strip().strip('"\'')[:200]
        tokens = response.usage.total_tokens if response.usage else 0

        ki = KnowledgeItem(
            knowledge_base_id=item.kb_id,
            batch_id=item.batch_id,
            title=title,
            content=item.content,
            source=item.source,
            chunk_index=item.chunk_index,
        )
        await self.knowledge_repo.add_item(ki)
        await self.queue_repo.mark_done(item.id, title, tokens)

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

    async def _resolve_model(self, kb_id: str) -> str:
        kb = await self.knowledge_repo.find_base_by_id(kb_id)
        if kb and kb.ingest_model:
            try:
                enabled = await self.llm_service._get_enabled_provider_types()
                if await self.llm_service._is_model_available(kb.ingest_model, enabled):
                    return kb.ingest_model
            except Exception:
                pass
        settings = await self.llm_service.settings_repo.get()
        if settings.default_ingest_model:
            try:
                enabled = await self.llm_service._get_enabled_provider_types()
                if await self.llm_service._is_model_available(settings.default_ingest_model, enabled):
                    return settings.default_ingest_model
            except Exception:
                pass
        return await self.llm_service.resolve_model(None)
