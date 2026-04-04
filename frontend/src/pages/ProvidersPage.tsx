import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { ModelInfo, Provider } from "@/types/provider";

interface ProviderForm {
  name: string;
  display_name: string;
  provider_type: string;
  api_base: string;
  api_key: string;
}

const PROVIDER_PRESETS: Record<string, Partial<ProviderForm>> = {
  ollama: {
    name: "ollama",
    display_name: "Ollama",
    api_base: "",
  },
  openai: {
    name: "openai",
    display_name: "OpenAI",
    api_base: "",
  },
  anthropic: {
    name: "anthropic",
    display_name: "Anthropic",
    api_base: "",
  },
  google: {
    name: "google",
    display_name: "Google Gemini",
    api_base: "",
  },
};

const emptyForm: ProviderForm = {
  name: "",
  display_name: "",
  provider_type: "",
  api_base: "",
  api_key: "",
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [selectedDefault, setSelectedDefault] = useState("");
  const [maxBackgroundChats, setMaxBackgroundChats] = useState(5);
  const [editMaxBg, setEditMaxBg] = useState("5");
  const [maxRounds, setMaxRounds] = useState(3);
  const [editMaxRounds, setEditMaxRounds] = useState("3");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [testResults, setTestResults] = useState<Record<string, { status: string; detail?: string }>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const loadProviders = () => {
    api.get<Provider[]>("/providers").then(setProviders).catch(() => {});
  };

  const loadModels = () => {
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
  };

  const loadSettings = () => {
    api.get<{ default_model: string | null; max_background_chats: number; roundtable_max_rounds: number }>("/settings").then((s) => {
      setDefaultModel(s.default_model);
      setSelectedDefault(s.default_model ?? "");
      setMaxBackgroundChats(s.max_background_chats);
      setEditMaxBg(String(s.max_background_chats));
      setMaxRounds(s.roundtable_max_rounds);
      setEditMaxRounds(String(s.roundtable_max_rounds));
    }).catch(() => {});
  };

  useEffect(() => {
    loadProviders();
    loadModels();
    loadSettings();
  }, []);

  const saveDefaultModel = async () => {
    await api.put("/settings", { default_model: selectedDefault || null });
    setDefaultModel(selectedDefault || null);
  };

  const saveMaxBackground = async () => {
    const val = parseInt(editMaxBg, 10);
    if (isNaN(val) || val < 0) return;
    await api.put("/settings", { max_background_chats: val });
    setMaxBackgroundChats(val);
  };

  const saveMaxRounds = async () => {
    const val = parseInt(editMaxRounds, 10);
    if (isNaN(val) || val < 1) return;
    await api.put("/settings", { roundtable_max_rounds: val });
    setMaxRounds(val);
  };

  const selectPreset = (type: string) => {
    const preset = PROVIDER_PRESETS[type];
    if (preset) {
      setForm({ ...emptyForm, provider_type: type, ...preset });
    } else {
      setForm({ ...emptyForm, provider_type: type });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        display_name: form.display_name,
        provider_type: form.provider_type,
      };
      if (form.api_base) body.api_base = form.api_base;
      if (form.api_key) body.api_key = form.api_key;
      await api.post("/providers", body);
      setForm(emptyForm);
      setShowForm(false);
      loadProviders();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "Failed to create provider";
      setError(detail);
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: { status: "testing" } }));
    try {
      const res = await api.post<{ status: string; model_count?: number; detail?: string }>(
        `/providers/${id}/test`
      );
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: res.status, detail: res.status === "ok" ? `${res.model_count} models` : res.detail },
      }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { status: "error", detail: "Request failed" } }));
    }
  };

  const deleteProvider = async (id: string) => {
    await api.delete(`/providers/${id}`);
    loadProviders();
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
          <h1 className="text-2xl font-bold mt-1">LLM Providers</h1>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium hover:bg-matrix-accent-hover transition-colors"
          >
            Add Provider
          </button>
        )}
      </div>

      {/* Default Model */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">System Default Model</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Agents without a preferred model (or whose model is unavailable) will fall back to this.
        </p>
        <div className="flex gap-3">
          <select
            value={selectedDefault}
            onChange={(e) => setSelectedDefault(e.target.value)}
            className="flex-1 rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
          >
            <option value="">None (no default)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider_display_name})
              </option>
            ))}
          </select>
          <button
            onClick={saveDefaultModel}
            disabled={selectedDefault === (defaultModel ?? "")}
            className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
        {defaultModel && (
          <p className="mt-2 text-sm text-matrix-text-faint">
            Current default: <span className="text-matrix-text">{defaultModel}</span>
          </p>
        )}
      </div>

      {/* Background Chats */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">Background Chat Processing</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Max number of chats that continue processing when you navigate away. Excess chats are killed.
        </p>
        <div className="flex gap-3 items-center">
          <input
            type="number"
            min="0"
            max="50"
            value={editMaxBg}
            onChange={(e) => setEditMaxBg(e.target.value)}
            className="w-24 rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
          />
          <button
            onClick={saveMaxBackground}
            disabled={parseInt(editMaxBg, 10) === maxBackgroundChats}
            className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
          <span className="text-sm text-matrix-text-faint">
            Current: {maxBackgroundChats}
          </span>
        </div>
      </div>

      {/* Roundtable Rounds */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">Roundtable Discussion Rounds</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          How many rounds agents discuss before stopping. Agents pass when they have nothing to add — majority passing ends early.
        </p>
        <div className="flex gap-3 items-center">
          <input
            type="number"
            min="1"
            max="10"
            value={editMaxRounds}
            onChange={(e) => setEditMaxRounds(e.target.value)}
            className="w-24 rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
          />
          <button
            onClick={saveMaxRounds}
            disabled={parseInt(editMaxRounds, 10) === maxRounds}
            className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
          <span className="text-sm text-matrix-text-faint">
            Current: {maxRounds} rounds
          </span>
        </div>
      </div>

      {/* Add Provider Form */}
      {showForm && (
        <div className="mb-6 rounded-xl bg-matrix-card p-6">
          <h2 className="text-lg font-semibold mb-4">Add Provider</h2>

          {/* Preset Buttons */}
          <div className="mb-4">
            <label className="mb-2 block text-sm text-matrix-text-dim">Quick Setup</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PROVIDER_PRESETS).map(([type, preset]) => (
                <button
                  key={type}
                  onClick={() => selectPreset(type)}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    form.provider_type === type
                      ? "bg-matrix-accent text-matrix-bg"
                      : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"
                  }`}
                >
                  {preset.display_name}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. ollama"
                  required
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">Display Name</label>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="e.g. Ollama (Local)"
                  required
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm text-matrix-text-dim">Provider Type</label>
              <select
                value={form.provider_type}
                onChange={(e) => selectPreset(e.target.value)}
                required
                className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
              >
                <option value="">Select type...</option>
                <option value="ollama">Ollama</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google Gemini</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm text-matrix-text-dim">
                API Base URL{" "}
                <span className="text-matrix-text-faint">
                  {form.provider_type === "ollama" ? "(required)" : "(optional)"}
                </span>
              </label>
              <input
                value={form.api_base}
                onChange={(e) => setForm({ ...form, api_base: e.target.value })}
                placeholder={
                  form.provider_type === "ollama"
                    ? "http://192.168.x.x:11434"
                    : "Leave blank for default"
                }
                className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
              />
            </div>

            {form.provider_type !== "ollama" && (
              <div>
                <label className="mb-1 block text-sm text-matrix-text-dim">API Key</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
            )}

            {error && <p className="text-sm text-matrix-red">{error}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-matrix-accent px-5 py-2.5 text-sm font-medium hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : "Add Provider"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(emptyForm);
                  setError("");
                }}
                className="rounded-lg bg-matrix-input px-5 py-2.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Provider List */}
      {providers.length === 0 ? (
        <p className="text-matrix-text-faint">No providers configured yet. Add one to get started.</p>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div key={p.id} className="rounded-xl bg-matrix-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.display_name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.is_enabled ? "bg-matrix-accent-hover text-matrix-accent" : "bg-matrix-input text-matrix-text-faint"
                      }`}
                    >
                      {p.is_enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-matrix-text-dim">
                    <span>Type: {p.provider_type}</span>
                    {p.api_base && <span>URL: {p.api_base}</span>}
                    <span>{p.has_api_key ? "API key configured" : "No API key"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => testProvider(p.id)}
                    className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => deleteProvider(p.id)}
                    className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-red hover:bg-matrix-hover transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {(() => {
                const result = testResults[p.id];
                if (!result) return null;
                return (
                  <div
                    className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                      result.status === "ok"
                        ? "bg-matrix-accent-hover/30 text-matrix-accent"
                        : result.status === "testing"
                          ? "bg-matrix-input text-matrix-text-dim"
                          : "bg-matrix-red/10 text-matrix-red"
                    }`}
                  >
                    {result.status === "testing"
                      ? "Testing connection..."
                      : result.status === "ok"
                        ? `Connected — ${result.detail}`
                        : `Error: ${result.detail}`}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
