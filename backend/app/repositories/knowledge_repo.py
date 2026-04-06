from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.knowledge_base import IngestBatch, KnowledgeBase, KnowledgeItem


class KnowledgeRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.bases = db["knowledge_bases"]
        self.items = db["knowledge_items"]
        self.batches = db["ingest_batches"]

    async def ensure_indexes(self) -> None:
        # Check if the correct compound text index already exists
        existing = await self.items.index_information()
        has_compound = "knowledge_kb_text_search" in existing
        has_old = "knowledge_text_search" in existing

        if has_old and not has_compound:
            # Old global text index exists — drop it (can only have one text index)
            try:
                await self.items.drop_index("knowledge_text_search")
            except Exception:
                pass

        if not has_compound:
            # Create compound index: knowledge_base_id prefix + text search
            # NOTE: if this fails silently (Motor bug), run from mongosh:
            # db.knowledge_items.createIndex(
            #   { knowledge_base_id: 1, title: "text", content: "text" },
            #   { weights: { title: 3, content: 1 }, name: "knowledge_kb_text_search" }
            # )
            try:
                await self.items.create_index(
                    [("knowledge_base_id", 1), ("title", "text"), ("content", "text")],
                    weights={"title": 3, "content": 1},
                    name="knowledge_kb_text_search",
                )
            except Exception:
                pass  # Index may already exist or Motor may fail — manual creation works

        await self.items.create_index("batch_id")
        await self.batches.create_index("knowledge_base_id")
        await self.batches.create_index("knowledge_base_id")

    # --- Knowledge Base CRUD ---

    async def create_base(self, kb: KnowledgeBase) -> str:
        doc = kb.model_dump(by_alias=True, exclude={"id"})
        result = await self.bases.insert_one(doc)
        return str(result.inserted_id)

    async def find_base_by_id(self, kb_id: str) -> KnowledgeBase | None:
        doc = await self.bases.find_one({"_id": ObjectId(kb_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return KnowledgeBase(**doc)
        return None

    async def find_base_by_name(self, name: str) -> KnowledgeBase | None:
        doc = await self.bases.find_one({"name": name})
        if doc:
            doc["_id"] = str(doc["_id"])
            return KnowledgeBase(**doc)
        return None

    async def find_all_bases(self) -> list[KnowledgeBase]:
        bases = []
        async for doc in self.bases.find().sort("name", 1):
            doc["_id"] = str(doc["_id"])
            bases.append(KnowledgeBase(**doc))
        return bases

    async def find_bases_by_ids(self, kb_ids: list[str]) -> list[KnowledgeBase]:
        object_ids = [ObjectId(kid) for kid in kb_ids]
        bases = []
        async for doc in self.bases.find({"_id": {"$in": object_ids}}):
            doc["_id"] = str(doc["_id"])
            bases.append(KnowledgeBase(**doc))
        return bases

    async def update_base(self, kb_id: str, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.bases.update_one(
            {"_id": ObjectId(kb_id)}, {"$set": updates}
        )
        return result.modified_count > 0

    async def delete_base(self, kb_id: str) -> bool:
        await self.items.delete_many({"knowledge_base_id": kb_id})
        await self.batches.delete_many({"knowledge_base_id": kb_id})
        result = await self.bases.delete_one({"_id": ObjectId(kb_id)})
        return result.deleted_count > 0

    async def update_item_count(self, kb_id: str) -> None:
        count = await self.items.count_documents({"knowledge_base_id": kb_id})
        await self.bases.update_one(
            {"_id": ObjectId(kb_id)},
            {"$set": {"item_count": count, "updated_at": datetime.now(timezone.utc)}},
        )

    # --- Batch Tracking ---

    async def create_batch(self, kb_id: str, source: str | None = None) -> str:
        batch = IngestBatch(knowledge_base_id=kb_id, source=source)
        doc = batch.model_dump(by_alias=True, exclude={"id"})
        result = await self.batches.insert_one(doc)
        return str(result.inserted_id)

    async def update_batch_count(self, batch_id: str, count: int) -> None:
        await self.batches.update_one(
            {"_id": ObjectId(batch_id)}, {"$set": {"item_count": count}}
        )

    async def find_batches_by_base(self, kb_id: str) -> list[IngestBatch]:
        batches = []
        async for doc in self.batches.find({"knowledge_base_id": kb_id}).sort("created_at", -1):
            doc["_id"] = str(doc["_id"])
            batches.append(IngestBatch(**doc))
        return batches

    async def rollback_batch(self, batch_id: str) -> int:
        """Delete all items from a batch. Returns count deleted."""
        result = await self.items.delete_many({"batch_id": batch_id})
        await self.batches.delete_one({"_id": ObjectId(batch_id)})
        return result.deleted_count

    # --- Knowledge Item CRUD ---

    async def add_item(self, item: KnowledgeItem) -> str:
        doc = item.model_dump(by_alias=True, exclude={"id"})
        result = await self.items.insert_one(doc)
        return str(result.inserted_id)

    async def add_items_bulk(self, items: list[KnowledgeItem]) -> list[str]:
        if not items:
            return []
        docs = [item.model_dump(by_alias=True, exclude={"id"}) for item in items]
        result = await self.items.insert_many(docs)
        return [str(oid) for oid in result.inserted_ids]

    async def find_items_by_base(
        self, kb_id: str, limit: int = 100, offset: int = 0
    ) -> list[KnowledgeItem]:
        items = []
        cursor = (
            self.items.find({"knowledge_base_id": kb_id})
            .sort("chunk_index", 1)
            .skip(offset)
            .limit(limit)
        )
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            items.append(KnowledgeItem(**doc))
        return items

    async def find_all_items_by_base(self, kb_id: str) -> list[KnowledgeItem]:
        items = []
        async for doc in self.items.find({"knowledge_base_id": kb_id}).sort("chunk_index", 1):
            doc["_id"] = str(doc["_id"])
            items.append(KnowledgeItem(**doc))
        return items

    async def find_items_by_ids(self, item_ids: list[str]) -> list[KnowledgeItem]:
        if not item_ids:
            return []
        object_ids = [ObjectId(iid) for iid in item_ids]
        items = []
        async for doc in self.items.find({"_id": {"$in": object_ids}}):
            doc["_id"] = str(doc["_id"])
            items.append(KnowledgeItem(**doc))
        return items

    async def delete_item(self, item_id: str) -> bool:
        result = await self.items.delete_one({"_id": ObjectId(item_id)})
        return result.deleted_count > 0

    async def delete_items_by_source(self, kb_id: str, source: str) -> int:
        result = await self.items.delete_many(
            {"knowledge_base_id": kb_id, "source": source}
        )
        return result.deleted_count

    async def get_sources(self, kb_id: str) -> list[dict]:
        """Get item counts grouped by source."""
        pipeline = [
            {"$match": {"knowledge_base_id": kb_id}},
            {"$group": {"_id": "$source", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        results = []
        async for doc in self.items.aggregate(pipeline):
            results.append({"source": doc["_id"], "count": doc["count"]})
        return results

    # --- Text Search ---

    async def search(
        self, query: str, kb_ids: list[str], limit: int = 5
    ) -> list[KnowledgeItem]:
        """Full-text search using compound index (knowledge_base_id + text).

        The compound text index requires equality on knowledge_base_id, so
        we query per-KB and merge results sorted by text score.
        """
        if not query.strip() or not kb_ids:
            return []

        import asyncio

        async def _search_one(kb_id: str) -> list[tuple[float, dict]]:
            scored = []
            cursor = self.items.find(
                {"knowledge_base_id": kb_id, "$text": {"$search": query}},
                {"score": {"$meta": "textScore"}},
            ).sort([("score", {"$meta": "textScore"})]).limit(limit)
            async for doc in cursor:
                score = doc.pop("score", 0)
                doc["_id"] = str(doc["_id"])
                scored.append((score, doc))
            return scored

        per_kb = await asyncio.gather(*[_search_one(kid) for kid in kb_ids])
        all_scored = [item for sublist in per_kb for item in sublist]
        all_scored.sort(key=lambda x: x[0], reverse=True)

        return [KnowledgeItem(**doc) for _, doc in all_scored[:limit]]

    async def search_within_base(
        self, query: str, kb_id: str, limit: int = 20
    ) -> list[KnowledgeItem]:
        """Search within a single KB."""
        return await self.search(query, [kb_id], limit)
