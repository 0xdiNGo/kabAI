import asyncio
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class ConnectorEventBus:
    """In-process pub/sub for connector events.

    Pushes live updates to SSE clients monitoring connector conversations.
    Each subscriber gets an asyncio.Queue keyed by connector_id.
    """

    def __init__(self):
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, connector_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subscribers.setdefault(connector_id, []).append(queue)
        return queue

    def unsubscribe(self, connector_id: str, queue: asyncio.Queue):
        subs = self._subscribers.get(connector_id, [])
        if queue in subs:
            subs.remove(queue)
        if not subs:
            self._subscribers.pop(connector_id, None)

    async def publish(self, connector_id: str, event_type: str, data: dict):
        """Publish an event to all subscribers for a connector."""
        event = {
            "type": event_type,
            "connector_id": connector_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **data,
        }
        payload = json.dumps(event)
        for queue in self._subscribers.get(connector_id, []):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop oldest event to make room
                try:
                    queue.get_nowait()
                    queue.put_nowait(payload)
                except asyncio.QueueEmpty:
                    pass
