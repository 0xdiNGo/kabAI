"""Background task manager for persistent chat processing.

Decouples LLM streaming from SSE connections so chats continue
processing even when the user navigates away.
"""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator, Coroutine
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Sentinel value pushed to the queue when the task completes
TASK_DONE = None


@dataclass
class ChatTask:
    task: asyncio.Task
    queue: asyncio.Queue[str | None]
    conversation_id: str
    user_id: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # Buffer of recent events for clients that reconnect after some events were already sent
    recent_events: list[str] = field(default_factory=list)
    max_buffer: int = 200


class BackgroundTaskManager:
    def __init__(self):
        self._tasks: dict[str, ChatTask] = {}

    def get_status(self, conversation_id: str) -> str:
        """Check if a conversation has an active background task."""
        chat_task = self._tasks.get(conversation_id)
        if chat_task and not chat_task.task.done():
            return "processing"
        return "idle"

    async def start_chat_with_queue(
        self,
        conversation_id: str,
        user_id: str,
        coro: Coroutine,
        queue: asyncio.Queue[str | None],
        max_background: int = 5,
    ) -> ChatTask:
        """Start a background task with a pre-created queue. Cancels any existing task."""
        await self.kill(conversation_id)

        task = asyncio.create_task(
            self._run_with_queue(coro, queue, conversation_id)
        )
        chat_task = ChatTask(
            task=task,
            queue=queue,
            conversation_id=conversation_id,
            user_id=user_id,
        )
        self._tasks[conversation_id] = chat_task

        await self._enforce_limit(max_background)

        return chat_task

    async def _run_with_queue(
        self,
        coro: Coroutine,
        queue: asyncio.Queue[str | None],
        conversation_id: str,
    ) -> None:
        """Wrapper that runs the coroutine and pushes sentinel when done."""
        try:
            await coro
        except asyncio.CancelledError:
            # Push a cancelled event so any reader knows
            try:
                queue.put_nowait(
                    json.dumps({"type": "error", "detail": "Chat processing was stopped"})
                )
            except asyncio.QueueFull:
                pass
            raise
        except Exception as e:
            logger.exception("Background chat task failed for %s", conversation_id)
            try:
                queue.put_nowait(
                    json.dumps({"type": "error", "detail": str(e)})
                )
            except asyncio.QueueFull:
                pass
        finally:
            # Signal completion
            try:
                queue.put_nowait(TASK_DONE)
            except asyncio.QueueFull:
                pass

    async def read_events(self, conversation_id: str) -> AsyncGenerator[str, None]:
        """Read events from a background task's queue. Yields until task completes."""
        chat_task = self._tasks.get(conversation_id)
        if not chat_task:
            return

        # Replay recent buffered events for reconnecting clients
        for event in chat_task.recent_events:
            yield event

        # If task already done and queue is empty, nothing more to yield
        if chat_task.task.done() and chat_task.queue.empty():
            return

        # Read new events from the queue
        while True:
            try:
                event = await asyncio.wait_for(chat_task.queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send keepalive
                yield json.dumps({"type": "keepalive"})
                continue

            if event is TASK_DONE:
                # Clean up completed task
                self._tasks.pop(conversation_id, None)
                return

            # Buffer for reconnection
            if len(chat_task.recent_events) >= chat_task.max_buffer:
                chat_task.recent_events.pop(0)
            chat_task.recent_events.append(event)

            yield event

    async def kill(self, conversation_id: str) -> None:
        """Cancel a background task and clean up."""
        chat_task = self._tasks.pop(conversation_id, None)
        if chat_task and not chat_task.task.done():
            chat_task.task.cancel()
            try:
                await chat_task.task
            except (asyncio.CancelledError, Exception):
                pass

    async def _enforce_limit(self, max_background: int) -> None:
        """Kill oldest tasks if over the limit."""
        active = {
            cid: ct for cid, ct in self._tasks.items() if not ct.task.done()
        }
        if len(active) <= max_background:
            return

        # Sort by creation time, kill oldest
        sorted_tasks = sorted(active.items(), key=lambda x: x[1].created_at)
        to_kill = len(active) - max_background
        for cid, _ in sorted_tasks[:to_kill]:
            logger.info("Killing background chat %s (over limit of %d)", cid, max_background)
            await self.kill(cid)

    def active_count(self) -> int:
        """Count of currently processing tasks."""
        return sum(1 for ct in self._tasks.values() if not ct.task.done())

    async def shutdown(self) -> None:
        """Cancel all background tasks. Called on app shutdown."""
        for cid in list(self._tasks.keys()):
            await self.kill(cid)
