"""Background ingest task manager with detailed status tracking and limits."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class IngestStatus:
    kb_id: str
    state: str = "running"  # running | completed | failed | cancelled
    items_created: int = 0
    urls_processed: int = 0
    chunks_total: int = 0
    chunks_completed: int = 0
    tokens_used: int = 0
    current_step: str = "Starting..."
    steps_log: list[str] = field(default_factory=list)
    error: str | None = None
    result: dict = field(default_factory=dict)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None

    @property
    def elapsed_seconds(self) -> float:
        end = self.completed_at or datetime.now(timezone.utc)
        return (end - self.started_at).total_seconds()

    @property
    def estimated_remaining_seconds(self) -> float | None:
        if self.chunks_completed <= 0 or self.chunks_total <= 0:
            return None
        per_chunk = self.elapsed_seconds / self.chunks_completed
        remaining = self.chunks_total - self.chunks_completed
        return per_chunk * remaining

    @property
    def tokens_per_chunk(self) -> float:
        if self.chunks_completed <= 0:
            return 0
        return self.tokens_used / self.chunks_completed

    @property
    def estimated_remaining_tokens(self) -> int | None:
        if self.chunks_completed <= 0 or self.chunks_total <= 0:
            return None
        remaining = self.chunks_total - self.chunks_completed
        return int(self.tokens_per_chunk * remaining)


class IngestManager:
    """Manages background ingestion tasks with status tracking."""

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._status: dict[str, IngestStatus] = {}

    def get_status(self, kb_id: str) -> IngestStatus | None:
        return self._status.get(kb_id)

    async def start_ingest(self, kb_id: str, coro) -> IngestStatus:
        await self.cancel(kb_id)

        status = IngestStatus(kb_id=kb_id)
        self._status[kb_id] = status

        task = asyncio.create_task(self._run(kb_id, coro, status))
        self._tasks[kb_id] = task
        return status

    async def _run(self, kb_id: str, coro, status: IngestStatus):
        try:
            result = await coro
            status.state = "completed"
            status.result = result if isinstance(result, dict) else {"items_created": result}
            status.items_created = status.result.get("items_created", 0)
        except asyncio.CancelledError:
            status.state = "cancelled"
            status.error = "Ingestion cancelled by user"
        except Exception as e:
            status.state = "failed"
            status.error = str(e)
            logger.exception("Ingest task failed for KB %s", kb_id)
        finally:
            status.completed_at = datetime.now(timezone.utc)
            self._tasks.pop(kb_id, None)

    async def cancel(self, kb_id: str):
        task = self._tasks.pop(kb_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def shutdown(self):
        for kb_id in list(self._tasks.keys()):
            await self.cancel(kb_id)
