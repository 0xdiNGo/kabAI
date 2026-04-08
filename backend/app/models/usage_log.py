from datetime import datetime, timezone

from pydantic import BaseModel, Field


class UsageLog(BaseModel):
    """Tracks per-request API usage for cost analysis and model routing."""
    id: str | None = Field(None, alias="_id")
    provider: str  # "anthropic", "openai", "kagi", "ollama", "google", etc.
    model: str | None = None  # e.g. "anthropic/claude-sonnet-4-20250514", null for non-LLM APIs
    task_type: str  # "chat", "digest", "title", "search", "summarize", "embedding"
    tokens_in: int = 0
    tokens_out: int = 0
    total_tokens: int = 0
    cost_usd: float | None = None  # estimated cost from litellm or manual calculation
    balance_usd: float | None = None  # remaining balance (e.g. Kagi api_balance)
    duration_ms: int | None = None  # response time in milliseconds
    agent_id: str | None = None
    conversation_id: str | None = None
    kb_id: str | None = None
    metadata: dict | None = None  # extra provider-specific data
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
