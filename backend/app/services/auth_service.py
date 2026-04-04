from app.core.exceptions import AuthenticationError, ConflictError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.repositories.user_repo import UserRepository


class AuthService:
    def __init__(self, user_repo: UserRepository, redis_client):
        self.user_repo = user_repo
        self.redis = redis_client

    async def register(
        self, username: str, email: str, password: str, display_name: str | None = None
    ) -> str:
        if await self.user_repo.find_by_username(username):
            raise ConflictError(f"Username '{username}' already taken")
        if await self.user_repo.find_by_email(email):
            raise ConflictError(f"Email '{email}' already registered")

        user = User(
            username=username,
            email=email,
            password_hash=hash_password(password),
            display_name=display_name or username,
        )
        return await self.user_repo.create(user)

    async def login(self, username: str, password: str) -> tuple[str, str]:
        """Returns (access_token, refresh_token)."""
        user = await self.user_repo.find_by_username(username)
        if not user or not user.password_hash:
            raise AuthenticationError()
        if not verify_password(password, user.password_hash):
            raise AuthenticationError()

        access_token = create_access_token(user.id, user.role)
        refresh_token, jti = create_refresh_token(user.id)

        # Store refresh token JTI in Redis for revocation checks
        from app.config import settings

        await self.redis.set(
            f"refresh:{user.id}:{jti}",
            "valid",
            ex=settings.jwt_refresh_expiration_days * 86400,
        )
        return access_token, refresh_token

    async def refresh(self, refresh_token: str) -> tuple[str, str]:
        """Rotate refresh token. Returns (new_access_token, new_refresh_token)."""
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            raise AuthenticationError("Invalid refresh token")

        user_id = payload["sub"]
        jti = payload["jti"]

        # Check if refresh token is still valid in Redis
        key = f"refresh:{user_id}:{jti}"
        if not await self.redis.get(key):
            raise AuthenticationError("Refresh token revoked or expired")

        # Revoke old refresh token
        await self.redis.delete(key)

        user = await self.user_repo.find_by_id(user_id)
        if not user:
            raise AuthenticationError("User not found")

        access_token = create_access_token(user.id, user.role)
        new_refresh_token, new_jti = create_refresh_token(user.id)

        from app.config import settings

        await self.redis.set(
            f"refresh:{user.id}:{new_jti}",
            "valid",
            ex=settings.jwt_refresh_expiration_days * 86400,
        )
        return access_token, new_refresh_token
