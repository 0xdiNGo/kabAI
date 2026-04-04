from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.system_settings import SystemSettings

SETTINGS_ID = "system_settings"


class SettingsRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["settings"]

    async def get(self) -> SystemSettings:
        doc = await self.collection.find_one({"_id": SETTINGS_ID})
        if doc:
            return SystemSettings(**doc)
        # Create default on first access
        default = SystemSettings(_id=SETTINGS_ID)
        await self.collection.insert_one(
            {"_id": SETTINGS_ID, **default.model_dump(exclude={"id"})}
        )
        return default

    async def update(self, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.collection.update_one(
            {"_id": SETTINGS_ID}, {"$set": updates}, upsert=True
        )
        return result.modified_count > 0 or result.upserted_id is not None
