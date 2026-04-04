from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.conversation import Conversation, Message


class ConversationRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["conversations"]

    async def create(self, conversation: Conversation) -> str:
        doc = conversation.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_by_id(self, conversation_id: str) -> Conversation | None:
        doc = await self.collection.find_one({"_id": ObjectId(conversation_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return Conversation(**doc)
        return None

    async def find_by_user(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> list[Conversation]:
        conversations = []
        cursor = (
            self.collection.find({"user_id": user_id})
            .sort("updated_at", -1)
            .skip(offset)
            .limit(limit)
        )
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            conversations.append(Conversation(**doc))
        return conversations

    async def add_message(self, conversation_id: str, message: Message) -> bool:
        result = await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {
                "$push": {"messages": message.model_dump()},
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )
        return result.modified_count > 0

    async def delete(self, conversation_id: str, user_id: str) -> bool:
        result = await self.collection.delete_one(
            {"_id": ObjectId(conversation_id), "user_id": user_id}
        )
        return result.deleted_count > 0
