from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.exemplar import ExemplarPair, ExemplarSet


class ExemplarRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.sets = db["exemplar_sets"]
        self.pairs = db["exemplar_pairs"]

    async def ensure_indexes(self) -> None:
        await self.pairs.create_index(
            [("user_content", "text"), ("assistant_content", "text")],
            weights={"user_content": 2, "assistant_content": 1},
            name="exemplar_text_search",
        )
        await self.pairs.create_index("exemplar_set_id")

    # --- Set CRUD ---

    async def create_set(self, es: ExemplarSet) -> str:
        doc = es.model_dump(by_alias=True, exclude={"id"})
        result = await self.sets.insert_one(doc)
        return str(result.inserted_id)

    async def find_set_by_id(self, set_id: str) -> ExemplarSet | None:
        doc = await self.sets.find_one({"_id": ObjectId(set_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return ExemplarSet(**doc)
        return None

    async def find_set_by_name(self, name: str) -> ExemplarSet | None:
        doc = await self.sets.find_one({"name": name})
        if doc:
            doc["_id"] = str(doc["_id"])
            return ExemplarSet(**doc)
        return None

    async def find_all_sets(self) -> list[ExemplarSet]:
        sets = []
        async for doc in self.sets.find().sort("name", 1):
            doc["_id"] = str(doc["_id"])
            sets.append(ExemplarSet(**doc))
        return sets

    async def find_sets_by_ids(self, set_ids: list[str]) -> list[ExemplarSet]:
        object_ids = [ObjectId(sid) for sid in set_ids]
        sets = []
        async for doc in self.sets.find({"_id": {"$in": object_ids}}):
            doc["_id"] = str(doc["_id"])
            sets.append(ExemplarSet(**doc))
        return sets

    async def update_set(self, set_id: str, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.sets.update_one(
            {"_id": ObjectId(set_id)}, {"$set": updates}
        )
        return result.modified_count > 0

    async def delete_set(self, set_id: str) -> bool:
        await self.pairs.delete_many({"exemplar_set_id": set_id})
        result = await self.sets.delete_one({"_id": ObjectId(set_id)})
        return result.deleted_count > 0

    async def update_pair_count(self, set_id: str) -> None:
        count = await self.pairs.count_documents({"exemplar_set_id": set_id})
        await self.sets.update_one(
            {"_id": ObjectId(set_id)},
            {"$set": {"pair_count": count, "updated_at": datetime.now(timezone.utc)}},
        )

    # --- Pair CRUD ---

    async def add_pair(self, pair: ExemplarPair) -> str:
        doc = pair.model_dump(by_alias=True, exclude={"id"})
        result = await self.pairs.insert_one(doc)
        return str(result.inserted_id)

    async def add_pairs_bulk(self, pairs: list[ExemplarPair]) -> int:
        if not pairs:
            return 0
        docs = [p.model_dump(by_alias=True, exclude={"id"}) for p in pairs]
        result = await self.pairs.insert_many(docs)
        return len(result.inserted_ids)

    async def find_pairs_by_set(
        self, set_id: str, limit: int = 100, offset: int = 0
    ) -> list[ExemplarPair]:
        pairs = []
        cursor = (
            self.pairs.find({"exemplar_set_id": set_id})
            .skip(offset)
            .limit(limit)
        )
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            pairs.append(ExemplarPair(**doc))
        return pairs

    async def find_all_pairs_by_set(self, set_id: str) -> list[ExemplarPair]:
        pairs = []
        async for doc in self.pairs.find({"exemplar_set_id": set_id}):
            doc["_id"] = str(doc["_id"])
            pairs.append(ExemplarPair(**doc))
        return pairs

    async def delete_pair(self, pair_id: str) -> bool:
        result = await self.pairs.delete_one({"_id": ObjectId(pair_id)})
        return result.deleted_count > 0

    # --- Text Search ---

    async def search(
        self, query: str, set_ids: list[str], limit: int = 3
    ) -> list[ExemplarPair]:
        if not query.strip() or not set_ids:
            return []
        results = []
        cursor = self.pairs.find(
            {
                "exemplar_set_id": {"$in": set_ids},
                "$text": {"$search": query},
            },
            {"score": {"$meta": "textScore"}},
        ).sort([("score", {"$meta": "textScore"})]).limit(limit)
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            doc.pop("score", None)
            results.append(ExemplarPair(**doc))
        return results
