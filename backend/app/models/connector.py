from datetime import datetime, timezone

from pydantic import BaseModel, Field


class IRCConfig(BaseModel):
    server: str  # "irc.libera.chat"
    port: int = 6697
    use_tls: bool = True
    nick: str
    username: str | None = None  # IRC USER username (defaults to nick)
    realname: str | None = None  # IRC USER realname
    server_password: str | None = None  # Encrypted — server PASS
    channels: list[str] = Field(default_factory=list)  # ["#kabai", "#test"]
    # SASL authentication
    sasl_mechanism: str | None = None  # "PLAIN" | "EXTERNAL" | "SCRAM-SHA-256"
    sasl_username: str | None = None
    sasl_password: str | None = None  # Encrypted
    # IRCv3 capabilities to request
    request_caps: list[str] = Field(default_factory=lambda: [
        "sasl", "message-tags", "labeled-response", "echo-message",
        "server-time", "batch", "multi-prefix", "away-notify",
        "account-notify", "extended-join", "cap-notify", "chghost",
    ])
    # Behavior
    command_prefix: str = "!"  # Trigger prefix in channel mode
    respond_to_highlights: bool = True  # Respond when nick is mentioned
    channel_mode: str = "highlight"  # "highlight" | "prefix" | "all"
    dm_mode: str = "always"  # "always" | "never"
    flood_delay: float = 1.0  # Seconds between outgoing messages
    max_line_length: int = 450  # Auto-split responses at this length
    reconnect_delay: int = 15  # Seconds before reconnect attempt
    max_reconnect_attempts: int = 0  # 0 = infinite
    auto_rejoin: bool = True  # Rejoin channels after kick


class ConnectorRules(BaseModel):
    max_response_length: int = 2000  # Truncate total response
    cooldown_seconds: float = 2.0  # Per-user cooldown between responses
    ignore_nicks: list[str] = Field(default_factory=list)  # Bots to ignore
    allowed_nicks: list[str] = Field(default_factory=list)  # Empty = allow all
    max_concurrent_conversations: int = 20
    idle_timeout_minutes: int = 60  # Close stale conversations
    strip_formatting: bool = True  # Strip IRC color/bold codes from input


class Connector(BaseModel):
    id: str | None = Field(None, alias="_id")
    name: str
    connector_type: str  # "irc" | "discord" | "telegram"
    owner_user_id: str  # User who owns this connector
    agent_id: str  # Primary agent that handles conversations
    is_enabled: bool = False
    auto_start: bool = False  # Start on app boot
    status: str = "stopped"  # "stopped" | "starting" | "connected" | "reconnecting" | "error"
    status_message: str | None = None  # Error details, etc.
    rules: ConnectorRules = Field(default_factory=ConnectorRules)
    irc_config: IRCConfig | None = None  # Populated when connector_type == "irc"
    # Future: discord_config, telegram_config
    last_connected_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
