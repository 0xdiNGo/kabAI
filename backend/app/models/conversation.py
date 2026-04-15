from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: str  # "user" | "assistant" | "system"
    content: str
    agent_id: str | None = None
    agent_name: str | None = None
    sender_name: str | None = None  # External sender (IRC nick, Discord user, etc.)
    model_used: str | None = None
    token_count: int | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Conversation(BaseModel):
    id: str | None = Field(None, alias="_id")
    user_id: str
    title: str | None = None
    agent_id: str | None = None  # None for raw model chat
    agent_ids: list[str] = Field(default_factory=list)  # for kabainet
    model: str | None = None  # set for raw model chats
    messages: list[Message] = Field(default_factory=list)
    is_collaboration: bool = False
    collaboration_mode: str | None = None  # "kabainet" | "orchestrator"
    summary: str | None = None  # AI-generated one-line summary
    last_agent_name: str | None = None  # Name of the last agent to respond
    # Connector source tracking
    source: str = "web"  # "web" | "irc" | "discord" | "telegram"
    connector_id: str | None = None  # Ref to connector config that owns this
    external_id: str | None = None  # e.g. "nick@irc.libera.chat" or "#channel@server"
    channel: str | None = None  # Channel/room name (e.g. "#kabai")
    participants: list[str] = Field(default_factory=list)  # External nicks/usernames
    # Takeover state
    is_taken_over: bool = False  # True = human operator has taken control
    takeover_user_id: str | None = None  # User who took over
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
