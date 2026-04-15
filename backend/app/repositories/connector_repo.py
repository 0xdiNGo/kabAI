from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.connector import Connector


class ConnectorRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["connectors"]

    async def ensure_indexes(self):
        await self.collection.create_index("owner_user_id")
        await self.collection.create_index("connector_type")
        await self.collection.create_index([("is_enabled", 1), ("auto_start", 1)])

    async def create(self, connector: Connector) -> str:
        doc = connector.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_by_id(self, connector_id: str) -> Connector | None:
        doc = await self.collection.find_one({"_id": ObjectId(connector_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return Connector(**doc)
        return None

    async def find_by_user(self, user_id: str) -> list[Connector]:
        connectors = []
        async for doc in self.collection.find({"owner_user_id": user_id}).sort("created_at", -1):
            doc["_id"] = str(doc["_id"])
            connectors.append(Connector(**doc))
        return connectors

    async def find_enabled(self) -> list[Connector]:
        connectors = []
        async for doc in self.collection.find({"is_enabled": True, "auto_start": True}):
            doc["_id"] = str(doc["_id"])
            connectors.append(Connector(**doc))
        return connectors

    async def update(self, connector_id: str, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.collection.update_one(
            {"_id": ObjectId(connector_id)}, {"$set": updates},
        )
        return result.modified_count > 0

    async def update_status(
        self, connector_id: str, status: str, status_message: str | None = None,
    ) -> bool:
        updates: dict = {
            "status": status,
            "status_message": status_message,
            "updated_at": datetime.now(timezone.utc),
        }
        if status == "connected":
            updates["last_connected_at"] = datetime.now(timezone.utc)
        result = await self.collection.update_one(
            {"_id": ObjectId(connector_id)}, {"$set": updates},
        )
        return result.modified_count > 0

    async def delete(self, connector_id: str) -> bool:
        result = await self.collection.delete_one({"_id": ObjectId(connector_id)})
        return result.deleted_count > 0
