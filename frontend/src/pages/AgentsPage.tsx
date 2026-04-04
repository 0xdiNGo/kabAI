import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Agent } from "@/types/agent";
import type { ModelInfo } from "@/types/provider";

interface AgentForm {
  name: string;
  slug: string;
  description: string;
  system_prompt: string;
  specializations: string;
  preferred_model: string;
  fallback_models: string;
  temperature: string;
  max_tokens: string;
  collaboration_capable: boolean;
  collaboration_role: string;
}

const emptyForm: AgentForm = {
  name: "",
  slug: "",
  description: "",
  system_prompt: "",
  specializations: "",
  preferred_model: "",
  fallback_models: "",
  temperature: "0.7",
  max_tokens: "4096",
  collaboration_capable: false,
  collaboration_role: "",
};

function agentToForm(agent: Agent & { system_prompt?: string; fallback_models?: string[]; temperature?: number; max_tokens?: number }): AgentForm {
  return {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    system_prompt: agent.system_prompt ?? "",
    specializations: agent.specializations.join(", "),
    preferred_model: agent.preferred_model ?? "",
    fallback_models: (agent.fallback_models ?? []).join(", "),
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
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [bulkModel, setBulkModel] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const loadAgents = () => {
    api.get<Agent[]>("/agents").then(setAgents).catch(() => {});
  };

  useEffect(() => {
    loadAgents();
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingSlug(null);
    setError("");
    setShowForm(true);
  };

  const openEdit = async (slug: string) => {
    try {
      const agent = await api.get<Agent & { system_prompt: string; fallback_models: string[]; temperature: number; max_tokens: number }>(
        `/agents/${slug}`
      );
      setForm(agentToForm(agent));
      setEditingSlug(slug);
      setError("");
      setShowForm(true);
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

      {/* Form */}
      {showForm && (
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

      {/* Bulk Model Bar */}
      {selectedSlugs.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-matrix-accent/10 border border-matrix-accent-hover px-4 py-3">
          <span className="text-sm text-matrix-text">
            {selectedSlugs.length} agent{selectedSlugs.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <select
              value={bulkModel}
              onChange={(e) => setBulkModel(e.target.value)}
              className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text-bright outline-none"
            >
              <option value="">System default</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider_display_name})
                </option>
              ))}
            </select>
            <button
              onClick={applyBulkModel}
              className="rounded-lg bg-matrix-accent px-3 py-1.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors"
            >
              Set Model
            </button>
            <button
              onClick={exportSelected}
              className="rounded-lg bg-matrix-card px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
            >
              Export
            </button>
            <button
              onClick={() => setSelectedSlugs([])}
              className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
            >
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
            <div key={agent.id} className="rounded-xl bg-matrix-card p-5">
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
                  </div>
                  <p className="mt-1 text-sm text-matrix-text-dim">{agent.description}</p>
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
                    onClick={() => openEdit(agent.slug)}
                    className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
                  >
                    Edit
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
          ))}
        </div>
      )}
    </div>
  );
}
