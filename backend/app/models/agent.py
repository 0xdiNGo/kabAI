from datetime import datetime, timezone

from pydantic import BaseModel, Field


class Agent(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str
    slug: str
    description: str
    avatar_url: str | None = None
    system_prompt: str
    tags: list[str] = Field(default_factory=list)
    specializations: list[str] = Field(default_factory=list)
    preferred_model: str | None = None
    fallback_models: list[str] = Field(default_factory=list)
    temperature: float = 0.7
    max_tokens: int = 4096
    knowledge_base_ids: list[str] = Field(default_factory=list)
    exemplar_set_ids: list[str] = Field(default_factory=list)
    search_provider_ids: list[str] = Field(default_factory=list)  # Assigned search providers
    collaboration_capable: bool = False
    collaboration_role: str | None = None  # orchestrator | specialist | critic | synthesizer | researcher | devil_advocate
    # Prompt injection guard overrides (None = use global defaults)
    prompt_guard_sensitivity: str | None = None  # "off" | "low" | "medium" | "high"
    prompt_guard_action: str | None = None  # "log" | "warn" | "sanitize" | "block"
    prompt_guard_custom_patterns: list[dict] = Field(default_factory=list)
    prompt_guard_allow_llm_classification: bool = False
    created_by: str | None = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
