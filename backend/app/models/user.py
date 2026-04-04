from datetime import datetime, timezone

from pydantic import BaseModel, Field


class User(BaseModel):
    id: str | None = Field(None, alias="_id")
    username: str
    email: str
    password_hash: str | None = None
    auth_provider: str = "local"  # "local" | "oidc"
    oidc_subject: str | None = None
    display_name: str
    role: str = "user"  # "user" | "admin"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
