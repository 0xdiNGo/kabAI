from datetime import datetime, timezone

from pydantic import BaseModel, Field


class SystemSettings(BaseModel):
    id: str | None = Field(None, alias="_id")
    default_model: str | None = None
    max_background_chats: int = 5
    roundtable_max_rounds: int = 3
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
