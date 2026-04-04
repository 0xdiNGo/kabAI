from datetime import datetime, timezone

from pydantic import BaseModel, Field


class Provider(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str  # "openai", "anthropic", "ollama", etc.
    display_name: str
    provider_type: str  # litellm provider prefix
    api_base: str | None = None
    api_key_encrypted: str | None = None
    is_enabled: bool = True
    models_cache: list[dict] | None = None
    models_cache_updated_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
