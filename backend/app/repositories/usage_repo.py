from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.usage_log import UsageLog


class UsageRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["usage_logs"]

    async def ensure_indexes(self) -> None:
        await self.collection.create_index("created_at")
        await self.collection.create_index("provider")
        await self.collection.create_index("model")
        await self.collection.create_index("task_type")
        await self.collection.create_index([("provider", 1), ("created_at", -1)])

    async def log(self, entry: UsageLog) -> str:
        doc = entry.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def log_bulk(self, entries: list[UsageLog]) -> int:
        if not entries:
            return 0
        docs = [e.model_dump(by_alias=True, exclude={"id"}) for e in entries]
        result = await self.collection.insert_many(docs)
        return len(result.inserted_ids)

    async def query(
        self,
        days: int = 7,
        provider: str | None = None,
        model: str | None = None,
        task_type: str | None = None,
        limit: int = 1000,
    ) -> list[UsageLog]:
        """Query usage logs with optional filters."""
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query_filter: dict = {"created_at": {"$gte": cutoff}}
        if provider:
            query_filter["provider"] = provider
        if model:
            query_filter["model"] = model
        if task_type:
            query_filter["task_type"] = task_type

        results = []
        cursor = self.collection.find(query_filter).sort("created_at", -1).limit(limit)
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(UsageLog(**doc))
        return results

    async def get_summary(
        self,
        days: int = 7,
        group_by: str = "model",
    ) -> list[dict]:
        """Aggregate usage stats grouped by a field."""
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        pipeline = [
            {"$match": {"created_at": {"$gte": cutoff}}},
            {"$group": {
                "_id": f"${group_by}",
                "total_requests": {"$sum": 1},
                "total_tokens_in": {"$sum": "$tokens_in"},
                "total_tokens_out": {"$sum": "$tokens_out"},
                "total_tokens": {"$sum": "$total_tokens"},
                "total_cost_usd": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
                "avg_duration_ms": {"$avg": "$duration_ms"},
                "latest_balance": {"$last": "$balance_usd"},
            }},
            {"$sort": {"total_cost_usd": -1}},
        ]

        results = []
        async for doc in self.collection.aggregate(pipeline):
            results.append({
                group_by: doc["_id"],
                "total_requests": doc["total_requests"],
                "total_tokens_in": doc["total_tokens_in"],
                "total_tokens_out": doc["total_tokens_out"],
                "total_tokens": doc["total_tokens"],
                "total_cost_usd": round(doc["total_cost_usd"], 6),
                "avg_duration_ms": round(doc["avg_duration_ms"] or 0),
                "latest_balance": doc.get("latest_balance"),
            })
        return results

    async def get_daily_trend(
        self,
        days: int = 30,
        provider: str | None = None,
    ) -> list[dict]:
        """Get daily aggregated usage for trending."""
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        match_filter: dict = {"created_at": {"$gte": cutoff}}
        if provider:
            match_filter["provider"] = provider

        pipeline = [
            {"$match": match_filter},
            {"$group": {
                "_id": {
                    "$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}
                },
                "requests": {"$sum": 1},
                "tokens": {"$sum": "$total_tokens"},
                "cost_usd": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
                "balance_usd": {"$last": "$balance_usd"},
            }},
            {"$sort": {"_id": 1}},
        ]

        results = []
        async for doc in self.collection.aggregate(pipeline):
            results.append({
                "date": doc["_id"],
                "requests": doc["requests"],
                "tokens": doc["tokens"],
                "cost_usd": round(doc["cost_usd"], 6),
                "balance_usd": doc.get("balance_usd"),
            })
        return results
