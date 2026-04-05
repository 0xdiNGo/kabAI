from datetime import datetime, timezone

from pydantic import BaseModel, Field


class ExemplarSet(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str
    description: str = ""
    source_dataset: str | None = None  # e.g. "ianncity/KIMI-K2.5-700000x"
    created_by: str | None = None
    pair_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ExemplarPair(BaseModel):
    id: str | None = Field(None, alias="_id")
    exemplar_set_id: str
    user_content: str
    assistant_content: str
    topic_tags: list[str] = Field(default_factory=list)
    source: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
