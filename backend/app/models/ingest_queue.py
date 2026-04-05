from datetime import datetime, timezone

from pydantic import BaseModel, Field


class IngestQueueItem(BaseModel):
    id: str | None = Field(None, alias="_id")
    kb_id: str
    batch_id: str
    job_id: str  # Groups all chunks from one document
    content: str
    source: str | None = None
    chunk_index: int = 0
    ai_titles: bool = False  # Use LLM for title generation (slower, costs tokens)
    state: str = "pending"  # pending | processing | done | failed
    title: str | None = None
    tokens_used: int = 0
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
