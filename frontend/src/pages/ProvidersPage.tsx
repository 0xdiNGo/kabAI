import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ModelInfo, Provider } from "@/types/provider";
import { useThemeStore } from "@/stores/themeStore";
import { baseThemes, accents } from "@/lib/themes";

interface ModelRouterScore {
  model_id: string;
  provider: string;
  tier: number;
  cost_per_1k_input: number;
  cost_per_1k_output: number;
  avg_latency_ms: number;
  context_window: number;
  total_requests: number;
  efficiency_score: number;
}

interface ModelRouterData {
  auto_routing_enabled: boolean;
  recommendations: Record<string, string>;
  scores: ModelRouterScore[];
  models_evaluated?: number;
}

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

function AppearanceSection() {
  const themeId = useThemeStore((s) => s.themeId);
  const accentId = useThemeStore((s) => s.accentId);
  const glass = useThemeStore((s) => s.glass);
  const background = useThemeStore((s) => s.background);
  const rainBaseSpeed = useThemeStore((s) => s.rainBaseSpeed);
  const setThemeId = useThemeStore((s) => s.setThemeId);
  const setAccentId = useThemeStore((s) => s.setAccentId);
  const setGlass = useThemeStore((s) => s.setGlass);
  const setBackground = useThemeStore((s) => s.setBackground);
  const setRainBaseSpeed = useThemeStore((s) => s.setRainBaseSpeed);

  return (
    <div className="mb-6 rounded-xl bg-matrix-card p-5">
      <h2 className="font-semibold mb-1">Appearance</h2>
      <p className="text-xs text-matrix-text-faint mb-4">Theme and visual effects</p>

      {/* Base theme selector */}
      <div className="mb-4">
        <span className="text-sm text-matrix-text-dim block mb-2">Theme</span>
        <div className="flex flex-wrap gap-2">
          {baseThemes.map((t) => (
            <button
              key={t.id}
              onClick={() => setThemeId(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                themeId === t.id
                  ? "ring-2 ring-matrix-accent bg-matrix-input text-matrix-text-bright"
                  : "bg-matrix-input text-matrix-text-dim hover:text-matrix-text hover:bg-matrix-hover"
              }`}
            >
              <span
                className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle border border-matrix-border"
                style={{ backgroundColor: t.colors.bg }}
              />
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color selector */}
      <div className="mb-4">
        <span className="text-sm text-matrix-text-dim block mb-2">Accent Color</span>
        <div className="flex flex-wrap gap-2">
          {accents.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccentId(a.id)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                accentId === a.id
                  ? "ring-2 ring-matrix-accent bg-matrix-input text-matrix-text-bright"
                  : "bg-matrix-input text-matrix-text-dim hover:text-matrix-text hover:bg-matrix-hover"
              }`}
            >
              <span
                className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle border border-matrix-border"
                style={{ backgroundColor: a.color }}
              />
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {/* Glass toggle */}
      <div className="pt-3 border-t border-matrix-border">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={glass}
              onChange={(e) => setGlass(e.target.checked)}
            />
            <div className="w-10 h-6 rounded-full bg-matrix-input peer-checked:bg-matrix-accent transition-colors" />
            <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Glass Mode</p>
            <p className="text-xs text-matrix-text-faint">Semi-transparent panels with blur effect. Works with any theme.</p>
          </div>
        </label>
      </div>

      {/* Background */}
      <div className="pt-3 mt-3 border-t border-matrix-border">
        <span className="text-sm text-matrix-text-dim block mb-2">Background</span>
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            { id: "none", label: "None" },
            { id: "matrix-rain", label: "Matrix Rain" },
          ].map((bg) => (
            <button
              key={bg.id}
              onClick={() => setBackground(bg.id)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                background === bg.id
                  ? "ring-2 ring-matrix-accent bg-matrix-input text-matrix-text-bright"
                  : "bg-matrix-input text-matrix-text-dim hover:text-matrix-text hover:bg-matrix-hover"
              }`}
            >
              {bg.label}
            </button>
          ))}
        </div>

        {background === "matrix-rain" && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-matrix-text-dim shrink-0">Speed:</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(rainBaseSpeed * 100)}
              onChange={(e) => setRainBaseSpeed(Number(e.target.value) / 100)}
              className="flex-1 h-1.5 rounded-full appearance-none bg-matrix-input accent-matrix-accent"
            />
            <span className="text-xs text-matrix-text-faint w-8 text-right">{Math.round(rainBaseSpeed * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}


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
  const [modelRouter, setModelRouter] = useState<ModelRouterData | null>(null);
  const [routerEvaluating, setRouterEvaluating] = useState(false);
  const [routerScoresExpanded, setRouterScoresExpanded] = useState(false);
  const loadProviders = () => {
    api.get<Provider[]>("/providers").then(setProviders).catch(() => {});
  };

  const loadModels = () => {
    api.get<ModelInfo[]>("/providers/models/all").then(setModels).catch(() => {});
  };

  const loadModelRouter = () => {
    api.get<ModelRouterData>("/model-router/recommendations").then(setModelRouter).catch(() => {});
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
    loadModelRouter();
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
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors"
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

      {/* Appearance */}
      <AppearanceSection />

      {/* Model Router */}
      {(() => {
        const TASK_LABELS: Record<string, string> = {
          title: "Title Generation",
          chat: "Agent Chat",
          digest: "KB Digest",
          embedding: "Embeddings",
          summarize: "Summarization",
          search: "Search Routing",
          classify: "Classification",
          analysis: "Deep Analysis",
        };

        const TIER_LABELS: Record<number, { label: string; className: string }> = {
          0: { label: "embed", className: "bg-matrix-input text-matrix-text-faint" },
          1: { label: "basic", className: "bg-blue-900/40 text-blue-300" },
          2: { label: "balanced", className: "bg-yellow-900/40 text-yellow-300" },
          3: { label: "premium", className: "bg-purple-900/40 text-purple-300" },
        };

        const formatCost = (cost: number) =>
          cost === 0 ? "Free" : `$${cost.toFixed(4)}`;

        const shortModel = (modelId: string) => {
          const parts = modelId.split("/");
          return parts[parts.length - 1];
        };

        const TierBadge = ({ tier }: { tier: number }) => {
          const info = TIER_LABELS[tier] ?? { label: `tier${tier}`, className: "bg-matrix-input text-matrix-text-faint" };
          return (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.className}`}>
              {info.label}
            </span>
          );
        };

        const scoreForModel = (modelId: string): ModelRouterScore | undefined =>
          modelRouter?.scores.find((s) => s.model_id === modelId);

        return (
          <div className="mb-6 rounded-xl bg-matrix-card p-5">
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-semibold">Model Router</h2>
              <button
                onClick={async () => {
                  setRouterEvaluating(true);
                  try {
                    const result = await api.post<ModelRouterData>("/model-router/evaluate");
                    setModelRouter(result);
                  } finally {
                    setRouterEvaluating(false);
                  }
                }}
                disabled={routerEvaluating}
                className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {routerEvaluating ? "Evaluating..." : "Re-evaluate"}
              </button>
            </div>
            <p className="text-xs text-matrix-text-faint mb-4">
              Automatically assign the best available model to each task based on tier, cost, and latency.
            </p>

            {/* Auto-routing toggle */}
            <label className="flex items-center gap-3 cursor-pointer mb-4">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={modelRouter?.auto_routing_enabled ?? false}
                  onChange={async () => {
                    const result = await api.put<ModelRouterData>("/model-router/toggle");
                    setModelRouter(result);
                  }}
                />
                <div className="w-10 h-5 rounded-full bg-matrix-input peer-checked:bg-matrix-accent transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-matrix-text-faint peer-checked:bg-matrix-bg peer-checked:translate-x-5 transition-all" />
              </div>
              <span className="text-sm text-matrix-text">
                Auto-routing {modelRouter?.auto_routing_enabled ? "enabled" : "disabled"}
              </span>
            </label>

            {/* Task Assignments Table */}
            {modelRouter && Object.keys(modelRouter.recommendations).length > 0 && (
              <div className="mb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-matrix-text-faint border-b border-matrix-border">
                      <th className="pb-2 text-left font-medium">Task</th>
                      <th className="pb-2 text-left font-medium">Tier</th>
                      <th className="pb-2 text-left font-medium">Assigned Model</th>
                      <th className="pb-2 text-left font-medium">Provider</th>
                      <th className="pb-2 text-left font-medium">Cost/1k</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(modelRouter.recommendations).map(([task, modelId]) => {
                      const score = scoreForModel(modelId);
                      const label = TASK_LABELS[task] ?? task;
                      const provider = modelId.split("/")[0] ?? "";
                      return (
                        <tr key={task} className="border-b border-matrix-border last:border-0">
                          <td className="py-2 text-matrix-text">{label}</td>
                          <td className="py-2">
                            {score ? <TierBadge tier={score.tier} /> : <span className="text-matrix-text-faint">—</span>}
                          </td>
                          <td className="py-2 text-matrix-text-bright font-mono">{shortModel(modelId)}</td>
                          <td className="py-2 text-matrix-text-dim">{provider}</td>
                          <td className="py-2 text-matrix-text-dim">
                            {score
                              ? score.cost_per_1k_input === 0 && score.cost_per_1k_output === 0
                                ? "Free"
                                : `${formatCost(score.cost_per_1k_input)} / ${formatCost(score.cost_per_1k_output)}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Collapsible All Scored Models */}
            {modelRouter && modelRouter.scores.length > 0 && (
              <div>
                <button
                  onClick={() => setRouterScoresExpanded((v) => !v)}
                  className="text-xs text-matrix-text-dim hover:text-matrix-text-bright transition-colors"
                >
                  {routerScoresExpanded ? "▾ Hide scored models" : "▸ Show all scored models"}
                </button>
                {routerScoresExpanded && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-matrix-text-faint border-b border-matrix-border">
                          <th className="pb-2 text-left font-medium">Model</th>
                          <th className="pb-2 text-left font-medium">Provider</th>
                          <th className="pb-2 text-left font-medium">Tier</th>
                          <th className="pb-2 text-left font-medium">Input Cost</th>
                          <th className="pb-2 text-left font-medium">Output Cost</th>
                          <th className="pb-2 text-left font-medium">Avg Latency</th>
                          <th className="pb-2 text-left font-medium">Context</th>
                          <th className="pb-2 text-left font-medium">Requests</th>
                          <th className="pb-2 text-left font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...modelRouter.scores]
                          .sort((a, b) => b.efficiency_score - a.efficiency_score)
                          .map((s) => (
                            <tr key={s.model_id} className="border-b border-matrix-border last:border-0">
                              <td className="py-2 text-matrix-text-bright font-mono whitespace-nowrap">{shortModel(s.model_id)}</td>
                              <td className="py-2 text-matrix-text-dim">{s.provider}</td>
                              <td className="py-2"><TierBadge tier={s.tier} /></td>
                              <td className="py-2 text-matrix-text-dim">{formatCost(s.cost_per_1k_input)}</td>
                              <td className="py-2 text-matrix-text-dim">{formatCost(s.cost_per_1k_output)}</td>
                              <td className="py-2 text-matrix-text-dim">{s.avg_latency_ms > 0 ? `${s.avg_latency_ms}ms` : "—"}</td>
                              <td className="py-2 text-matrix-text-dim">{s.context_window > 0 ? s.context_window.toLocaleString() : "—"}</td>
                              <td className="py-2 text-matrix-text-dim">{s.total_requests}</td>
                              <td className="py-2 text-matrix-text">{s.efficiency_score.toFixed(3)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {!modelRouter && (
              <p className="text-xs text-matrix-text-faint">Loading model router data...</p>
            )}
          </div>
        );
      })()}

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
                className="rounded-lg bg-matrix-accent px-5 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
