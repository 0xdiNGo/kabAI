import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Connector, IRCConfig } from "@/types/connector";
import type { Agent } from "@/types/agent";

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-500",
  starting: "bg-yellow-500 animate-pulse",
  reconnecting: "bg-yellow-500 animate-pulse",
  error: "bg-red-500",
  stopped: "bg-matrix-text-faint",
};

const DEFAULT_IRC_CONFIG: IRCConfig = {
  server: "",
  port: 6697,
  use_tls: true,
  nick: "",
  username: null,
  realname: null,
  server_password: null,
  channels: [],
  sasl_mechanism: null,
  sasl_username: null,
  sasl_password: null,
  request_caps: [
    "sasl", "message-tags", "labeled-response", "echo-message",
    "server-time", "batch", "multi-prefix", "away-notify",
    "account-notify", "extended-join", "cap-notify", "chghost",
  ],
  command_prefix: "!",
  respond_to_highlights: true,
  channel_mode: "highlight",
  dm_mode: "always",
  flood_delay: 1.0,
  max_line_length: 450,
  reconnect_delay: 15,
  max_reconnect_attempts: 0,
  auto_rejoin: true,
};

export default function ConnectorsPage() {
  const navigate = useNavigate();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [ircServer, setIrcServer] = useState("");
  const [ircPort, setIrcPort] = useState(6697);
  const [ircNick, setIrcNick] = useState("");
  const [ircChannels, setIrcChannels] = useState("");
  const [ircUseTls, setIrcUseTls] = useState(true);
  const [channelMode, setChannelMode] = useState<"highlight" | "prefix" | "all">("highlight");

  const load = () => {
    Promise.all([
      api.get<Connector[]>("/connectors"),
      api.get<{ agents: Agent[] }>("/agents"),
    ]).then(([c, a]) => {
      setConnectors(c);
      setAgents(a.agents ?? a as unknown as Agent[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    const channels = ircChannels.split(",").map((c) => c.trim()).filter(Boolean);
    await api.post("/connectors", {
      name,
      connector_type: "irc",
      agent_id: agentId,
      irc_config: {
        ...DEFAULT_IRC_CONFIG,
        server: ircServer,
        port: ircPort,
        use_tls: ircUseTls,
        nick: ircNick,
        channels,
        channel_mode: channelMode,
      },
    });
    setShowCreate(false);
    setName(""); setIrcServer(""); setIrcNick(""); setIrcChannels("");
    load();
  };

  const toggleConnector = async (c: Connector) => {
    if (c.status === "connected" || c.status === "starting") {
      await api.post(`/connectors/${c.id}/stop`);
    } else {
      await api.post(`/connectors/${c.id}/start`);
    }
    load();
  };

  const deleteConnector = async (id: string) => {
    await api.delete(`/connectors/${id}`);
    load();
  };

  const getAgentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Unknown";

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-matrix-text-dim">Loading...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-matrix-text-bright">Connectors</h1>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors"
          >
            New Connector
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="mb-6 rounded-lg border border-matrix-border bg-matrix-card p-4 space-y-3">
            <h2 className="text-sm font-medium text-matrix-text-bright">New IRC Connector</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-matrix-text-dim">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My IRC Bot"
                  className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text" />
              </div>
              <div>
                <label className="text-xs text-matrix-text-dim">Agent</label>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
                  className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text">
                  <option value="">Select agent...</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-matrix-text-dim">IRC Server</label>
                <input value={ircServer} onChange={(e) => setIrcServer(e.target.value)} placeholder="irc.libera.chat"
                  className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-matrix-text-dim">Port</label>
                  <input type="number" value={ircPort} onChange={(e) => setIrcPort(+e.target.value)}
                    className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text" />
                </div>
                <div className="flex items-end pb-1 gap-2">
                  <input type="checkbox" checked={ircUseTls} onChange={(e) => setIrcUseTls(e.target.checked)} id="tls" />
                  <label htmlFor="tls" className="text-xs text-matrix-text-dim">TLS</label>
                </div>
              </div>
              <div>
                <label className="text-xs text-matrix-text-dim">Nick</label>
                <input value={ircNick} onChange={(e) => setIrcNick(e.target.value)} placeholder="kabai-bot"
                  className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text" />
              </div>
              <div>
                <label className="text-xs text-matrix-text-dim">Channels (comma-separated)</label>
                <input value={ircChannels} onChange={(e) => setIrcChannels(e.target.value)} placeholder="#kabai, #test"
                  className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text" />
              </div>
              <div>
                <label className="text-xs text-matrix-text-dim">Channel Mode</label>
                <select value={channelMode} onChange={(e) => setChannelMode(e.target.value as typeof channelMode)}
                  className="mt-1 w-full rounded bg-matrix-input border border-matrix-border px-3 py-1.5 text-sm text-matrix-text">
                  <option value="highlight">Highlight (respond when mentioned)</option>
                  <option value="prefix">Prefix (respond to !command)</option>
                  <option value="all">All (respond to everything)</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleCreate} disabled={!name || !agentId || !ircServer || !ircNick}
                className="rounded bg-matrix-accent px-4 py-1.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-40 transition-colors">
                Create
              </button>
              <button onClick={() => setShowCreate(false)}
                className="rounded px-4 py-1.5 text-sm text-matrix-text-dim hover:text-matrix-text transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Connector tiles */}
        {connectors.length === 0 && !showCreate ? (
          <div className="text-center py-20 text-matrix-text-dim">
            <p className="text-lg mb-2">No connectors yet</p>
            <p className="text-sm">Create one to bridge an AI agent to IRC, Discord, or Telegram.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connectors.map((c) => (
              <div key={c.id}
                className="rounded-lg border border-matrix-border bg-matrix-card p-4 hover:border-matrix-accent/40 transition-colors cursor-pointer"
                onClick={() => navigate(`/connectors/${c.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[c.status] ?? STATUS_COLORS.stopped}`} />
                    <div>
                      <h3 className="text-sm font-medium text-matrix-text-bright">{c.name}</h3>
                      <p className="text-xs text-matrix-text-dim mt-0.5">
                        {c.connector_type.toUpperCase()} &middot; {getAgentName(c.agent_id)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleConnector(c)}
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                        c.status === "connected" || c.status === "starting"
                          ? "bg-matrix-red/20 text-matrix-red hover:bg-matrix-red/30"
                          : "bg-matrix-green/20 text-matrix-green hover:bg-matrix-green/30"
                      }`}
                    >
                      {c.status === "connected" || c.status === "starting" ? "Stop" : "Start"}
                    </button>
                    <button
                      onClick={() => deleteConnector(c.id)}
                      className="rounded px-2 py-1 text-xs text-matrix-text-faint hover:text-matrix-red transition-colors"
                    >
                      Del
                    </button>
                  </div>
                </div>
                {c.irc_config && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded bg-matrix-surface px-2 py-0.5 text-[11px] text-matrix-text-dim">
                      {c.irc_config.server}:{c.irc_config.port}
                    </span>
                    {c.irc_config.channels.map((ch) => (
                      <span key={ch} className="rounded bg-matrix-accent/10 px-2 py-0.5 text-[11px] text-matrix-accent">
                        {ch}
                      </span>
                    ))}
                  </div>
                )}
                {c.status === "error" && c.status_message && (
                  <p className="mt-2 text-xs text-matrix-red truncate">{c.status_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
