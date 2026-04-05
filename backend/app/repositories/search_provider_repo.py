from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.search_provider import SearchProvider


class SearchProviderRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["search_providers"]

    async def create(self, sp: SearchProvider) -> str:
        doc = sp.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_by_id(self, sp_id: str) -> SearchProvider | None:
        doc = await self.collection.find_one({"_id": ObjectId(sp_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return SearchProvider(**doc)
        return None

    async def find_all(self) -> list[SearchProvider]:
        providers = []
        async for doc in self.collection.find().sort("name", 1):
            doc["_id"] = str(doc["_id"])
            providers.append(SearchProvider(**doc))
        return providers

    async def find_default(self) -> SearchProvider | None:
        doc = await self.collection.find_one({"is_default": True, "is_enabled": True})
        if doc:
            doc["_id"] = str(doc["_id"])
            return SearchProvider(**doc)
        # Fall back to first enabled
        doc = await self.collection.find_one({"is_enabled": True})
        if doc:
            doc["_id"] = str(doc["_id"])
            return SearchProvider(**doc)
        return None

    async def update(self, sp_id: str, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.collection.update_one(
            {"_id": ObjectId(sp_id)}, {"$set": updates}
        )
        return result.modified_count > 0

    async def set_default(self, sp_id: str) -> None:
        await self.collection.update_many({}, {"$set": {"is_default": False}})
        await self.collection.update_one(
            {"_id": ObjectId(sp_id)}, {"$set": {"is_default": True}}
        )

    async def delete(self, sp_id: str) -> bool:
        result = await self.collection.delete_one({"_id": ObjectId(sp_id)})
        return result.deleted_count > 0
