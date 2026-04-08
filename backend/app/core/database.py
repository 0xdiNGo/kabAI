from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase


class Database:
    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None

    async def connect(self, url: str, db_name: str) -> None:
        self.client = AsyncIOMotorClient(
            url,
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            socketTimeoutMS=60000,
            maxIdleTimeMS=30000,   # recycle idle connections before the OS kills them
            heartbeatFrequencyMS=10000,  # detect dead connections proactively
        )
        self.db = self.client[db_name]

    async def disconnect(self) -> None:
        if self.client:
            self.client.close()


db = Database()
