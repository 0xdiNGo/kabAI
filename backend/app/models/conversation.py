from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: str  # "user" | "assistant" | "system"
    content: str
    agent_id: str | None = None
    model_used: str | None = None
    token_count: int | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Conversation(BaseModel):
    id: str | None = Field(None, alias="_id")
    user_id: str
    title: str | None = None
    agent_id: str | None = None  # None for raw model chat
    model: str | None = None  # set for raw model chats
    messages: list[Message] = Field(default_factory=list)
    is_collaboration: bool = False
    collaboration_session_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
