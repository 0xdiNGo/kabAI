from datetime import datetime, timezone

from pydantic import BaseModel, Field


class KnowledgeBase(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str
    description: str = ""
    ingest_model: str | None = None  # Model used for titling/analysis; None = system default
    created_by: str | None = None
    item_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class IngestBatch(BaseModel):
    """Tracks an ingestion operation for rollback."""
    id: str | None = Field(None, alias="_id")
    knowledge_base_id: str
    source: str | None = None
    item_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class KnowledgeItem(BaseModel):
    id: str | None = Field(None, alias="_id")
    knowledge_base_id: str
    batch_id: str | None = None  # Links to IngestBatch for rollback
    title: str
    content: str
    source: str | None = None
    chunk_index: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
