from datetime import datetime, timezone

from pydantic import BaseModel, Field


class PromptGuardResult(BaseModel):
    """Result of evaluating a message through the guard pipeline."""
    passed: bool  # True = message is allowed through
    action: str  # "allow" | "log" | "warn" | "sanitize" | "block"
    score: float  # 0.0 (clean) to 1.0 (definite injection)
    flags: list[str] = Field(default_factory=list)  # Which detectors triggered
    sanitized_content: str | None = None  # If action=sanitize, the cleaned version
    details: str | None = None  # Human-readable explanation


class PromptGuardLog(BaseModel):
    """Persisted record of a flagged message."""
    id: str | None = Field(None, alias="_id")
    conversation_id: str | None = None
    agent_id: str | None = None
    source: str = "web"  # "web" | "irc" | "discord" | "telegram"
    sender_name: str | None = None
    original_content: str = ""
    score: float = 0.0
    flags: list[str] = Field(default_factory=list)
    action_taken: str = "log"
    sensitivity: str = "medium"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
