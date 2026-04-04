from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.agent import Agent


class AgentRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["agents"]

    async def create(self, agent: Agent) -> str:
        doc = agent.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_all(self, active_only: bool = True) -> list[Agent]:
        query = {"is_active": True} if active_only else {}
        agents = []
        async for doc in self.collection.find(query):
            doc["_id"] = str(doc["_id"])
            agents.append(Agent(**doc))
        return agents

    async def find_by_slug(self, slug: str) -> Agent | None:
        doc = await self.collection.find_one({"slug": slug})
        if doc:
            doc["_id"] = str(doc["_id"])
            return Agent(**doc)
        return None

    async def find_by_id(self, agent_id: str) -> Agent | None:
        doc = await self.collection.find_one({"_id": ObjectId(agent_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return Agent(**doc)
        return None

    async def update(self, slug: str, updates: dict) -> bool:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await self.collection.update_one({"slug": slug}, {"$set": updates})
        return result.modified_count > 0

    async def delete(self, slug: str) -> bool:
        result = await self.collection.update_one(
            {"slug": slug}, {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}}
        )
        return result.modified_count > 0
