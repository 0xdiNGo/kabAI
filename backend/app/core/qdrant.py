"""Qdrant vector database connection singleton."""

import logging

from qdrant_client import AsyncQdrantClient

logger = logging.getLogger(__name__)


class QdrantConnection:
    client: AsyncQdrantClient | None = None

    async def connect(self, url: str) -> None:
        self.client = AsyncQdrantClient(url=url)
        logger.info("Connected to Qdrant at %s", url)

    async def disconnect(self) -> None:
        if self.client:
            await self.client.close()
            self.client = None
            logger.info("Disconnected from Qdrant")


qdrant_conn = QdrantConnection()
