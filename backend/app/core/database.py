from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase


class Database:
    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None

    async def connect(self, url: str, db_name: str) -> None:
        self.client = AsyncIOMotorClient(url)
        self.db = self.client[db_name]

    async def disconnect(self) -> None:
        if self.client:
            self.client.close()


db = Database()
