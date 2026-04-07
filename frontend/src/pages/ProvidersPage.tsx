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
  const [defaultIngestModel, setDefaultIngestModel] = useState<string | null>(null);
  const [selectedIngestDefault, setSelectedIngestDefault] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null);
  const [selectedEmbedding, setSelectedEmbedding] = useState("");
  const [maxRounds, setMaxRounds] = useState(3);
  const [editMaxRounds, setEditMaxRounds] = useState("3");
  const [ingestMaxItems, setIngestMaxItems] = useState(200);
  const [editIngestMaxItems, setEditIngestMaxItems] = useState("200");
  const [ingestMaxUrls, setIngestMaxUrls] = useState(10);
  const [editIngestMaxUrls, setEditIngestMaxUrls] = useState("10");
  const [kagiSummarizerEnabled, setKagiSummarizerEnabled] = useState(false);
  const [kagiSummarizerEngine, setKagiSummarizerEngine] = useState("cecil");
  const [hfEnabled, setHfEnabled] = useState(false);
  const [hfHasToken, setHfHasToken] = useState(false);
  const [hfToken, setHfToken] = useState("");
  const [hfSaving, setHfSaving] = useState(false);
  const [loraExpanded, setLoraExpanded] = useState<string | null>(null);
  const [loraForm, setLoraForm] = useState({ model_name: "", base_model: "", adapter_path: "", system_prompt: "" });
  const [loraCreating, setLoraCreating] = useState(false);
  const [loraError, setLoraError] = useState("");
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
    api.get<{
      default_model: string | null; default_ingest_model: string | null;
      embedding_model: string | null;
      max_background_chats: number; kabainet_max_rounds: number;
      ingest_max_items: number; ingest_max_urls: number;
      kagi_summarizer_enabled: boolean; kagi_summarizer_engine: string;
      huggingface_enabled: boolean; huggingface_has_token: boolean;
    }>("/settings").then((s) => {
      setDefaultModel(s.default_model);
      setSelectedDefault(s.default_model ?? "");
      setDefaultIngestModel(s.default_ingest_model);
      setSelectedIngestDefault(s.default_ingest_model ?? "");
      setEmbeddingModel(s.embedding_model);
      setSelectedEmbedding(s.embedding_model ?? "");
      setMaxBackgroundChats(s.max_background_chats);
      setEditMaxBg(String(s.max_background_chats));
      setMaxRounds(s.kabainet_max_rounds);
      setEditMaxRounds(String(s.kabainet_max_rounds));
      setIngestMaxItems(s.ingest_max_items);
      setEditIngestMaxItems(String(s.ingest_max_items));
      setIngestMaxUrls(s.ingest_max_urls);
      setEditIngestMaxUrls(String(s.ingest_max_urls));
      setKagiSummarizerEnabled(s.kagi_summarizer_enabled);
      setKagiSummarizerEngine(s.kagi_summarizer_engine);
      setHfEnabled(s.huggingface_enabled);
      setHfHasToken(s.huggingface_has_token);
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

  const saveIngestDefault = async () => {
    await api.put("/settings", { default_ingest_model: selectedIngestDefault || null });
    setDefaultIngestModel(selectedIngestDefault || null);
  };

  const saveEmbeddingModel = async () => {
    await api.put("/settings", { embedding_model: selectedEmbedding || null });
    setEmbeddingModel(selectedEmbedding || null);
  };

  const saveIngestLimits = async () => {
    const items = parseInt(editIngestMaxItems, 10);
    const urls = parseInt(editIngestMaxUrls, 10);
    if (isNaN(items) || isNaN(urls) || items < 1 || urls < 1) return;
    await api.put("/settings", { ingest_max_items: items, ingest_max_urls: urls });
    setIngestMaxItems(items);
    setIngestMaxUrls(urls);
  };

  const saveMaxRounds = async () => {
    const val = parseInt(editMaxRounds, 10);
    if (isNaN(val) || val < 1) return;
    await api.put("/settings", { kabainet_max_rounds: val });
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

      {/* Default Ingest Model */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">Default Ingestion Model</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Model for KB ingestion tasks (titling, analysis). Per-KB overrides take precedence.
        </p>
        <div className="flex gap-3">
          <select
            value={selectedIngestDefault}
            onChange={(e) => setSelectedIngestDefault(e.target.value)}
            className="flex-1 rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
          >
            <option value="">Same as agent default</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider_display_name})
              </option>
            ))}
          </select>
          <button
            onClick={saveIngestDefault}
            disabled={selectedIngestDefault === (defaultIngestModel ?? "")}
            className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* Embedding Model (Vector Search) */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">Embedding Model (Vector Search)</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Model for generating embeddings during ingestion and retrieval. Enables semantic search alongside keyword search. Leave empty for keyword-only.
        </p>
        <div className="flex gap-3">
          <select
            value={selectedEmbedding}
            onChange={(e) => setSelectedEmbedding(e.target.value)}
            className="flex-1 rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
          >
            <option value="">None (keyword search only)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider_display_name})
              </option>
            ))}
          </select>
          <button
            onClick={saveEmbeddingModel}
            disabled={selectedEmbedding === (embeddingModel ?? "")}
            className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
        {embeddingModel && (
          <p className="mt-2 text-sm text-matrix-text-faint">
            Current: <span className="text-matrix-text">{embeddingModel}</span>
          </p>
        )}
      </div>

      {/* Ingest Limits */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">Ingestion Limits</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Prevent runaway ingestion from consuming excessive tokens.
        </p>
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-xs text-matrix-text-faint mb-1">Max items per ingest</label>
            <input
              type="number"
              min="1"
              value={editIngestMaxItems}
              onChange={(e) => setEditIngestMaxItems(e.target.value)}
              className="w-24 rounded-lg bg-matrix-input px-3 py-2 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-matrix-text-faint mb-1">Max URLs (deep research)</label>
            <input
              type="number"
              min="1"
              value={editIngestMaxUrls}
              onChange={(e) => setEditIngestMaxUrls(e.target.value)}
              className="w-24 rounded-lg bg-matrix-input px-3 py-2 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
            />
          </div>
          <button
            onClick={saveIngestLimits}
            disabled={
              parseInt(editIngestMaxItems, 10) === ingestMaxItems &&
              parseInt(editIngestMaxUrls, 10) === ingestMaxUrls
            }
            className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
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

      {/* kabAInet Rounds */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">kabAInet Discussion Rounds</h2>
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

      {/* Kagi Summarizer */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">Kagi Universal Summarizer</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Automatically summarize URLs during KB ingestion, deep research, and chat. Requires a Kagi search provider with API key.
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={kagiSummarizerEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setKagiSummarizerEnabled(enabled);
                await api.put("/settings", { kagi_summarizer_enabled: enabled });
              }}
              className="h-4 w-4 rounded accent-matrix-accent"
            />
            <span className="text-sm text-matrix-text">Enable Kagi Summarizer</span>
          </label>
          {kagiSummarizerEnabled && (
            <div className="flex gap-3 items-center">
              <label className="text-xs text-matrix-text-faint">Engine:</label>
              <select
                value={kagiSummarizerEngine}
                onChange={async (e) => {
                  const engine = e.target.value;
                  setKagiSummarizerEngine(engine);
                  await api.put("/settings", { kagi_summarizer_engine: engine });
                }}
                className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
              >
                <option value="cecil">Cecil (friendly, general)</option>
                <option value="agnes">Agnes (technical, detailed)</option>
                <option value="muriel">Muriel (enterprise, $1/summary)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* HuggingFace Integration */}
      <div className="mb-6 rounded-xl bg-matrix-card p-5">
        <h2 className="font-semibold mb-3">HuggingFace Integration</h2>
        <p className="text-sm text-matrix-text-dim mb-3">
          Pull datasets into knowledge bases, import exemplar sets, and register LoRA adapters from HuggingFace.
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hfEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setHfEnabled(enabled);
                await api.put("/settings", { huggingface_enabled: enabled });
              }}
              className="h-4 w-4 rounded accent-matrix-accent"
            />
            <span className="text-sm text-matrix-text">Enable HuggingFace integration</span>
          </label>
          {hfEnabled && (
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs text-matrix-text-faint mb-1">
                  API Token {hfHasToken && <span className="text-matrix-accent">(configured)</span>}
                </label>
                <input
                  type="password"
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder={hfHasToken ? "Enter new token to replace" : "hf_..."}
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                />
              </div>
              <button
                onClick={async () => {
                  if (!hfToken.trim()) return;
                  setHfSaving(true);
                  try {
                    await api.put("/settings", { huggingface_token: hfToken });
                    setHfHasToken(true);
                    setHfToken("");
                  } finally {
                    setHfSaving(false);
                  }
                }}
                disabled={!hfToken.trim() || hfSaving}
                className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {hfSaving ? "Saving..." : "Save Token"}
              </button>
            </div>
          )}
          {hfEnabled && (
            <p className="text-xs text-matrix-text-faint">
              Optional. A token grants access to gated datasets and higher rate limits.
            </p>
          )}
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
              {/* LoRA Adapter Management for Ollama */}
              {p.provider_type === "ollama" && (
                <div className="mt-3">
                  <button
                    onClick={() => {
                      setLoraExpanded(loraExpanded === p.id ? null : p.id);
                      setLoraForm({ model_name: "", base_model: "", adapter_path: "", system_prompt: "" });
                      setLoraError("");
                    }}
                    className="text-xs text-matrix-text-dim hover:text-matrix-text-bright transition-colors"
                  >
                    {loraExpanded === p.id ? "▾ LoRA Adapters" : "▸ LoRA Adapters"}
                  </button>
                  {loraExpanded === p.id && (
                    <div className="mt-3 space-y-3 rounded-lg bg-matrix-bg/50 p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-matrix-text-faint mb-1">Model Name</label>
                          <input
                            value={loraForm.model_name}
                            onChange={(e) => setLoraForm({ ...loraForm, model_name: e.target.value })}
                            placeholder="e.g. llama3-finance-lora"
                            className="w-full rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-matrix-text-faint mb-1">Base Model</label>
                          <select
                            value={loraForm.base_model}
                            onChange={(e) => setLoraForm({ ...loraForm, base_model: e.target.value })}
                            className="w-full rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent"
                          >
                            <option value="">Select base model...</option>
                            {models.filter((m) => m.provider === p.name).map((m) => (
                              <option key={m.id} value={m.name}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">Adapter GGUF Path</label>
                        <input
                          value={loraForm.adapter_path}
                          onChange={(e) => setLoraForm({ ...loraForm, adapter_path: e.target.value })}
                          placeholder="/path/on/ollama/host/adapter.gguf"
                          className="w-full rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                        />
                        <p className="mt-1 text-xs text-matrix-text-faint">
                          Filesystem path on the Ollama host machine where the GGUF adapter file is located.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs text-matrix-text-faint mb-1">System Prompt (optional)</label>
                        <input
                          value={loraForm.system_prompt}
                          onChange={(e) => setLoraForm({ ...loraForm, system_prompt: e.target.value })}
                          placeholder="Bake a system prompt into the model"
                          className="w-full rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
                        />
                      </div>
                      {loraError && <p className="text-sm text-matrix-red">{loraError}</p>}
                      <button
                        onClick={async () => {
                          if (!loraForm.model_name || !loraForm.base_model || !loraForm.adapter_path) return;
                          setLoraCreating(true); setLoraError("");
                          try {
                            await api.post(`/providers/${p.id}/ollama/create-model`, {
                              model_name: loraForm.model_name,
                              base_model: loraForm.base_model,
                              adapter_path: loraForm.adapter_path,
                              system_prompt: loraForm.system_prompt || undefined,
                            });
                            setLoraForm({ model_name: "", base_model: "", adapter_path: "", system_prompt: "" });
                            loadModels();
                          } catch (err) {
                            setLoraError(err instanceof Error ? err.message : "Failed to create model");
                          } finally {
                            setLoraCreating(false);
                          }
                        }}
                        disabled={loraCreating || !loraForm.model_name || !loraForm.base_model || !loraForm.adapter_path}
                        className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {loraCreating ? "Registering..." : "Register Model"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
