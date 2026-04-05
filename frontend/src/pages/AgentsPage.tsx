import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Agent } from "@/types/agent";
import type { ModelInfo } from "@/types/provider";

interface KB { id: string; name: string; description: string; item_count: number; }
interface ES { id: string; name: string; description: string; pair_count: number; }
interface SP { id: string; name: string; display_name: string; is_enabled: boolean; }

interface AgentForm {
  name: string;
  slug: string;
  description: string;
  tags: string;
  system_prompt: string;
  specializations: string;
  preferred_model: string;
  fallback_models: string;
  temperature: string;
  max_tokens: string;
  knowledge_base_ids: string[];
  exemplar_set_ids: string[];
  search_provider_ids: string[];
  collaboration_capable: boolean;
  collaboration_role: string;
}

const emptyForm: AgentForm = {
  name: "",
  slug: "",
  description: "",
  tags: "",
  system_prompt: "",
  specializations: "",
  preferred_model: "",
  fallback_models: "",
  temperature: "0.7",
  max_tokens: "4096",
  knowledge_base_ids: [],
  exemplar_set_ids: [],
  search_provider_ids: [],
  collaboration_capable: false,
  collaboration_role: "",
};

function agentToForm(agent: Agent & { system_prompt?: string; fallback_models?: string[]; temperature?: number; max_tokens?: number }): AgentForm {
  return {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    tags: (agent.tags ?? []).join(", "),
    system_prompt: agent.system_prompt ?? "",
    specializations: agent.specializations.join(", "),
    preferred_model: agent.preferred_model ?? "",
    fallback_models: (agent.fallback_models ?? []).join(", "),
    knowledge_base_ids: agent.knowledge_base_ids ?? [],
    exemplar_set_ids: agent.exemplar_set_ids ?? [],
    search_provider_ids: agent.search_provider_ids ?? [],
    temperature: String(agent.temperature ?? 0.7),
    max_tokens: String(agent.max_tokens ?? 4096),
    collaboration_capable: agent.collaboration_capable,
    collaboration_role: agent.collaboration_role ?? "",
  };
}

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [availableKBs, setAvailableKBs] = useState<KB[]>([]);
  const [availableES, setAvailableES] = useState<ES[]>([]);
  const [availableSP, setAvailableSP] = useState<SP[]>([]);
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [bulkModel, setBulkModel] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderInput, setBuilderInput] = useState("");
  const [building, setBuilding] = useState(false);
  const [builderResult, setBuilderResult] = useState<Record<string, unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [newTag, setNewTag] = useState("");

  const loadAgents = (tagOverride?: string) => {
    const tag = tagOverride !== undefined ? tagOverride : tagFilter;
    const params = new URLSearchParams({ limit: "1000", sort: "newest" });
    if (tag) params.set("tag", tag);
    api.get<{ agents: Agent[]; total: number; all_tags: string[] }>(`/agents?${params}`)
      .then((res) => { setAgents(res.agents); setAllTags(res.all_tags); })
      .catch(() => {});
  };

  useEffect(() => {
    loadAgents();
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
    api.get<KB[]>("/knowledge-bases").then(setAvailableKBs).catch(() => {});
    api.get<ES[]>("/exemplar-sets").then(setAvailableES).catch(() => {});
    api.get<SP[]>("/search-providers").then(setAvailableSP).catch(() => {});

    // Auto-open edit if ?edit=slug is in URL
    const editSlug = searchParams.get("edit");
    if (editSlug) {
      openEdit(editSlug);
      setSearchParams({}, { replace: true });
    }
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingSlug(null);
    setError("");
    setShowForm(true);
  };

  const openEdit = async (slug: string) => {
    try {
      const agent = await api.get<Agent & { system_prompt: string; fallback_models: string[]; temperature: number; max_tokens: number; knowledge_base_ids: string[] }>(
        `/agents/${slug}`
      );
      setForm(agentToForm(agent));
      setEditingSlug(slug);
      setError("");
      setShowForm(false); // Don't show top form — edit renders inline
    } catch {
      setError("Failed to load agent details");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        slug: form.slug,
        description: form.description,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        system_prompt: form.system_prompt,
        specializations: form.specializations
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        preferred_model: form.preferred_model,
        fallback_models: form.fallback_models
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        temperature: parseFloat(form.temperature) || 0.7,
        max_tokens: parseInt(form.max_tokens, 10) || 4096,
        knowledge_base_ids: form.knowledge_base_ids,
        exemplar_set_ids: form.exemplar_set_ids,
        search_provider_ids: form.search_provider_ids,
        collaboration_capable: form.collaboration_capable,
        collaboration_role: form.collaboration_role || null,
      };

      if (editingSlug) {
        const { slug: _, ...updates } = body;
        await api.put(`/agents/${editingSlug}`, updates);
      } else {
        await api.post("/agents", body);
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingSlug(null);
      loadAgents();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "Failed to save agent";
      setError(detail);
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async (slug: string) => {
    await api.delete(`/agents/${slug}`);
    loadAgents();
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm);
    setEditingSlug(null);
    setError("");
  };

  const toggleSelect = (slug: string) => {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const applyBulkModel = async () => {
    if (selectedSlugs.length === 0) return;
    await api.put("/agents/bulk-model", {
      agent_slugs: selectedSlugs,
      preferred_model: bulkModel || null,
    });
    setSelectedSlugs([]);
    setBulkModel("");
    loadAgents();
  };

  const runBuilder = async () => {
    if (!builderInput.trim()) return;
    setBuilding(true);
    setBuilderResult(null);
    try {
      const res = await api.post<{ profile?: Record<string, unknown>; error?: string }>("/agents/build", {
        description: builderInput,
      });
      if (res.error) {
        setError(res.error);
      } else if (res.profile) {
        setBuilderResult(res.profile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Builder failed");
    } finally {
      setBuilding(false);
    }
  };

  const useBuilderResult = () => {
    if (!builderResult) return;
    setForm({
      name: (builderResult.name as string) || "",
      slug: (builderResult.slug as string) || "",
      description: (builderResult.description as string) || "",
      tags: "",
      system_prompt: (builderResult.system_prompt as string) || "",
      specializations: ((builderResult.specializations as string[]) || []).join(", "),
      preferred_model: "",
      fallback_models: "",
      temperature: String(builderResult.temperature ?? 0.7),
      max_tokens: String(builderResult.max_tokens ?? 4096),
      knowledge_base_ids: [],
      exemplar_set_ids: [],
      search_provider_ids: [],
      collaboration_capable: true,
      collaboration_role: (builderResult.collaboration_role as string) || "specialist",
    });
    setEditingSlug(null);
    setShowForm(true);
    setShowBuilder(false);
    setBuilderResult(null);
    setBuilderInput("");
  };

  const addTagToSelected = async (tag: string) => {
    if (!tag.trim() || selectedSlugs.length === 0) return;
    for (const slug of selectedSlugs) {
      const agent = agents.find((a) => a.slug === slug);
      if (agent && !agent.tags.includes(tag.trim())) {
        await api.put(`/agents/${slug}`, { tags: [...agent.tags, tag.trim()] });
      }
    }
    setNewTag("");
    loadAgents();
  };

  const removeTagFromSelected = async (tag: string) => {
    if (!tag || selectedSlugs.length === 0) return;
    for (const slug of selectedSlugs) {
      const agent = agents.find((a) => a.slug === slug);
      if (agent && agent.tags.includes(tag)) {
        await api.put(`/agents/${slug}`, { tags: agent.tags.filter((t) => t !== tag) });
      }
    }
    loadAgents();
  };

  const exportSelected = async () => {
    if (selectedSlugs.length === 0) return;
    try {
      const archive = await api.post<{ version: number; agents: unknown[] }>("/agents/export", {
        slugs: selectedSlugs,
      });
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tiger-team-agents-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed");
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus("");

    try {
      const text = await file.text();
      const archive = JSON.parse(text);

      if (!archive.agents || !Array.isArray(archive.agents)) {
        setImportStatus("Invalid archive format: missing agents array");
        return;
      }

      const result = await api.post<{ created: number; skipped: number; skipped_slugs: string[] }>(
        "/agents/import",
        archive,
      );
      setImportStatus(
        `Imported ${result.created} agent${result.created !== 1 ? "s" : ""}` +
        (result.skipped > 0 ? `, skipped ${result.skipped} (already exist: ${result.skipped_slugs.join(", ")})` : "")
      );
      loadAgents();
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "Import failed");
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/")}
            className="text-sm text-matrix-text-dim hover:text-matrix-text-bright transition-colors"
          >
            &larr; Back to Dashboard
          </button>
          <h1 className="text-2xl font-bold mt-1">Agents</h1>
        </div>
        {!showForm && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowBuilder(!showBuilder)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${showBuilder ? "bg-matrix-purple text-matrix-bg" : "bg-matrix-card text-matrix-text hover:bg-matrix-input"}`}
            >
              AI Builder
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors"
            >
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              onClick={openCreate}
              className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors"
            >
              Create Agent
            </button>
          </div>
        )}
      </div>

      {/* AI Builder */}
      {showBuilder && (
        <div className="mb-6 rounded-xl bg-matrix-card border border-matrix-purple-dim p-6">
          <h2 className="text-lg font-semibold mb-2">AI Agent Builder</h2>
          <p className="text-sm text-matrix-text-dim mb-4">
            Describe the agent you want and AI will generate the full profile.
          </p>
          <div className="space-y-3">
            <textarea
              value={builderInput}
              onChange={(e) => setBuilderInput(e.target.value)}
              placeholder="Example: A sarcastic Kubernetes expert who loves to critique bad YAML and references Star Wars constantly"
              rows={3}
              className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-purple"
            />
            <div className="flex gap-2">
              <button
                onClick={runBuilder}
                disabled={building || !builderInput.trim()}
                className="rounded-lg bg-matrix-purple px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-purple-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {building ? "Generating..." : "Generate Agent"}
              </button>
              <button
                onClick={() => { setShowBuilder(false); setBuilderResult(null); setBuilderInput(""); }}
                className="rounded-lg bg-matrix-input px-4 py-2 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Builder Result Preview */}
            {builderResult && (
              <div className="rounded-lg bg-matrix-input p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-matrix-text-bright">{builderResult.name as string}</h3>
                    <p className="text-sm text-matrix-text-dim">{builderResult.description as string}</p>
                  </div>
                  <span className="rounded-full bg-matrix-purple-dim/30 px-2 py-0.5 text-xs text-matrix-purple">
                    {builderResult.collaboration_role as string}
                  </span>
                </div>
                <p className="text-xs text-matrix-text-faint">Slug: {builderResult.slug as string}</p>
                <div className="flex flex-wrap gap-1">
                  {((builderResult.specializations as string[]) || []).map((s) => (
                    <span key={s} className="rounded-full bg-matrix-card px-2 py-0.5 text-xs text-matrix-text">{s}</span>
                  ))}
                </div>
                <details className="text-xs">
                  <summary className="text-matrix-text-dim cursor-pointer">System prompt</summary>
                  <p className="mt-1 text-matrix-text whitespace-pre-wrap">{builderResult.system_prompt as string}</p>
                </details>
                <p className="text-xs text-matrix-text-faint">
                  Temperature: {builderResult.temperature as number} · Max tokens: {builderResult.max_tokens as number}
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={useBuilderResult}
                    className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors"
                  >
                    Use This Profile
                  </button>
                  <button
                    onClick={runBuilder}
                    disabled={building}
                    className="rounded-lg bg-matrix-input px-4 py-2 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Form (shown at top only for new agents) */}
      {showForm && !editingSlug && (
        <div className="mb-6 rounded-xl bg-matrix-card p-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingSlug ? "Edit Agent" : "Create Agent"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm({
                      ...form,
                      name,
                      ...(!editingSlug ? { slug: autoSlug(name) } : {}),
                    });
                  }}
                  placeholder="e.g. Security Expert"
                  required
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Slug</label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="e.g. security-expert"
                  required
                  disabled={!!editingSlug}
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-matrix-text-dim">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of this agent's expertise"
                required
                className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-matrix-text-dim">System Prompt</label>
              <textarea
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                placeholder="Instructions that define the agent's behavior..."
                rows={4}
                required
                className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-matrix-text-dim">
                Specializations <span className="text-matrix-text-faint">(comma-separated)</span>
              </label>
              <input
                value={form.specializations}
                onChange={(e) => setForm({ ...form, specializations: e.target.value })}
                placeholder="e.g. security, penetration-testing, compliance"
                className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Preferred Model</label>
                <select
                  value={form.preferred_model}
                  onChange={(e) => setForm({ ...form, preferred_model: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
                >
                  <option value="">Use system default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider_display_name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">
                  Fallback Models <span className="text-matrix-text-faint">(comma-separated IDs)</span>
                </label>
                <input
                  value={form.fallback_models}
                  onChange={(e) => setForm({ ...form, fallback_models: e.target.value })}
                  placeholder="e.g. openai/gpt-4o, ollama/llama3"
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Max Tokens</label>
                <input
                  type="number"
                  step="256"
                  min="256"
                  value={form.max_tokens}
                  onChange={(e) => setForm({ ...form, max_tokens: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Knowledge Bases</label>
                <div className="space-y-1 rounded-lg bg-matrix-input p-2 max-h-32 overflow-y-auto">
                  {availableKBs.length === 0 ? (
                    <p className="text-xs text-matrix-text-faint px-2 py-1">No knowledge bases available</p>
                  ) : (
                    availableKBs.map((kb) => (
                      <label key={kb.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-matrix-hover cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.knowledge_base_ids.includes(kb.id)}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...form.knowledge_base_ids, kb.id]
                              : form.knowledge_base_ids.filter((id) => id !== kb.id);
                            setForm({ ...form, knowledge_base_ids: ids });
                          }}
                          className="h-3.5 w-3.5 rounded accent-matrix-accent"
                        />
                        <span className="text-sm text-matrix-text">{kb.name}</span>
                        <span className="text-xs text-matrix-text-faint">({kb.item_count} items)</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Collaboration Role</label>
                <select
                  value={form.collaboration_role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      collaboration_role: e.target.value,
                      collaboration_capable: e.target.value !== "",
                    })
                  }
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
                >
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

            {error && <p className="text-sm text-matrix-red">{error}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-matrix-accent px-5 py-2.5 text-sm font-medium hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : editingSlug ? "Save Changes" : "Create Agent"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg bg-matrix-input px-5 py-2.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tag filter + management */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-matrix-text-faint">Filter:</span>
        <button
          onClick={() => { setTagFilter(""); loadAgents(""); }}
          className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${!tagFilter ? "bg-matrix-accent text-matrix-bg" : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"}`}
        >
          All
        </button>
        {allTags.map((t) => (
          <button
            key={t}
            onClick={() => { setTagFilter(t); loadAgents(t); }}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${tagFilter === t ? "bg-matrix-accent text-matrix-bg" : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"}`}
          >
            #{t}
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {selectedSlugs.length > 0 && (
        <div className="mb-4 rounded-lg bg-matrix-accent/10 border border-matrix-accent-hover px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-matrix-text">
              {selectedSlugs.length} selected
            </span>
            <span className="text-matrix-text-faint">|</span>

            {/* Add tag */}
            <div className="flex items-center gap-1">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTagToSelected(newTag)}
                placeholder="new tag"
                className="rounded bg-matrix-input px-2 py-1 text-xs text-matrix-text-bright placeholder-matrix-text-faint outline-none w-28"
              />
              <button
                onClick={() => addTagToSelected(newTag)}
                disabled={!newTag.trim()}
                className="rounded bg-matrix-accent px-2 py-1 text-xs text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 transition-colors"
              >
                + Tag
              </button>
            </div>

            {/* Quick tag buttons for common tags */}
            <button
              onClick={() => addTagToSelected("default-dashboard")}
              className="rounded bg-matrix-card px-2 py-1 text-xs text-matrix-text hover:bg-matrix-hover transition-colors"
            >
              + dashboard
            </button>

            {/* Remove tag from selected */}
            {allTags.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) { removeTagFromSelected(e.target.value); e.target.value = ""; } }}
                className="rounded bg-matrix-input px-2 py-1 text-xs text-matrix-text-bright outline-none"
                defaultValue=""
              >
                <option value="">Remove tag...</option>
                {allTags.map((t) => (<option key={t} value={t}>#{t}</option>))}
              </select>
            )}

            <span className="text-matrix-text-faint">|</span>

            {/* Model + Export + Cancel */}
            <select
              value={bulkModel}
              onChange={(e) => setBulkModel(e.target.value)}
              className="rounded bg-matrix-input px-2 py-1 text-xs text-matrix-text-bright outline-none"
            >
              <option value="">System default model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider_display_name})</option>
              ))}
            </select>
            <button onClick={applyBulkModel}
              className="rounded bg-matrix-accent px-2 py-1 text-xs text-matrix-bg hover:bg-matrix-accent-hover transition-colors">
              Set Model
            </button>
            <button onClick={exportSelected}
              className="rounded bg-matrix-card px-2 py-1 text-xs text-matrix-text hover:bg-matrix-hover transition-colors">
              Export
            </button>
            <button onClick={() => setSelectedSlugs([])}
              className="rounded bg-matrix-input px-2 py-1 text-xs text-matrix-text hover:bg-matrix-hover transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}


      {/* Import Status */}
      {importStatus && (
        <div className="mb-4 rounded-lg bg-matrix-card px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-matrix-text">{importStatus}</span>
          <button
            onClick={() => setImportStatus("")}
            className="text-matrix-text-faint hover:text-matrix-text-bright text-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Agent List */}
      {agents.length === 0 ? (
        <p className="text-matrix-text-faint">No agents configured yet. Create one to get started.</p>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.id}>
              <div className="rounded-xl bg-matrix-card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedSlugs.includes(agent.slug)}
                      onChange={() => toggleSelect(agent.slug)}
                      className="mt-1 h-4 w-4 rounded accent-matrix-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{agent.name}</h3>
                        {agent.collaboration_role && (
                          <span className="rounded-full bg-matrix-purple-dim/30 px-2 py-0.5 text-xs text-matrix-purple">
                            {agent.collaboration_role}
                          </span>
                        )}
                        {agent.knowledge_base_ids.length > 0 && (
                          <span className="rounded-full bg-matrix-accent-hover/30 px-2 py-0.5 text-xs text-matrix-accent">
                            {agent.knowledge_base_ids.length} KB{agent.knowledge_base_ids.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-matrix-text-dim">{agent.description}</p>
                      {agent.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {agent.tags.map((t) => (
                            <span key={t} className="rounded-full bg-matrix-card px-2 py-0.5 text-xs text-matrix-text-faint">#{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-matrix-text-faint">
                        <span>Model: {agent.preferred_model ?? "System default"}</span>
                        <span>Slug: {agent.slug}</span>
                      </div>
                      {agent.specializations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {agent.specializations.map((s) => (
                            <span
                              key={s}
                              className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="ml-4 flex gap-2">
                    <button
                      onClick={() => editingSlug === agent.slug ? closeForm() : openEdit(agent.slug)}
                      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        editingSlug === agent.slug
                          ? "bg-matrix-accent text-matrix-bg"
                          : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"
                      }`}
                    >
                      {editingSlug === agent.slug ? "Close" : "Edit"}
                    </button>
                    <button
                      onClick={() => deleteAgent(agent.slug)}
                      className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-red hover:bg-matrix-hover transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
              {/* Inline edit form */}
              {editingSlug === agent.slug && (
                <div className="mt-1 mb-2 rounded-xl bg-matrix-card border border-matrix-accent-hover p-6">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Name</label>
                        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Slug (read-only)</label>
                        <input value={form.slug} disabled
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none disabled:opacity-50" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-matrix-text-dim">Description</label>
                      <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required
                        className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-matrix-text-dim">System Prompt</label>
                      <textarea value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} rows={4} required
                        className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-matrix-text-dim">Specializations <span className="text-matrix-text-faint">(comma-separated)</span></label>
                      <input value={form.specializations} onChange={(e) => setForm({ ...form, specializations: e.target.value })}
                        className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Preferred Model</label>
                        <select value={form.preferred_model} onChange={(e) => setForm({ ...form, preferred_model: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent">
                          <option value="">Use system default</option>
                          {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.provider_display_name})</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Fallback Models <span className="text-matrix-text-faint">(comma-separated)</span></label>
                        <input value={form.fallback_models} onChange={(e) => setForm({ ...form, fallback_models: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Temperature</label>
                        <input type="number" step="0.1" min="0" max="1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Max Tokens</label>
                        <input type="number" step="256" min="256" value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: e.target.value })}
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Knowledge Bases</label>
                        <div className="space-y-1 rounded-lg bg-matrix-input p-2 max-h-32 overflow-y-auto">
                          {availableKBs.length === 0 ? (
                            <p className="text-xs text-matrix-text-faint px-2 py-1">No KBs available</p>
                          ) : (
                            availableKBs.map((kb) => (
                              <label key={kb.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-matrix-hover cursor-pointer">
                                <input type="checkbox" checked={form.knowledge_base_ids.includes(kb.id)}
                                  onChange={(e) => {
                                    const ids = e.target.checked ? [...form.knowledge_base_ids, kb.id] : form.knowledge_base_ids.filter((id) => id !== kb.id);
                                    setForm({ ...form, knowledge_base_ids: ids });
                                  }}
                                  className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                                <span className="text-sm text-matrix-text">{kb.name}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Exemplar Sets</label>
                        <div className="space-y-1 rounded-lg bg-matrix-input p-2 max-h-32 overflow-y-auto">
                          {availableES.length === 0 ? (
                            <p className="text-xs text-matrix-text-faint px-2 py-1">No exemplar sets available</p>
                          ) : (
                            availableES.map((es) => (
                              <label key={es.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-matrix-hover cursor-pointer">
                                <input type="checkbox" checked={form.exemplar_set_ids.includes(es.id)}
                                  onChange={(e) => {
                                    const ids = e.target.checked ? [...form.exemplar_set_ids, es.id] : form.exemplar_set_ids.filter((id) => id !== es.id);
                                    setForm({ ...form, exemplar_set_ids: ids });
                                  }}
                                  className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                                <span className="text-sm text-matrix-text">{es.name}</span>
                                <span className="text-xs text-matrix-text-faint">({es.pair_count})</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Search Providers</label>
                        <div className="space-y-1 rounded-lg bg-matrix-input p-2 max-h-32 overflow-y-auto">
                          {availableSP.length === 0 ? (
                            <p className="text-xs text-matrix-text-faint px-2 py-1">No search providers available</p>
                          ) : (
                            availableSP.map((sp) => (
                              <label key={sp.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-matrix-hover cursor-pointer">
                                <input type="checkbox" checked={form.search_provider_ids.includes(sp.id)}
                                  onChange={(e) => {
                                    const ids = e.target.checked ? [...form.search_provider_ids, sp.id] : form.search_provider_ids.filter((id) => id !== sp.id);
                                    setForm({ ...form, search_provider_ids: ids });
                                  }}
                                  className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                                <span className="text-sm text-matrix-text">{sp.display_name}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm text-matrix-text-dim">Collaboration Role</label>
                        <select value={form.collaboration_role}
                          onChange={(e) => setForm({ ...form, collaboration_role: e.target.value, collaboration_capable: e.target.value !== "" })}
                          className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent">
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
                    {error && <p className="text-sm text-matrix-red">{error}</p>}
                    <div className="flex gap-3">
                      <button type="submit" disabled={saving}
                        className="rounded-lg bg-matrix-accent px-5 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                      <button type="button" onClick={closeForm}
                        className="rounded-lg bg-matrix-input px-5 py-2.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
