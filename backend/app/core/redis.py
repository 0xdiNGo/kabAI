import redis.asyncio as aioredis


class RedisClient:
    client: aioredis.Redis | None = None

    async def connect(self, url: str) -> None:
        self.client = aioredis.from_url(url, decode_responses=True)

    async def disconnect(self) -> None:
        if self.client:
            await self.client.aclose()


redis_client = RedisClient()
