from datetime import datetime, timezone, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.prompt_guard import PromptGuardLog


class PromptGuardRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["prompt_guard_logs"]

    async def ensure_indexes(self):
        await self.collection.create_index([("created_at", -1)])
        await self.collection.create_index("agent_id")
        await self.collection.create_index("action_taken")
        await self.collection.create_index("source")

    async def log(self, entry: PromptGuardLog) -> str:
        doc = entry.model_dump(by_alias=True, exclude_none=True)
        doc.pop("_id", None)
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_recent(
        self, limit: int = 50, offset: int = 0,
        agent_id: str | None = None,
        action: str | None = None,
        source: str | None = None,
    ) -> list[dict]:
        query: dict = {}
        if agent_id:
            query["agent_id"] = agent_id
        if action:
            query["action_taken"] = action
        if source:
            query["source"] = source
        cursor = self.collection.find(query).sort("created_at", -1).skip(offset).limit(limit)
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        return results

    async def get_stats(self, days: int = 7) -> dict:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        pipeline = [
            {"$match": {"created_at": {"$gte": since}}},
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "blocked": {"$sum": {"$cond": [{"$eq": ["$action_taken", "block"]}, 1, 0]}},
                "sanitized": {"$sum": {"$cond": [{"$eq": ["$action_taken", "sanitize"]}, 1, 0]}},
                "warned": {"$sum": {"$cond": [{"$eq": ["$action_taken", "warn"]}, 1, 0]}},
                "logged": {"$sum": {"$cond": [{"$eq": ["$action_taken", "log"]}, 1, 0]}},
                "avg_score": {"$avg": "$score"},
            }},
        ]
        results = await self.collection.aggregate(pipeline).to_list(1)
        if not results:
            return {"total": 0, "blocked": 0, "sanitized": 0, "warned": 0, "logged": 0, "avg_score": 0.0}

        stats = results[0]
        stats.pop("_id", None)

        # Top triggered flags
        flag_pipeline = [
            {"$match": {"created_at": {"$gte": since}}},
            {"$unwind": "$flags"},
            {"$group": {"_id": "$flags", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 10},
        ]
        flag_results = await self.collection.aggregate(flag_pipeline).to_list(10)
        stats["top_flags"] = [{"flag": r["_id"], "count": r["count"]} for r in flag_results]

        return stats
