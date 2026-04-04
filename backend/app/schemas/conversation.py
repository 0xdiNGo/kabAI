from datetime import datetime

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    agent_id: str | None = None
    agent_ids: list[str] | None = None  # for roundtable
    collaboration_mode: str | None = None  # "roundtable"
    model: str | None = None  # required if agent_id is None and not roundtable
    title: str | None = None


class MessageSend(BaseModel):
    content: str


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    agent_id: str | None
    agent_name: str | None = None
    model_used: str | None
    created_at: datetime


class ConversationResponse(BaseModel):
    id: str
    title: str | None
    agent_id: str | None
    agent_ids: list[str] = []
    model: str | None
    is_collaboration: bool = False
    collaboration_mode: str | None = None
    message_count: int
    created_at: datetime
    updated_at: datetime


class ConversationDetailResponse(ConversationResponse):
    messages: list[MessageResponse]
