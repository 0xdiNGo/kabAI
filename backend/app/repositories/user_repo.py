from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.user import User


class UserRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.collection = db["users"]

    async def create(self, user: User) -> str:
        doc = user.model_dump(by_alias=True, exclude={"id"})
        result = await self.collection.insert_one(doc)
        return str(result.inserted_id)

    async def find_by_id(self, user_id: str) -> User | None:
        from bson import ObjectId

        doc = await self.collection.find_one({"_id": ObjectId(user_id)})
        if doc:
            doc["_id"] = str(doc["_id"])
            return User(**doc)
        return None

    async def find_by_username(self, username: str) -> User | None:
        doc = await self.collection.find_one({"username": username})
        if doc:
            doc["_id"] = str(doc["_id"])
            return User(**doc)
        return None

    async def find_by_email(self, email: str) -> User | None:
        doc = await self.collection.find_one({"email": email})
        if doc:
            doc["_id"] = str(doc["_id"])
            return User(**doc)
        return None

    async def find_by_oidc_subject(self, subject: str) -> User | None:
        doc = await self.collection.find_one({"oidc_subject": subject})
        if doc:
            doc["_id"] = str(doc["_id"])
            return User(**doc)
        return None
