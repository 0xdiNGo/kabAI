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
        self, user_id: str, limit: int = 50, offset: int = 0,
        source: str | None = None,
    ) -> list[Conversation]:
        query: dict = {"user_id": user_id}
        if source:
            query["source"] = source
        conversations = []
        cursor = (
            self.collection.find(query)
            .sort("updated_at", -1)
            .skip(offset)
            .limit(limit)
        )
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            conversations.append(Conversation(**doc))
        return conversations

    async def find_by_external_id(
        self, connector_id: str, external_id: str,
    ) -> Conversation | None:
        doc = await self.collection.find_one({
            "connector_id": connector_id,
            "external_id": external_id,
        })
        if doc:
            doc["_id"] = str(doc["_id"])
            return Conversation(**doc)
        return None

    async def find_by_connector(
        self, connector_id: str, active_only: bool = False,
        limit: int = 50, offset: int = 0,
    ) -> list[Conversation]:
        query: dict = {"connector_id": connector_id}
        if active_only:
            query["is_taken_over"] = False
        conversations = []
        cursor = (
            self.collection.find(query)
            .sort("updated_at", -1)
            .skip(offset)
            .limit(limit)
        )
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            conversations.append(Conversation(**doc))
        return conversations

    async def set_takeover(
        self, conversation_id: str, is_taken_over: bool,
        takeover_user_id: str | None = None,
    ) -> bool:
        result = await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {"$set": {
                "is_taken_over": is_taken_over,
                "takeover_user_id": takeover_user_id,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return result.modified_count > 0

    async def update_participants(
        self, conversation_id: str, participants: list[str],
    ) -> bool:
        result = await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {"$set": {
                "participants": participants,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return result.modified_count > 0

    async def add_message(self, conversation_id: str, message: Message) -> bool:
        updates: dict = {"updated_at": datetime.now(timezone.utc)}
        # Track last agent name for conversation list display
        if message.role == "assistant" and message.agent_name:
            updates["last_agent_name"] = message.agent_name
        result = await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {
                "$push": {"messages": message.model_dump()},
                "$set": updates,
            },
        )
        return result.modified_count > 0

    async def update_title(self, conversation_id: str, title: str) -> None:
        await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {"$set": {"title": title}},
        )

    async def update_summary(self, conversation_id: str, summary: str) -> None:
        await self.collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {"$set": {"summary": summary}},
        )

    async def delete(self, conversation_id: str, user_id: str) -> bool:
        result = await self.collection.delete_one(
            {"_id": ObjectId(conversation_id), "user_id": user_id}
        )
        return result.deleted_count > 0
