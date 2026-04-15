from pydantic import BaseModel


class AgentCreate(BaseModel):
    name: str
    slug: str
    description: str
    tags: list[str] = []
    avatar_url: str | None = None
    system_prompt: str
    specializations: list[str] = []
    preferred_model: str | None = None
    fallback_models: list[str] = []
    temperature: float = 0.7
    max_tokens: int = 4096
    knowledge_base_ids: list[str] = []
    exemplar_set_ids: list[str] = []
    search_provider_ids: list[str] = []
    collaboration_capable: bool = False
    collaboration_role: str | None = None
    prompt_guard_sensitivity: str | None = None
    prompt_guard_action: str | None = None
    prompt_guard_custom_patterns: list[dict] = []
    prompt_guard_allow_llm_classification: bool = False


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    avatar_url: str | None = None
    system_prompt: str | None = None
    specializations: list[str] | None = None
    preferred_model: str | None = None
    fallback_models: list[str] | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    knowledge_base_ids: list[str] | None = None
    exemplar_set_ids: list[str] | None = None
    search_provider_ids: list[str] | None = None
    collaboration_capable: bool | None = None
    collaboration_role: str | None = None
    is_active: bool | None = None
    prompt_guard_sensitivity: str | None = None
    prompt_guard_action: str | None = None
    prompt_guard_custom_patterns: list[dict] | None = None
    prompt_guard_allow_llm_classification: bool | None = None


class AgentResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    tags: list[str] = []
    avatar_url: str | None
    specializations: list[str]
    preferred_model: str | None
    knowledge_base_ids: list[str] = []
    exemplar_set_ids: list[str] = []
    search_provider_ids: list[str] = []
    collaboration_capable: bool
    collaboration_role: str | None
    is_active: bool
    prompt_guard_sensitivity: str | None = None
    prompt_guard_action: str | None = None


class AgentDetailResponse(AgentResponse):
    system_prompt: str
    fallback_models: list[str]
    temperature: float
    max_tokens: int
    prompt_guard_custom_patterns: list[dict] = []
    prompt_guard_allow_llm_classification: bool = False
