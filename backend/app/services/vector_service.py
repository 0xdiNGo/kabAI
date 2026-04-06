"""Vector search service — embedding generation and Qdrant operations."""

import logging

import litellm
from qdrant_client import models as qmodels

from app.repositories.settings_repo import SettingsRepository

logger = logging.getLogger(__name__)

COLLECTION_NAME = "knowledge_vectors"


class VectorService:
    def __init__(self, qdrant_client, llm_service, settings_repo: SettingsRepository):
        self.client = qdrant_client
        self.llm_service = llm_service
        self.settings_repo = settings_repo
        self._collection_ready = False
        self._vector_size: int | None = None

    async def _get_embedding_model(self) -> str | None:
        settings = await self.settings_repo.get()
        return settings.embedding_model

    async def _ensure_collection(self, vector_size: int) -> None:
        """Create Qdrant collection if it doesn't exist."""
        if self._collection_ready and self._vector_size == vector_size:
            return
        try:
            collections = await self.client.get_collections()
            names = [c.name for c in collections.collections]
            if COLLECTION_NAME not in names:
                await self.client.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=qmodels.VectorParams(
                        size=vector_size,
                        distance=qmodels.Distance.COSINE,
                    ),
                )
                # Create payload index for kb_id filtering
                await self.client.create_payload_index(
                    collection_name=COLLECTION_NAME,
                    field_name="kb_id",
                    field_schema=qmodels.PayloadSchemaType.KEYWORD,
                )
                logger.info("Created Qdrant collection %s (dim=%d)", COLLECTION_NAME, vector_size)
            self._collection_ready = True
            self._vector_size = vector_size
        except Exception as e:
            logger.warning("Failed to ensure Qdrant collection: %s", e)

    async def generate_embedding(self, text: str) -> list[float] | None:
        """Generate an embedding vector for text using the configured model."""
        model = await self._get_embedding_model()
        if not model:
            return None

        try:
            kwargs = await self.llm_service._get_model_kwargs(model)
            # Truncate to avoid exceeding model's context window
            truncated = text[:8000]
            response = await litellm.aembedding(
                model=model,
                input=[truncated],
                **kwargs,
            )
            embedding = response.data[0]["embedding"]
            return embedding
        except Exception as e:
            logger.warning("Embedding generation failed: %s", e)
            return None

    async def generate_embeddings_batch(
        self, texts: list[str]
    ) -> list[list[float] | None]:
        """Generate embeddings for multiple texts. Returns list aligned with input."""
        model = await self._get_embedding_model()
        if not model:
            return [None] * len(texts)

        try:
            kwargs = await self.llm_service._get_model_kwargs(model)
            truncated = [t[:8000] for t in texts]
            response = await litellm.aembedding(
                model=model,
                input=truncated,
                **kwargs,
            )
            return [d["embedding"] for d in response.data]
        except Exception as e:
            logger.warning("Batch embedding generation failed: %s", e)
            # Fall back to individual generation
            results = []
            for text in texts:
                emb = await self.generate_embedding(text)
                results.append(emb)
            return results

    async def upsert_items(self, items: list[dict]) -> int:
        """Batch upsert vectors to Qdrant.

        Each item: {id: str, vector: list[float], kb_id: str, title: str}
        """
        valid = [i for i in items if i.get("vector")]
        if not valid:
            return 0

        vector_size = len(valid[0]["vector"])
        await self._ensure_collection(vector_size)

        points = [
            qmodels.PointStruct(
                id=item["id"],
                vector=item["vector"],
                payload={"kb_id": item["kb_id"], "title": item.get("title", "")},
            )
            for item in valid
        ]

        try:
            await self.client.upsert(
                collection_name=COLLECTION_NAME,
                points=points,
            )
            logger.debug("Upserted %d vectors to Qdrant", len(points))
            return len(points)
        except Exception as e:
            logger.warning("Qdrant upsert failed: %s", e)
            return 0

    async def search(
        self, query_vector: list[float], kb_ids: list[str], limit: int = 15
    ) -> list[dict]:
        """Vector similarity search filtered by kb_ids.

        Returns list of {id: str, score: float}.
        """
        if not query_vector or not kb_ids:
            return []

        try:
            results = await self.client.query_points(
                collection_name=COLLECTION_NAME,
                query=query_vector,
                query_filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="kb_id",
                            match=qmodels.MatchAny(any=kb_ids),
                        )
                    ]
                ),
                limit=limit,
            )
            return [
                {"id": str(r.id), "score": r.score}
                for r in results.points
            ]
        except Exception as e:
            logger.warning("Qdrant search failed: %s", e)
            return []

    async def delete_by_kb(self, kb_id: str) -> None:
        """Delete all vectors for a knowledge base."""
        try:
            await self.client.delete(
                collection_name=COLLECTION_NAME,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(
                        must=[
                            qmodels.FieldCondition(
                                key="kb_id",
                                match=qmodels.MatchValue(value=kb_id),
                            )
                        ]
                    )
                ),
            )
            logger.info("Deleted vectors for KB %s from Qdrant", kb_id)
        except Exception as e:
            logger.warning("Qdrant delete failed for KB %s: %s", kb_id, e)

    async def delete_by_ids(self, item_ids: list[str]) -> None:
        """Delete specific vectors by ID."""
        if not item_ids:
            return
        try:
            await self.client.delete(
                collection_name=COLLECTION_NAME,
                points_selector=qmodels.PointIdsList(points=item_ids),
            )
        except Exception as e:
            logger.warning("Qdrant delete by IDs failed: %s", e)
