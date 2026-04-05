"""Background ingest task manager with status tracking and limits."""

import asyncio
import json
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
    current_step: str = "Starting..."
    error: str | None = None
    result: dict = field(default_factory=dict)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None


class IngestManager:
    """Manages background ingestion tasks with status tracking."""

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}  # keyed by kb_id
        self._status: dict[str, IngestStatus] = {}

    def get_status(self, kb_id: str) -> IngestStatus | None:
        return self._status.get(kb_id)

    async def start_ingest(self, kb_id: str, coro) -> IngestStatus:
        """Start a background ingest task. Cancels any existing task for this KB."""
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
            status.error = "Ingestion cancelled"
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
