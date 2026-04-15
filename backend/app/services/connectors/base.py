import asyncio
import logging
from abc import ABC, abstractmethod

from app.core.exceptions import PromptGuardBlockError
from app.models.connector import Connector
from app.services.connectors.event_bus import ConnectorEventBus
from app.services.conversation_service import ConversationService

logger = logging.getLogger(__name__)


class BaseConnector(ABC):
    """Abstract base class for all messaging service connectors.

    Subclasses implement the transport layer (IRC, Discord, Telegram, etc.)
    while this base provides the common lifecycle and message pipeline that
    routes through the unified ConversationService.
    """

    def __init__(
        self,
        connector: Connector,
        conversation_service: ConversationService,
        event_bus: ConnectorEventBus,
    ):
        self.config = connector
        self.conversation_service = conversation_service
        self.event_bus = event_bus
        self._running = False
        self._task: asyncio.Task | None = None

    @property
    def connector_id(self) -> str:
        return self.config.id  # type: ignore[return-value]

    @abstractmethod
    async def connect(self) -> None:
        """Establish the connection to the external service."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Cleanly disconnect from the external service."""

    @abstractmethod
    async def send_to_external(self, target: str, content: str) -> None:
        """Send a message to the external service (channel or user)."""

    @abstractmethod
    async def _run(self) -> None:
        """Main event loop. Called as an asyncio task."""

    @abstractmethod
    async def get_health(self) -> dict:
        """Return health/status info (uptime, latency, channels, etc.)."""

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run(), name=f"connector-{self.connector_id}")
        logger.info("Connector %s started", self.config.name)

    async def stop(self) -> None:
        self._running = False
        await self.disconnect()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("Connector %s stopped", self.config.name)

    @property
    def is_running(self) -> bool:
        return self._running and self._task is not None and not self._task.done()

    async def handle_incoming_message(
        self,
        sender: str,
        target: str,
        content: str,
        is_private: bool,
        raw: str | None = None,
    ) -> str | None:
        """Common inbound message handler.

        Applies rules, routes through ConversationService, returns the LLM
        response text (or None if taken over / filtered).
        """
        rules = self.config.rules

        # Ignore list
        if sender.lower() in [n.lower() for n in rules.ignore_nicks]:
            return None

        # Allowlist (empty = allow all)
        if rules.allowed_nicks and sender.lower() not in [n.lower() for n in rules.allowed_nicks]:
            return None

        # Build external_id: per-channel for channels, per-nick for PMs
        source = self.config.connector_type
        if is_private:
            external_id = f"{sender}@{source}"
            channel = None
        else:
            external_id = f"{target}@{source}"
            channel = target

        # Publish inbound event for monitoring
        await self.event_bus.publish(self.connector_id, "message_received", {
            "sender": sender,
            "target": target,
            "content": content,
            "is_private": is_private,
            "external_id": external_id,
        })

        # Route through the unified conversation pipeline
        try:
            result = await self.conversation_service.send_connector_message(
                connector_id=self.connector_id,
                external_id=external_id,
                content=content,
                sender_name=sender,
                agent_id=self.config.agent_id,
                user_id=self.config.owner_user_id,
                channel=channel,
                source=source,
            )
        except PromptGuardBlockError:
            # Message was blocked by prompt injection guard — stay silent
            await self.event_bus.publish(self.connector_id, "message_blocked", {
                "sender": sender, "target": target, "reason": "prompt_guard",
            })
            return None

        # If taken over, no LLM response — the human will send manually
        if result["model_used"] is None:
            return None

        response_text = result["message"].content

        # Truncate if needed
        if rules.max_response_length and len(response_text) > rules.max_response_length:
            response_text = response_text[:rules.max_response_length] + "..."

        # Publish outbound event for monitoring
        await self.event_bus.publish(self.connector_id, "message_sent", {
            "target": target if not is_private else sender,
            "content": response_text,
            "model_used": result["model_used"],
            "external_id": external_id,
        })

        return response_text
