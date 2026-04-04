from datetime import datetime, timezone

from pydantic import BaseModel, Field


class Agent(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str
    slug: str
    description: str
    avatar_url: str | None = None
    system_prompt: str
    specializations: list[str] = Field(default_factory=list)
    preferred_model: str
    fallback_models: list[str] = Field(default_factory=list)
    temperature: float = 0.7
    max_tokens: int = 4096
    collaboration_capable: bool = False
    collaboration_role: str | None = None  # "orchestrator" | "specialist"
    created_by: str | None = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
