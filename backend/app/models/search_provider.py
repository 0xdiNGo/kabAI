from datetime import datetime, timezone

from pydantic import BaseModel, Field


class SearchProvider(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str  # google, bing, kagi, brave, duckduckgo, searxng
    display_name: str
    api_key_encrypted: str | None = None
    api_base: str | None = None  # For SearXNG self-hosted
    custom_params: dict = Field(default_factory=dict)  # e.g. Google cx, Kagi plan
    is_enabled: bool = True
    is_default: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
