from pydantic import BaseModel


class AgentCreate(BaseModel):
    name: str
    slug: str
    description: str
    avatar_url: str | None = None
    system_prompt: str
    specializations: list[str] = []
    preferred_model: str | None = None
    fallback_models: list[str] = []
    temperature: float = 0.7
    max_tokens: int = 4096
    collaboration_capable: bool = False
    collaboration_role: str | None = None


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    avatar_url: str | None = None
    system_prompt: str | None = None
    specializations: list[str] | None = None
    preferred_model: str | None = None
    fallback_models: list[str] | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    collaboration_capable: bool | None = None
    collaboration_role: str | None = None
    is_active: bool | None = None


class AgentResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    avatar_url: str | None
    specializations: list[str]
    preferred_model: str | None
    collaboration_capable: bool
    collaboration_role: str | None
    is_active: bool


class AgentDetailResponse(AgentResponse):
    system_prompt: str
    fallback_models: list[str]
    temperature: float
    max_tokens: int
