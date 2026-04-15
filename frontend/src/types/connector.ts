export interface IRCConfig {
  server: string;
  port: number;
  use_tls: boolean;
  nick: string;
  username: string | null;
  realname: string | null;
  server_password: string | null;
  channels: string[];
  sasl_mechanism: string | null;
  sasl_username: string | null;
  sasl_password: string | null;
  request_caps: string[];
  command_prefix: string;
  respond_to_highlights: boolean;
  channel_mode: "highlight" | "prefix" | "all";
  dm_mode: "always" | "never";
  flood_delay: number;
  max_line_length: number;
  reconnect_delay: number;
  max_reconnect_attempts: number;
  auto_rejoin: boolean;
}

export interface ConnectorRules {
  max_response_length: number;
  cooldown_seconds: number;
  ignore_nicks: string[];
  allowed_nicks: string[];
  max_concurrent_conversations: number;
  idle_timeout_minutes: number;
  strip_formatting: boolean;
}

export interface Connector {
  id: string;
  name: string;
  connector_type: string;
  owner_user_id: string;
  agent_id: string;
  is_enabled: boolean;
  auto_start: boolean;
  status: "stopped" | "starting" | "connected" | "reconnecting" | "error";
  status_message: string | null;
  rules: ConnectorRules;
  irc_config: IRCConfig | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorHealth {
  connected: boolean;
  nick: string;
  server: string;
  channels: string[];
  negotiated_caps: string[];
  uptime_seconds: number;
  messages_handled: number;
  reconnect_count: number;
}

export interface ConnectorEvent {
  type: string;
  connector_id: string;
  timestamp: string;
  [key: string]: unknown;
}
