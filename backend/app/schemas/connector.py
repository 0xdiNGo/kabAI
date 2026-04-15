from datetime import datetime

from pydantic import BaseModel

from app.models.connector import ConnectorRules, IRCConfig


class ConnectorCreate(BaseModel):
    name: str
    connector_type: str  # "irc" | "discord" | "telegram"
    agent_id: str
    is_enabled: bool = False
    auto_start: bool = False
    rules: ConnectorRules | None = None
    irc_config: IRCConfig | None = None


class ConnectorUpdate(BaseModel):
    name: str | None = None
    agent_id: str | None = None
    is_enabled: bool | None = None
    auto_start: bool | None = None
    rules: ConnectorRules | None = None
    irc_config: IRCConfig | None = None


class ConnectorResponse(BaseModel):
    id: str
    name: str
    connector_type: str
    owner_user_id: str
    agent_id: str
    is_enabled: bool
    auto_start: bool
    status: str
    status_message: str | None
    rules: ConnectorRules
    irc_config: IRCConfig | None
    last_connected_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ConnectorStatusResponse(BaseModel):
    status: str
    running: bool
    health: dict | None = None


class TakeoverRequest(BaseModel):
    take_over: bool


class ConnectorSendRequest(BaseModel):
    content: str
