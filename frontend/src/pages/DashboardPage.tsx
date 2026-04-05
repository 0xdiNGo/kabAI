import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { HelpTip } from "@/components/Tooltip";
import type { Agent } from "@/types/agent";
import type { Conversation } from "@/types/conversation";
import type { ModelInfo } from "@/types/provider";

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentTotal, setAgentTotal] = useState(0);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>("default-dashboard");
  const [agentSearch, setAgentSearch] = useState("");
  const [agentSort, setAgentSort] = useState("newest");
  const [agentPage, setAgentPage] = useState(0);
  const PAGE_SIZE = 24;
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", description: "", tags: "", system_prompt: "",
    specializations: "", preferred_model: "", fallback_models: "",
    temperature: "0.7", max_tokens: "4096",
    knowledge_base_ids: [] as string[], exemplar_set_ids: [] as string[],
    search_provider_ids: [] as string[],
    collaboration_capable: false, collaboration_role: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [availableKBs, setAvailableKBs] = useState<{ id: string; name: string }[]>([]);
  const [availableES, setAvailableES] = useState<{ id: string; name: string }[]>([]);
  const [availableSP, setAvailableSP] = useState<{ id: string; display_name: string }[]>([]);
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

  const loadAgents = (tag?: string, search?: string, sort?: string, page?: number) => {
    const t = tag ?? selectedTag;
    const s = search ?? agentSearch;
    const so = sort ?? agentSort;
    const p = page ?? agentPage;
    const params = new URLSearchParams();
    if (t) params.set("tag", t);
    if (s) params.set("search", s);
    params.set("sort", so);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(p * PAGE_SIZE));
    api.get<{ agents: Agent[]; total: number; all_tags: string[] }>(`/agents?${params}`)
      .then((res) => {
        setAgents(res.agents);
        setAgentTotal(res.total);
        setAllTags(res.all_tags);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAgents();
    loadConversations();
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
    api.get<{ id: string; name: string }[]>("/knowledge-bases").then(setAvailableKBs).catch(() => {});
    api.get<{ id: string; name: string }[]>("/exemplar-sets").then(setAvailableES).catch(() => {});
    api.get<{ id: string; display_name: string }[]>("/search-providers").then(setAvailableSP).catch(() => {});
  }, []);

  const openInlineEdit = async (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    if (editingSlug === slug) { setEditingSlug(null); return; }
    try {
      const d = await api.get<{
        name: string; description: string; tags: string[]; system_prompt: string;
        specializations: string[]; preferred_model: string | null; fallback_models: string[];
        temperature: number; max_tokens: number;
        knowledge_base_ids: string[]; exemplar_set_ids: string[];
        search_provider_ids: string[];
        collaboration_capable: boolean; collaboration_role: string | null;
      }>(`/agents/${slug}`);
      setEditForm({
        name: d.name, description: d.description,
        tags: d.tags.join(", "), system_prompt: d.system_prompt,
        specializations: d.specializations.join(", "),
        preferred_model: d.preferred_model ?? "",
        fallback_models: d.fallback_models.join(", "),
        temperature: String(d.temperature), max_tokens: String(d.max_tokens),
        knowledge_base_ids: d.knowledge_base_ids ?? [],
        exemplar_set_ids: d.exemplar_set_ids ?? [],
        search_provider_ids: d.search_provider_ids ?? [],
        collaboration_capable: d.collaboration_capable,
        collaboration_role: d.collaboration_role ?? "",
      });
      setEditingSlug(slug);
    } catch { /* ignore */ }
  };

  const saveInlineEdit = async () => {
    if (!editingSlug) return;
    setEditSaving(true);
    try {
      await api.put(`/agents/${editingSlug}`, {
        name: editForm.name,
        description: editForm.description,
        tags: editForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        system_prompt: editForm.system_prompt,
        specializations: editForm.specializations.split(",").map((s) => s.trim()).filter(Boolean),
        preferred_model: editForm.preferred_model || null,
        fallback_models: editForm.fallback_models.split(",").map((s) => s.trim()).filter(Boolean),
        temperature: parseFloat(editForm.temperature) || 0.7,
        max_tokens: parseInt(editForm.max_tokens, 10) || 4096,
        knowledge_base_ids: editForm.knowledge_base_ids,
        exemplar_set_ids: editForm.exemplar_set_ids,
        search_provider_ids: editForm.search_provider_ids,
        collaboration_capable: editForm.collaboration_role !== "",
        collaboration_role: editForm.collaboration_role || null,
      });
    } catch { /* ignore */ }
    setEditSaving(false);
    setEditingSlug(null);
    loadAgents();
  };

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
              onClick={() => navigate("/knowledge-bases")}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Knowledge Bases
            </button>
            <button
              onClick={() => navigate("/exemplar-sets")}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Exemplar Sets
            </button>
            <button
              onClick={() => navigate("/agents/manage")}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Manage Agents
            </button>
            <button
              onClick={() => navigate("/search-providers")}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Search
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Agents <span className="text-sm text-matrix-text-faint font-normal">({agentTotal})</span></h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRoundtableMode(!roundtableMode); setSelectedAgentIds([]); }}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${roundtableMode ? "bg-matrix-purple text-matrix-bg" : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"}`}
            >
              Roundtable
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            value={agentSearch}
            onChange={(e) => { setAgentSearch(e.target.value); setAgentPage(0); loadAgents(undefined, e.target.value, undefined, 0); }}
            placeholder="Search agents..."
            className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none w-48"
          />
          <select
            value={selectedTag}
            onChange={(e) => { setSelectedTag(e.target.value); setAgentPage(0); loadAgents(e.target.value, undefined, undefined, 0); }}
            className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text-bright outline-none"
          >
            <option value="">All agents</option>
            {allTags.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
          <select
            value={agentSort}
            onChange={(e) => { setAgentSort(e.target.value); setAgentPage(0); loadAgents(undefined, undefined, e.target.value, 0); }}
            className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text-bright outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A-Z</option>
          </select>
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
              <div
                key={agent.id}
                className={`rounded-xl bg-matrix-card p-5 text-left transition-all relative ${editingSlug === agent.slug ? "ring-2 ring-matrix-accent z-10" : "hover:bg-matrix-input cursor-pointer"}`}
                onClick={() => { if (editingSlug !== agent.slug) startAgentChat(agent.id); }}
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold">{agent.name}</h3>
                  {user?.role === "admin" && (
                    <button
                      onClick={(e) => openInlineEdit(e, agent.slug)}
                      className={`rounded px-2 py-0.5 text-xs transition-colors ${editingSlug === agent.slug ? "bg-matrix-accent text-matrix-bg" : "text-matrix-text-faint hover:text-matrix-text hover:bg-matrix-card"}`}
                    >
                      {editingSlug === agent.slug ? "Close" : "Edit"}
                    </button>
                  )}
                </div>

                {/* Normal card content */}
                {editingSlug !== agent.slug && (
                  <>
                    {agent.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {agent.tags.map((t) => (<span key={t} className="text-xs text-matrix-text-faint">#{t}</span>))}
                      </div>
                    )}
                    <p className="mt-1 text-sm text-matrix-text-dim">{agent.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.specializations.map((s) => (
                        <span key={s} className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text">{s}</span>
                      ))}
                    </div>
                  </>
                )}

                {/* Inline edit form — full agent editor */}
                {editingSlug === agent.slug && (
                  <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Name</label>
                        <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Tags <span className="text-matrix-text-faint">(comma-sep)</span></label>
                        <input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-matrix-text-faint mb-1">Description</label>
                      <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-matrix-text-faint mb-1">System Prompt<HelpTip text="Instructions that define the agent's personality, expertise, and behavior." /></label>
                      <textarea value={editForm.system_prompt} onChange={(e) => setEditForm({ ...editForm, system_prompt: e.target.value })}
                        rows={4} className="w-full resize-none rounded-lg bg-matrix-input px-3 py-2 text-xs text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                    </div>
                    <div>
                      <label className="block text-xs text-matrix-text-faint mb-1">Specializations <span className="text-matrix-text-faint">(comma-sep)</span></label>
                      <input value={editForm.specializations} onChange={(e) => setEditForm({ ...editForm, specializations: e.target.value })}
                        className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Preferred Model<HelpTip text="Which LLM powers this agent. Falls back to system default." /></label>
                        <select value={editForm.preferred_model} onChange={(e) => setEditForm({ ...editForm, preferred_model: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none">
                          <option value="">System default</option>
                          {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.provider_display_name})</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Fallback Models <span className="text-matrix-text-faint">(comma-sep)</span></label>
                        <input value={editForm.fallback_models} onChange={(e) => setEditForm({ ...editForm, fallback_models: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Temperature<HelpTip text="Controls randomness. 0 = focused. 0.5 = balanced. 0.9+ = creative." /></label>
                        <input type="number" step="0.1" min="0" max="1" value={editForm.temperature}
                          onChange={(e) => setEditForm({ ...editForm, temperature: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Max Tokens<HelpTip text="Maximum response length in tokens (~4 chars each)." /></label>
                        <input type="number" step="256" min="256" value={editForm.max_tokens}
                          onChange={(e) => setEditForm({ ...editForm, max_tokens: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Collaboration Role<HelpTip text="How this agent behaves in roundtable discussions." /></label>
                        <select value={editForm.collaboration_role}
                          onChange={(e) => setEditForm({ ...editForm, collaboration_role: e.target.value, collaboration_capable: e.target.value !== "" })}
                          className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none">
                          <option value="">None</option>
                          <option value="orchestrator">Orchestrator</option>
                          <option value="specialist">Specialist</option>
                          <option value="critic">Critic</option>
                          <option value="synthesizer">Synthesizer</option>
                          <option value="researcher">Researcher</option>
                          <option value="devil_advocate">Devil's Advocate</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Knowledge Bases<HelpTip text="Reference material the agent searches to ground its answers." /></label>
                        <div className="space-y-0.5 rounded-lg bg-matrix-input p-1.5 max-h-24 overflow-y-auto">
                          {availableKBs.length === 0 ? <p className="text-xs text-matrix-text-faint px-1">None</p> : availableKBs.map((kb) => (
                            <label key={kb.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-matrix-hover cursor-pointer">
                              <input type="checkbox" checked={editForm.knowledge_base_ids.includes(kb.id)}
                                onChange={(e) => setEditForm({ ...editForm, knowledge_base_ids: e.target.checked ? [...editForm.knowledge_base_ids, kb.id] : editForm.knowledge_base_ids.filter((id) => id !== kb.id) })}
                                className="h-3 w-3 rounded accent-matrix-accent" />
                              <span className="text-xs text-matrix-text">{kb.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Exemplar Sets<HelpTip text="Example conversations that shape how the agent reasons." /></label>
                        <div className="space-y-0.5 rounded-lg bg-matrix-input p-1.5 max-h-24 overflow-y-auto">
                          {availableES.length === 0 ? <p className="text-xs text-matrix-text-faint px-1">None</p> : availableES.map((es) => (
                            <label key={es.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-matrix-hover cursor-pointer">
                              <input type="checkbox" checked={editForm.exemplar_set_ids.includes(es.id)}
                                onChange={(e) => setEditForm({ ...editForm, exemplar_set_ids: e.target.checked ? [...editForm.exemplar_set_ids, es.id] : editForm.exemplar_set_ids.filter((id) => id !== es.id) })}
                                className="h-3 w-3 rounded accent-matrix-accent" />
                              <span className="text-xs text-matrix-text">{es.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Search Providers<HelpTip text="Web search engines the agent can use during conversations." /></label>
                        <div className="space-y-0.5 rounded-lg bg-matrix-input p-1.5 max-h-24 overflow-y-auto">
                          {availableSP.length === 0 ? <p className="text-xs text-matrix-text-faint px-1">None configured</p> : availableSP.map((sp) => (
                            <label key={sp.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-matrix-hover cursor-pointer">
                              <input type="checkbox" checked={editForm.search_provider_ids.includes(sp.id)}
                                onChange={(e) => setEditForm({ ...editForm, search_provider_ids: e.target.checked ? [...editForm.search_provider_ids, sp.id] : editForm.search_provider_ids.filter((id) => id !== sp.id) })}
                                className="h-3 w-3 rounded accent-matrix-accent" />
                              <span className="text-xs text-matrix-text">{sp.display_name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveInlineEdit} disabled={editSaving}
                        className="rounded-lg bg-matrix-accent px-3 py-1.5 text-xs font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 transition-colors">
                        {editSaving ? "Saving..." : "Save"}
                      </button>
                      <button onClick={() => setEditingSlug(null)}
                        className="rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text hover:bg-matrix-hover transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
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

        {/* Pagination */}
        {agentTotal > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-matrix-text-faint">
              Showing {agentPage * PAGE_SIZE + 1}–{Math.min((agentPage + 1) * PAGE_SIZE, agentTotal)} of {agentTotal}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => { const p = agentPage - 1; setAgentPage(p); loadAgents(undefined, undefined, undefined, p); }}
                disabled={agentPage === 0}
                className="rounded px-3 py-1 text-xs text-matrix-text hover:bg-matrix-input disabled:opacity-30 transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => { const p = agentPage + 1; setAgentPage(p); loadAgents(undefined, undefined, undefined, p); }}
                disabled={(agentPage + 1) * PAGE_SIZE >= agentTotal}
                className="rounded px-3 py-1 text-xs text-matrix-text hover:bg-matrix-input disabled:opacity-30 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
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
