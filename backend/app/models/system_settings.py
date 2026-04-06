from datetime import datetime, timezone

from pydantic import BaseModel, Field


class SystemSettings(BaseModel):
    id: str | None = Field(None, alias="_id")
    default_model: str | None = None
    default_ingest_model: str | None = None
    max_background_chats: int = 5
    roundtable_max_rounds: int = 3
    ingest_max_items: int = 200
    ingest_max_urls: int = 10
    huggingface_enabled: bool = False
    huggingface_token_encrypted: str | None = None
    embedding_model: str | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
