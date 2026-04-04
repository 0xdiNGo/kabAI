from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.provider import Provider


class ProviderRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["providers"]

    async def create(self, provider: Provider) -> str:
        doc = provider.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_all(self, enabled_only: bool = False) -> list[Provider]:
        query = {"is_enabled": True} if enabled_only else {}
        providers = []
        async for doc in self.collection.find(query):
            doc["_id"] = str(doc["_id"])
            providers.append(Provider(**doc))
        return providers

    async def find_by_id(self, provider_id: str) -> Provider | None:
        doc = await self.collection.find_one({"_id": ObjectId(provider_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return Provider(**doc)
        return None

    async def find_by_name(self, name: str) -> Provider | None:
        doc = await self.collection.find_one({"name": name})
        if doc:
            doc["_id"] = str(doc["_id"])
            return Provider(**doc)
        return None

    async def update(self, provider_id: str, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.collection.update_one(
            {"_id": ObjectId(provider_id)}, {"$set": updates}
        )
        return result.modified_count > 0

    async def delete(self, provider_id: str) -> bool:
        result = await self.collection.delete_one({"_id": ObjectId(provider_id)})
        return result.deleted_count > 0
