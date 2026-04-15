import asyncio
import logging

from app.models.connector import Connector
from app.repositories.connector_repo import ConnectorRepository
from app.services.connectors.base import BaseConnector
from app.services.connectors.event_bus import ConnectorEventBus
from app.services.conversation_service import ConversationService

logger = logging.getLogger(__name__)


class ConnectorManager:
    """Manages the lifecycle of all active connectors.

    Stored on app.state.connector_manager. Handles start/stop/restart
    and a watchdog loop that restarts crashed connectors.
    """

    def __init__(
        self,
        connector_repo: ConnectorRepository,
        conversation_service: ConversationService,
        event_bus: ConnectorEventBus,
    ):
        self.connector_repo = connector_repo
        self.conversation_service = conversation_service
        self.event_bus = event_bus
        self._connectors: dict[str, BaseConnector] = {}
        self._watchdog_task: asyncio.Task | None = None

    def _create_instance(self, connector: Connector) -> BaseConnector:
        """Instantiate the correct connector subclass based on type."""
        if connector.connector_type == "irc":
            from app.services.connectors.irc import IRCConnector
            return IRCConnector(connector, self.conversation_service, self.event_bus)
        raise ValueError(f"Unknown connector type: {connector.connector_type}")

    async def start_connector(self, connector_id: str) -> None:
        if connector_id in self._connectors and self._connectors[connector_id].is_running:
            return

        connector = await self.connector_repo.find_by_id(connector_id)
        if not connector:
            raise ValueError(f"Connector {connector_id} not found")

        await self.connector_repo.update_status(connector_id, "starting")
        instance = self._create_instance(connector)
        self._connectors[connector_id] = instance

        try:
            await instance.start()
            await self.connector_repo.update_status(connector_id, "connected")
            await self.event_bus.publish(connector_id, "status_changed", {"status": "connected"})
        except Exception as e:
            await self.connector_repo.update_status(connector_id, "error", str(e))
            await self.event_bus.publish(connector_id, "status_changed", {
                "status": "error", "message": str(e),
            })
            raise

    async def stop_connector(self, connector_id: str) -> None:
        instance = self._connectors.pop(connector_id, None)
        if instance:
            await instance.stop()
        await self.connector_repo.update_status(connector_id, "stopped")
        await self.event_bus.publish(connector_id, "status_changed", {"status": "stopped"})

    async def restart_connector(self, connector_id: str) -> None:
        await self.stop_connector(connector_id)
        await self.start_connector(connector_id)

    async def send_to_external(
        self, connector_id: str, target: str, content: str,
    ) -> None:
        """Send a message through a running connector (used for takeover sends)."""
        instance = self._connectors.get(connector_id)
        if not instance or not instance.is_running:
            raise RuntimeError(f"Connector {connector_id} is not running")
        await instance.send_to_external(target, content)

    def get_instance(self, connector_id: str) -> BaseConnector | None:
        return self._connectors.get(connector_id)

    def get_status(self, connector_id: str) -> dict:
        instance = self._connectors.get(connector_id)
        if not instance:
            return {"status": "stopped", "running": False}
        return {
            "status": "connected" if instance.is_running else "stopped",
            "running": instance.is_running,
        }

    async def start_auto_start_connectors(self) -> None:
        """Called during lifespan startup. Starts all enabled auto-start connectors."""
        connectors = await self.connector_repo.find_enabled()
        for conn in connectors:
            try:
                await self.start_connector(conn.id)  # type: ignore[arg-type]
                logger.info("Auto-started connector: %s", conn.name)
            except Exception as e:
                logger.error("Failed to auto-start connector %s: %s", conn.name, e)

        # Start watchdog
        self._watchdog_task = asyncio.create_task(self._watchdog(), name="connector-watchdog")

    async def _watchdog(self) -> None:
        """Periodically check connector health and restart crashed instances."""
        while True:
            await asyncio.sleep(30)
            for cid, instance in list(self._connectors.items()):
                if not instance.is_running and instance._running:
                    logger.warning("Connector %s crashed, restarting...", instance.config.name)
                    try:
                        await self.restart_connector(cid)
                    except Exception as e:
                        logger.error("Failed to restart connector %s: %s", cid, e)

    async def shutdown(self) -> None:
        """Called during lifespan shutdown."""
        if self._watchdog_task:
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass
        for cid in list(self._connectors):
            try:
                await self.stop_connector(cid)
            except Exception as e:
                logger.error("Error stopping connector %s: %s", cid, e)
