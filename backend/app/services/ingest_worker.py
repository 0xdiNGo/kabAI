"""Persistent background worker that processes the ingest queue.

Runs as a long-lived asyncio task. Polls MongoDB for pending queue items,
generates titles via LLM, creates KnowledgeItems, and updates counts.
Crash-safe: only one chunk is in-flight at a time.
"""

import asyncio
import logging

import litellm

from app.models.knowledge_base import KnowledgeItem
from app.repositories.ingest_queue_repo import IngestQueueRepository
from app.repositories.knowledge_repo import KnowledgeRepository

logger = logging.getLogger(__name__)

POLL_INTERVAL = 2  # seconds between polls when idle
CONCURRENT_WORKERS = 3  # process multiple chunks at once
STALE_CHECK_INTERVAL = 30  # seconds between stale item checks
STALE_TIMEOUT = 120  # seconds before a processing item is considered stuck


class IngestWorker:
    def __init__(
        self,
        queue_repo: IngestQueueRepository,
        knowledge_repo: KnowledgeRepository,
        llm_service,  # LLMService — avoid circular import
    ):
        self.queue_repo = queue_repo
        self.knowledge_repo = knowledge_repo
        self.llm_service = llm_service
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the worker loop."""
        if self._running:
            return
        self._running = True

        # Reset any items stuck from a previous crash/restart
        reset = await self.queue_repo.reset_stale_processing()
        if reset:
            logger.warning("Startup: reset %d stale processing items back to pending", reset)

        # Log queue state
        status = await self.queue_repo.get_global_queue_status()
        logger.info("Queue state on startup: %s", status)

        self._task = asyncio.create_task(self._run())
        logger.info("Ingest worker started (concurrency=%d)", CONCURRENT_WORKERS)

    async def stop(self) -> None:
        """Stop the worker loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        logger.info("Ingest worker stopped")

    async def _run(self) -> None:
        """Main loop with concurrent processing and stale item recovery."""
        sem = asyncio.Semaphore(CONCURRENT_WORKERS)
        stale_check_counter = 0

        while self._running:
            try:
                # Periodically reset stale items
                stale_check_counter += 1
                if stale_check_counter >= STALE_CHECK_INTERVAL // POLL_INTERVAL:
                    stale_check_counter = 0
                    reset = await self.queue_repo.reset_stale_processing()
                    if reset:
                        print(f"[worker] auto-reset {reset} stale processing items", flush=True)

                item = await self.queue_repo.claim_next_pending()
                if item:
                    await sem.acquire()
                    asyncio.create_task(self._process_with_semaphore(item, sem))
                else:
                    await asyncio.sleep(POLL_INTERVAL)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Ingest worker loop error")
                await asyncio.sleep(POLL_INTERVAL)

    async def _process_with_semaphore(self, item, sem: asyncio.Semaphore) -> None:
        try:
            # Timeout per item: 60s for scripted, 120s for AI titles
            timeout = STALE_TIMEOUT if item.ai_titles else 60
            await asyncio.wait_for(self._process_item(item), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("Item %s timed out after %ds, marking failed", item.id, STALE_TIMEOUT)
            await self.queue_repo.mark_failed(item.id, "Processing timed out")
        except Exception:
            logger.exception("Unexpected error processing item %s", item.id)
            await self.queue_repo.mark_failed(item.id, "Unexpected processing error")
        finally:
            sem.release()

    @staticmethod
    def _scripted_title(content: str) -> str:
        """Extract a title from content without LLM — instant and free."""
        # Try first non-empty line
        for line in content.split("\n"):
            line = line.strip().lstrip("#").strip()
            if len(line) > 10:
                # Truncate at sentence boundary if possible
                for end in (".", ":", " - ", " — "):
                    idx = line.find(end)
                    if 10 < idx < 100:
                        return line[:idx + len(end)].strip()
                return line[:100].strip()
        return content[:80].strip() or "Untitled"

    async def _process_item(self, item) -> None:
        """Process one queue item — scripted title by default, LLM if ai_titles=True."""
        try:
            tokens = 0
            print(f"[worker] processing item {item.id} chunk={item.chunk_index} ai={item.ai_titles}", flush=True)

            if item.ai_titles:
                # LLM title generation
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
            else:
                # Scripted title — instant, no LLM call
                title = self._scripted_title(item.content)

            # Persist KnowledgeItem immediately
            ki = KnowledgeItem(
                knowledge_base_id=item.kb_id,
                batch_id=item.batch_id,
                title=title,
                content=item.content,
                source=item.source,
                chunk_index=item.chunk_index,
            )
            await self.knowledge_repo.add_item(ki)
            print(f"[worker] saved item {item.id}, marking done", flush=True)

            # Mark queue item done
            await self.queue_repo.mark_done(item.id, title, tokens)

            # Update counts
            await self.knowledge_repo.update_item_count(item.kb_id)

            # Auto-cleanup: check if this job is complete and purge done items
            progress = await self.queue_repo.get_job_progress(item.job_id)
            if progress["pending"] == 0 and progress["processing"] == 0:
                purged = await self.queue_repo.purge_done_for_job(item.job_id)
                if purged:
                    print(f"[worker] job {item.job_id} complete, purged {purged} queue items", flush=True)
            print(f"[worker] completed item {item.id}", flush=True)

        except Exception as e:
            print(f"[worker] ERROR processing {item.id}: {e}", flush=True)
            try:
                await self.queue_repo.mark_failed(item.id, str(e))
            except Exception as e2:
                print(f"[worker] ERROR marking failed {item.id}: {e2}", flush=True)

    async def _resolve_model(self, kb_id: str) -> str:
        """Resolve the ingest model for a KB."""
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
