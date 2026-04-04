import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Agent } from "@/types/agent";
import type { Conversation } from "@/types/conversation";
import type { ModelInfo } from "@/types/provider";

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Agent[]>("/agents").then(setAgents).catch(() => {});
    api.get<Conversation[]>("/conversations").then(setConversations).catch(() => {});
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
  }, []);

  const startAgentChat = async (agentId: string) => {
    const res = await api.post<{ id: string }>("/conversations", { agent_id: agentId });
    navigate(`/chat/${res.id}`);
  };

  const startRawChat = async () => {
    if (!selectedModel) return;
    const res = await api.post<{ id: string }>("/conversations", { model: selectedModel });
    navigate(`/chat/${res.id}`);
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold mb-6">Tiger Team</h1>

      {/* Agents Grid */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Agents</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => startAgentChat(agent.id)}
              className="rounded-xl bg-gray-900 p-5 text-left hover:bg-gray-800 transition-colors"
            >
              <h3 className="font-semibold">{agent.name}</h3>
              <p className="mt-1 text-sm text-gray-400">{agent.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {agent.specializations.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </button>
          ))}

          {/* Raw model card */}
          <div className="rounded-xl bg-gray-900 p-5">
            <h3 className="font-semibold">Direct Model Chat</h3>
            <p className="mt-1 text-sm text-gray-400">Chat directly with any available model</p>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="mt-3 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100"
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
              className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Start Chat
            </button>
          </div>
        </div>
      </section>

      {/* Recent Conversations */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Recent Conversations</h2>
        {conversations.length === 0 ? (
          <p className="text-gray-500">No conversations yet</p>
        ) : (
          <div className="space-y-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/chat/${c.id}`)}
                className="w-full rounded-lg bg-gray-900 px-4 py-3 text-left hover:bg-gray-800 transition-colors"
              >
                <span className="font-medium">{c.title ?? "Untitled"}</span>
                <span className="ml-2 text-sm text-gray-500">
                  {c.message_count} messages
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
