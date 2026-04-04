import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { Agent } from "@/types/agent";
import type { Conversation } from "@/types/conversation";
import type { ModelInfo } from "@/types/provider";

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [roundtableMode, setRoundtableMode] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const loadConversations = () => {
    api.get<Conversation[]>("/conversations").then(setConversations).catch(() => {});
  };

  useEffect(() => {
    api.get<Agent[]>("/agents").then(setAgents).catch(() => {});
    loadConversations();
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
  }, []);

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await api.delete(`/conversations/${id}`);
    loadConversations();
  };

  const startAgentChat = async (agentId: string) => {
    const res = await api.post<{ id: string }>("/conversations", { agent_id: agentId });
    navigate(`/chat/${res.id}`);
  };

  const startRawChat = async () => {
    if (!selectedModel) return;
    const res = await api.post<{ id: string }>("/conversations", { model: selectedModel });
    navigate(`/chat/${res.id}`);
  };

  const toggleAgentSelection = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const startRoundtable = async () => {
    if (selectedAgentIds.length < 2) return;
    const names = agents
      .filter((a) => selectedAgentIds.includes(a.id))
      .map((a) => a.name);
    const res = await api.post<{ id: string }>("/conversations", {
      agent_ids: selectedAgentIds,
      collaboration_mode: "roundtable",
      title: `Roundtable: ${names.join(", ")}`,
    });
    navigate(`/chat/${res.id}`);
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tiger Team</h1>
        {user?.role === "admin" && (
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/agents/manage")}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Manage Agents
            </button>
            <button
              onClick={() => navigate("/providers")}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Manage Providers
            </button>
          </div>
        )}
      </div>

      {/* Agents Grid */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Agents</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setRoundtableMode(!roundtableMode);
                setSelectedAgentIds([]);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                roundtableMode
                  ? "bg-matrix-purple text-matrix-bg"
                  : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"
              }`}
            >
              Roundtable
            </button>
          </div>
        </div>

        {roundtableMode && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-matrix-purple/10 border border-matrix-purple-dim px-4 py-3">
            <span className="text-sm text-matrix-purple">
              Select 2 or more agents for a roundtable discussion
            </span>
            <button
              onClick={startRoundtable}
              disabled={selectedAgentIds.length < 2}
              className="rounded-lg bg-matrix-purple px-4 py-2 text-sm font-medium hover:bg-matrix-purple-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Start Roundtable ({selectedAgentIds.length} selected)
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const isSelected = selectedAgentIds.includes(agent.id);
            return roundtableMode ? (
              <button
                key={agent.id}
                onClick={() => toggleAgentSelection(agent.id)}
                className={`rounded-xl p-5 text-left transition-colors ${
                  isSelected
                    ? "bg-matrix-purple/20 ring-2 ring-matrix-purple"
                    : "bg-matrix-card hover:bg-matrix-input"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{agent.name}</h3>
                  <div
                    className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "border-matrix-purple bg-matrix-purple"
                        : "border-matrix-border"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-3 w-3 text-matrix-bg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-matrix-text-dim">{agent.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {agent.specializations.map((s) => (
                    <span key={s} className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text">
                      {s}
                    </span>
                  ))}
                </div>
              </button>
            ) : (
              <button
                key={agent.id}
                onClick={() => startAgentChat(agent.id)}
                className="rounded-xl bg-matrix-card p-5 text-left hover:bg-matrix-input transition-colors"
              >
                <h3 className="font-semibold">{agent.name}</h3>
                <p className="mt-1 text-sm text-matrix-text-dim">{agent.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {agent.specializations.map((s) => (
                    <span key={s} className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text">
                      {s}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}

          {/* Raw model card (not in roundtable mode) */}
          {!roundtableMode && (
            <div className="rounded-xl bg-matrix-card p-5">
              <h3 className="font-semibold">Direct Model Chat</h3>
              <p className="mt-1 text-sm text-matrix-text-dim">Chat directly with any available model</p>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="mt-3 w-full rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright"
              >
                <option value="">Select a model...</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider_display_name})
                  </option>
                ))}
              </select>
              <button
                onClick={startRawChat}
                disabled={!selectedModel}
                className="mt-3 w-full rounded-lg bg-matrix-accent py-2 text-sm font-medium hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Start Chat
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Recent Conversations */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Recent Conversations</h2>
        {conversations.length === 0 ? (
          <p className="text-matrix-text-faint">No conversations yet</p>
        ) : (
          <div className="space-y-2">
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => navigate(`/chat/${c.id}`)}
                className="flex items-center justify-between rounded-lg bg-matrix-card px-4 py-3 hover:bg-matrix-input transition-colors cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{c.title ?? "Untitled"}</span>
                  {c.collaboration_mode && (
                    <span className="ml-2 rounded-full bg-matrix-purple-dim/30 px-2 py-0.5 text-xs text-matrix-purple">
                      {c.collaboration_mode}
                    </span>
                  )}
                  <span className="ml-2 text-sm text-matrix-text-faint">
                    {c.message_count} messages
                  </span>
                </div>
                <button
                  onClick={(e) => deleteConversation(e, c.id)}
                  className="ml-3 rounded-lg px-2 py-1 text-matrix-text-faint hover:text-matrix-red hover:bg-matrix-input transition-colors"
                  title="Delete conversation"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
