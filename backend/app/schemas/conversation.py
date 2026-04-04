from datetime import datetime

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    agent_id: str | None = None
    model: str | None = None  # required if agent_id is None
    title: str | None = None


class MessageSend(BaseModel):
    content: str


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    agent_id: str | None
    model_used: str | None
    created_at: datetime


class ConversationResponse(BaseModel):
    id: str
    title: str | None
    agent_id: str | None
    model: str | None
    message_count: int
    created_at: datetime
    updated_at: datetime


class ConversationDetailResponse(ConversationResponse):
    messages: list[MessageResponse]
