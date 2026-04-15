import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Connector, ConnectorEvent, ConnectorHealth } from "@/types/connector";
import type { Conversation } from "@/types/conversation";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  connected: { label: "Connected", color: "text-matrix-green" },
  starting: { label: "Starting...", color: "text-matrix-amber" },
  reconnecting: { label: "Reconnecting...", color: "text-matrix-amber" },
  error: { label: "Error", color: "text-matrix-red" },
  stopped: { label: "Stopped", color: "text-matrix-text-faint" },
};

type Tab = "live" | "conversations" | "settings";

export default function ConnectorDetailPage() {
  const { connectorId } = useParams<{ connectorId: string }>();
  const navigate = useNavigate();
  const [connector, setConnector] = useState<Connector | null>(null);
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [events, setEvents] = useState<ConnectorEvent[]>([]);
  const [tab, setTab] = useState<Tab>("live");
  const [takeoverInput, setTakeoverInput] = useState<Record<string, string>>({});
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!connectorId) return;
    api.get<Connector>(`/connectors/${connectorId}`).then(setConnector).catch(() => navigate("/connectors"));
    api.get<{ status: string; running: boolean; health: ConnectorHealth | null }>(`/connectors/${connectorId}/status`)
      .then((s) => setHealth(s.health ?? null)).catch(() => {});
    api.get<Conversation[]>(`/connectors/${connectorId}/conversations?limit=50`)
      .then(setConversations).catch(() => {});
  }, [connectorId, navigate]);

  useEffect(load, [load]);

  // SSE for live events
  useEffect(() => {
    if (!connectorId) return;
    const token = localStorage.getItem("access_token");
    const es = new EventSource(`/api/v1/connectors/${connectorId}/events?token=${token}`);

    // EventSource doesn't support custom headers, so we use the SSE endpoint via fetch instead
    const ctrl = new AbortController();
    const connectSSE = async () => {
      try {
        const res = await fetch(`/api/v1/connectors/${connectorId}/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as ConnectorEvent;
                if (event.type !== "heartbeat") {
                  setEvents((prev) => [...prev.slice(-200), event]);
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      } catch {
        // Reconnect on failure (unless aborted)
      }
    };
    connectSSE();
    es.close(); // Close the unused EventSource

    return () => ctrl.abort();
  }, [connectorId]);

  // Auto-scroll events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const handleLifecycle = async (action: "start" | "stop" | "restart") => {
    if (!connectorId) return;
    await api.post(`/connectors/${connectorId}/${action}`);
    setTimeout(load, 1000);
  };

  const handleTakeover = async (conversationId: string, takeOver: boolean) => {
    if (!connectorId) return;
    if (takeOver) {
      await api.post(`/connectors/${connectorId}/conversations/${conversationId}/takeover`, { take_over: true });
    } else {
      await api.post(`/connectors/${connectorId}/conversations/${conversationId}/release`);
    }
    load();
  };

  const handleSend = async (conversationId: string) => {
    if (!connectorId) return;
    const content = takeoverInput[conversationId];
    if (!content?.trim()) return;
    await api.post(`/connectors/${connectorId}/conversations/${conversationId}/send`, { content });
    setTakeoverInput((prev) => ({ ...prev, [conversationId]: "" }));
  };

  if (!connector) {
    return <div className="flex-1 flex items-center justify-center text-matrix-text-dim">Loading...</div>;
  }

  const statusInfo = STATUS_LABELS[connector.status] ?? { label: "Unknown", color: "text-matrix-text-faint" };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button onClick={() => navigate("/connectors")}
              className="text-xs text-matrix-text-dim hover:text-matrix-accent transition-colors mb-1">
              &larr; Connectors
            </button>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-matrix-text-bright">{connector.name}</h1>
              <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
            </div>
            <p className="text-xs text-matrix-text-dim mt-0.5">
              {connector.connector_type.toUpperCase()}
              {connector.irc_config && ` \u00b7 ${connector.irc_config.server}:${connector.irc_config.port}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {connector.status === "connected" ? (
              <>
                <button onClick={() => handleLifecycle("restart")}
                  className="rounded bg-matrix-amber/20 px-3 py-1.5 text-xs font-medium text-matrix-amber hover:bg-matrix-amber/30">
                  Restart
                </button>
                <button onClick={() => handleLifecycle("stop")}
                  className="rounded bg-matrix-red/20 px-3 py-1.5 text-xs font-medium text-matrix-red hover:bg-matrix-red/30">
                  Stop
                </button>
              </>
            ) : (
              <button onClick={() => handleLifecycle("start")}
                className="rounded bg-matrix-green/20 px-3 py-1.5 text-xs font-medium text-matrix-green hover:bg-matrix-green/30">
                Start
              </button>
            )}
          </div>
        </div>

        {/* Health stats */}
        {health && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Uptime", value: `${Math.floor(health.uptime_seconds / 60)}m` },
              { label: "Messages", value: health.messages_handled.toString() },
              { label: "Channels", value: health.channels.length.toString() },
              { label: "Reconnects", value: health.reconnect_count.toString() },
            ].map((stat) => (
              <div key={stat.label} className="rounded border border-matrix-border bg-matrix-card p-3 text-center">
                <p className="text-lg font-semibold text-matrix-text-bright">{stat.value}</p>
                <p className="text-[11px] text-matrix-text-dim">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 border-b border-matrix-border mb-4">
          {(["live", "conversations", "settings"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-matrix-accent text-matrix-accent"
                  : "border-transparent text-matrix-text-dim hover:text-matrix-text"
              }`}>
              {t === "live" ? "Live Feed" : t === "conversations" ? "Conversations" : "Settings"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "live" && (
          <div className="rounded-lg border border-matrix-border bg-matrix-surface p-4 max-h-[60vh] overflow-y-auto font-mono text-xs">
            {events.length === 0 ? (
              <p className="text-matrix-text-faint text-center py-8">
                {connector.status === "connected" ? "Waiting for events..." : "Connector is not running"}
              </p>
            ) : (
              events.map((ev, i) => (
                <div key={i} className="flex gap-3 py-0.5 hover:bg-matrix-hover/30">
                  <span className="text-matrix-text-faint shrink-0 w-20">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={
                    ev.type === "message_received" ? "text-matrix-blue" :
                    ev.type === "message_sent" ? "text-matrix-green" :
                    ev.type === "status_changed" ? "text-matrix-amber" :
                    "text-matrix-text-dim"
                  }>
                    [{ev.type}]
                  </span>
                  <span className="text-matrix-text">
                    {ev.type === "message_received" && `${ev.sender as string} -> ${ev.target as string}: ${ev.content as string}`}
                    {ev.type === "message_sent" && `-> ${ev.target as string}: ${(ev.content as string)?.slice(0, 120)}`}
                    {ev.type === "status_changed" && `Status: ${ev.status as string}`}
                    {ev.type === "channel_joined" && `Joined ${ev.channel as string}`}
                  </span>
                </div>
              ))
            )}
            <div ref={eventsEndRef} />
          </div>
        )}

        {tab === "conversations" && (
          <div className="space-y-3">
            {conversations.length === 0 ? (
              <p className="text-matrix-text-dim text-center py-8">No conversations yet</p>
            ) : (
              conversations.map((convo) => (
                <div key={convo.id}
                  className="rounded-lg border border-matrix-border bg-matrix-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-matrix-text-bright">
                        {convo.channel ?? convo.title ?? "DM"}
                      </span>
                      <span className="rounded bg-matrix-surface px-2 py-0.5 text-[11px] text-matrix-text-dim">
                        {convo.source}
                      </span>
                      {convo.is_taken_over && (
                        <span className="rounded bg-matrix-amber/20 px-2 py-0.5 text-[11px] text-matrix-amber font-medium">
                          TAKEOVER
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-matrix-text-faint">{convo.message_count} msgs</span>
                      {convo.is_taken_over ? (
                        <button onClick={() => handleTakeover(convo.id, false)}
                          className="rounded bg-matrix-green/20 px-3 py-1 text-xs text-matrix-green hover:bg-matrix-green/30">
                          Release
                        </button>
                      ) : (
                        <button onClick={() => handleTakeover(convo.id, true)}
                          className="rounded bg-matrix-amber/20 px-3 py-1 text-xs text-matrix-amber hover:bg-matrix-amber/30">
                          Take Over
                        </button>
                      )}
                      <button onClick={() => navigate(`/chat/${convo.id}`)}
                        className="rounded px-3 py-1 text-xs text-matrix-text-dim hover:text-matrix-accent transition-colors">
                        View
                      </button>
                    </div>
                  </div>
                  {/* Takeover input */}
                  {convo.is_taken_over && (
                    <div className="flex gap-2 mt-2">
                      <input
                        value={takeoverInput[convo.id] ?? ""}
                        onChange={(e) => setTakeoverInput((prev) => ({ ...prev, [convo.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && handleSend(convo.id)}
                        placeholder="Type a message as the agent..."
                        className="flex-1 rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text"
                      />
                      <button onClick={() => handleSend(convo.id)}
                        className="rounded bg-matrix-accent px-4 py-1.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover">
                        Send
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "settings" && connector.irc_config && (
          <div className="rounded-lg border border-matrix-border bg-matrix-card p-4">
            <h3 className="text-sm font-medium text-matrix-text-bright mb-3">IRC Configuration</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["Server", `${connector.irc_config.server}:${connector.irc_config.port}`],
                ["TLS", connector.irc_config.use_tls ? "Yes" : "No"],
                ["Nick", connector.irc_config.nick],
                ["Channels", connector.irc_config.channels.join(", ") || "None"],
                ["Channel Mode", connector.irc_config.channel_mode],
                ["DM Mode", connector.irc_config.dm_mode],
                ["Command Prefix", connector.irc_config.command_prefix],
                ["Flood Delay", `${connector.irc_config.flood_delay}s`],
                ["Max Line Length", `${connector.irc_config.max_line_length}`],
                ["Auto Rejoin", connector.irc_config.auto_rejoin ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1 border-b border-matrix-border/50">
                  <span className="text-matrix-text-dim">{label}</span>
                  <span className="text-matrix-text">{value}</span>
                </div>
              ))}
            </div>
            <h3 className="text-sm font-medium text-matrix-text-bright mt-4 mb-3">Rules</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["Max Response Length", `${connector.rules.max_response_length}`],
                ["Cooldown", `${connector.rules.cooldown_seconds}s`],
                ["Max Concurrent", `${connector.rules.max_concurrent_conversations}`],
                ["Idle Timeout", `${connector.rules.idle_timeout_minutes}m`],
                ["Ignore Nicks", connector.rules.ignore_nicks.join(", ") || "None"],
                ["Allowed Nicks", connector.rules.allowed_nicks.join(", ") || "All"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1 border-b border-matrix-border/50">
                  <span className="text-matrix-text-dim">{label}</span>
                  <span className="text-matrix-text">{value}</span>
                </div>
              ))}
            </div>
            {health && (
              <>
                <h3 className="text-sm font-medium text-matrix-text-bright mt-4 mb-3">IRCv3 Capabilities</h3>
                <div className="flex flex-wrap gap-1.5">
                  {health.negotiated_caps.map((cap) => (
                    <span key={cap} className="rounded bg-matrix-accent/10 px-2 py-0.5 text-[11px] text-matrix-accent">
                      {cap}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
