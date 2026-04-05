from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.ingest_queue import IngestQueueItem


class IngestQueueRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["ingest_queue"]

    async def ensure_indexes(self) -> None:
        await self.collection.create_index("state")
        await self.collection.create_index("job_id")
        await self.collection.create_index("kb_id")
        await self.collection.create_index([("state", 1), ("created_at", 1)])

    async def enqueue_bulk(self, items: list[IngestQueueItem]) -> int:
        if not items:
            return 0
        docs = [item.model_dump(by_alias=True, exclude={"id"}) for item in items]
        result = await self.collection.insert_many(docs)
        return len(result.inserted_ids)

    async def claim_next_pending(self) -> IngestQueueItem | None:
        """Atomically claim the next pending item (FIFO by created_at)."""
        doc = await self.collection.find_one_and_update(
            {"state": "pending"},
            {"$set": {"state": "processing"}},
            sort=[("created_at", 1)],
            return_document=True,
        )
        if doc:
            doc["_id"] = str(doc["_id"])
            return IngestQueueItem(**doc)
        return None

    async def claim_batch(self, batch_size: int = 50) -> list[IngestQueueItem]:
        """Claim multiple pending items at once. Much more efficient than one-at-a-time."""
        # Find IDs of pending items
        cursor = self.collection.find(
            {"state": "pending"}, {"_id": 1}
        ).sort("created_at", 1).limit(batch_size)
        ids = [doc["_id"] async for doc in cursor]

        if not ids:
            return []

        # Atomically update all to processing
        await self.collection.update_many(
            {"_id": {"$in": ids}, "state": "pending"},
            {"$set": {"state": "processing"}},
        )

        # Fetch the claimed items
        items = []
        async for doc in self.collection.find({"_id": {"$in": ids}}):
            doc["_id"] = str(doc["_id"])
            items.append(IngestQueueItem(**doc))
        return items

    async def mark_done_bulk(self, item_ids: list[str], tokens_used: int = 0) -> None:
        """Mark multiple items as done at once."""
        if not item_ids:
            return
        object_ids = [ObjectId(iid) for iid in item_ids]
        await self.collection.update_many(
            {"_id": {"$in": object_ids}},
            {"$set": {
                "state": "done",
                "tokens_used": tokens_used,
                "completed_at": datetime.now(timezone.utc),
            }},
        )

    async def mark_done(
        self, item_id: str, title: str, tokens_used: int
    ) -> None:
        await self.collection.update_one(
            {"_id": ObjectId(item_id)},
            {"$set": {
                "state": "done",
                "title": title,
                "tokens_used": tokens_used,
                "completed_at": datetime.now(timezone.utc),
            }},
        )

    async def mark_failed(self, item_id: str, error: str) -> None:
        await self.collection.update_one(
            {"_id": ObjectId(item_id)},
            {"$set": {
                "state": "failed",
                "error": error,
                "completed_at": datetime.now(timezone.utc),
            }},
        )

    async def reset_stale_processing(self) -> int:
        """Reset items stuck in 'processing' back to 'pending' (crash recovery)."""
        result = await self.collection.update_many(
            {"state": "processing"},
            {"$set": {"state": "pending"}},
        )
        return result.modified_count

    async def cancel_job(self, job_id: str) -> int:
        """Delete all non-done items for a job. Returns count deleted."""
        result = await self.collection.delete_many(
            {"job_id": job_id, "state": {"$ne": "done"}},
        )
        return result.deleted_count

    async def purge_done_for_job(self, job_id: str) -> int:
        """Delete all done items for a completed job. Returns count deleted."""
        result = await self.collection.delete_many(
            {"job_id": job_id, "state": "done"}
        )
        return result.deleted_count

    async def get_job_progress(self, job_id: str) -> dict:
        """Get progress for a specific job."""
        pipeline = [
            {"$match": {"job_id": job_id}},
            {"$group": {
                "_id": "$state",
                "count": {"$sum": 1},
                "tokens": {"$sum": "$tokens_used"},
            }},
        ]
        states = {}
        async for doc in self.collection.aggregate(pipeline):
            states[doc["_id"]] = {"count": doc["count"], "tokens": doc["tokens"]}

        total = sum(s["count"] for s in states.values())
        done = states.get("done", {}).get("count", 0)
        failed = states.get("failed", {}).get("count", 0)
        pending = states.get("pending", {}).get("count", 0)
        processing = states.get("processing", {}).get("count", 0)
        tokens = sum(s["tokens"] for s in states.values())

        return {
            "total": total, "done": done, "failed": failed,
            "pending": pending, "processing": processing,
            "tokens_used": tokens,
        }

    async def get_jobs_for_kb(self, kb_id: str) -> list[dict]:
        """Get all distinct jobs for a KB with progress."""
        pipeline = [
            {"$match": {"kb_id": kb_id}},
            {"$group": {
                "_id": {"job_id": "$job_id", "source": "$source", "batch_id": "$batch_id"},
                "total": {"$sum": 1},
                "done": {"$sum": {"$cond": [{"$eq": ["$state", "done"]}, 1, 0]}},
                "failed": {"$sum": {"$cond": [{"$eq": ["$state", "failed"]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$state", "pending"]}, 1, 0]}},
                "processing": {"$sum": {"$cond": [{"$eq": ["$state", "processing"]}, 1, 0]}},
                "tokens_used": {"$sum": "$tokens_used"},
                "created_at": {"$min": "$created_at"},
            }},
            {"$sort": {"created_at": -1}},
        ]
        jobs = []
        async for doc in self.collection.aggregate(pipeline):
            jobs.append({
                "job_id": doc["_id"]["job_id"],
                "source": doc["_id"]["source"],
                "batch_id": doc["_id"]["batch_id"],
                "total": doc["total"],
                "done": doc["done"],
                "failed": doc["failed"],
                "pending": doc["pending"],
                "processing": doc["processing"],
                "tokens_used": doc["tokens_used"],
                "created_at": doc["created_at"].isoformat() if doc["created_at"] else None,
            })
        return jobs

    async def get_global_queue_status(self) -> dict:
        """Global queue depth — uses fast indexed countDocuments per state."""
        pending = await self.collection.count_documents({"state": "pending"})
        processing = await self.collection.count_documents({"state": "processing"})
        done = await self.collection.count_documents({"state": "done"})
        failed = await self.collection.count_documents({"state": "failed"})
        return {
            "pending": pending,
            "processing": processing,
            "done": done,
            "failed": failed,
            "total": pending + processing + done + failed,
        }
