import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface SP { id: string; name: string; display_name: string; api_base: string | null; has_api_key: boolean; custom_params: Record<string, string>; is_enabled: boolean; is_default: boolean; }

const PRESETS: Record<string, { display_name: string; needs_key: boolean; fields: string[]; description: string }> = {
  kagi: { display_name: "Kagi Search", needs_key: true, fields: ["mode"], description: "Search: ranked results. FastGPT: AI-synthesized answers with citations. Enrich: non-commercial web/news." },
  google: { display_name: "Google Custom Search", needs_key: true, fields: ["cx"], description: "Requires a Custom Search Engine ID (cx) from Google." },
  bing: { display_name: "Bing Web Search", needs_key: true, fields: [], description: "Microsoft Bing Web Search API v7." },
  brave: { display_name: "Brave Search", needs_key: true, fields: [], description: "Privacy-focused web search API." },
  duckduckgo: { display_name: "DuckDuckGo", needs_key: false, fields: [], description: "Free Instant Answer API. Limited but no API key needed." },
  searxng: { display_name: "SearXNG (self-hosted)", needs_key: false, fields: ["api_base"], description: "Self-hosted meta search engine. Set your instance URL." },
};

export default function SearchProvidersPage() {
  const [providers, setProviders] = useState<SP[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", display_name: "", api_key: "", api_base: "", cx: "", mode: "search" });
  const [testResult, setTestResult] = useState("");
  const navigate = useNavigate();

  const load = () => { api.get<SP[]>("/search-providers").then(setProviders).catch(() => {}); };
  useEffect(() => { load(); }, []);

  const selectPreset = (name: string) => {
    const p = PRESETS[name];
    if (p) setForm({ ...form, name, display_name: p.display_name, api_key: "", api_base: "", cx: "", mode: "search" });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const custom_params: Record<string, string> = {};
    if (form.cx) custom_params.cx = form.cx;
    if (form.name === "kagi" && form.mode !== "search") custom_params.mode = form.mode;
    await api.post("/search-providers", {
      name: form.name, display_name: form.display_name,
      api_key: form.api_key || null, api_base: form.api_base || null,
      custom_params, is_enabled: true,
    });
    setForm({ name: "", display_name: "", api_key: "", api_base: "", cx: "", mode: "search" });
    setShowCreate(false); load();
  };

  const setDefault = async (id: string) => {
    await api.post(`/search-providers/${id}/set-default`, {});
    load();
  };

  const del = async (id: string) => {
    await api.delete(`/search-providers/${id}`);
    load();
  };

  const testSearch = async () => {
    setTestResult("Testing...");
    try {
      const res = await api.post<{ results: number; items: { title: string }[] }>("/search-providers/test", {});
      setTestResult(`OK: ${res.results} results — ${res.items.map((i) => i.title).join(", ")}`);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Test failed");
    }
  };

  const preset = form.name ? PRESETS[form.name] : null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button onClick={() => navigate("/")} className="text-sm text-matrix-text-dim hover:text-matrix-text-bright transition-colors">&larr; Dashboard</button>
          <h1 className="text-2xl font-bold mt-1">Search Providers</h1>
          <p className="text-sm text-matrix-text-dim mt-1">Configure web search for agents. Assign providers to agents to enable tool-use search.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={testSearch} className="rounded-lg bg-matrix-card px-4 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors">Test Default</button>
          <button onClick={() => setShowCreate(true)} className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">Add Provider</button>
        </div>
      </div>

      {testResult && <p className="mb-4 text-sm text-matrix-text-dim">{testResult}</p>}

      {showCreate && (
        <div className="mb-6 rounded-xl bg-matrix-card p-5">
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button key={key} onClick={() => selectPreset(key)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${form.name === key ? "bg-matrix-accent text-matrix-bg" : "bg-matrix-input text-matrix-text hover:bg-matrix-hover"}`}>
                {p.display_name}
              </button>
            ))}
          </div>
          {form.name && preset && (
            <p className="text-xs text-matrix-text-dim mb-3">{preset.description}</p>
          )}
          {form.name && (
            <form onSubmit={create} className="space-y-3">
              <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Display name" required
                className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
              {preset?.needs_key && (
                <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="API Key"
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
              )}
              {form.name === "searxng" && (
                <input value={form.api_base} onChange={(e) => setForm({ ...form, api_base: e.target.value })} placeholder="http://your-searxng:8888"
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
              )}
              {form.name === "kagi" && (
                <div>
                  <label className="block text-xs text-matrix-text-faint mb-1">Kagi API Mode</label>
                  <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}
                    className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright outline-none">
                    <option value="search">Search — ranked web results ($0.025/query)</option>
                    <option value="fastgpt">FastGPT — AI-synthesized answers with citations ($0.015/query)</option>
                    <option value="enrich_web">Enrich Web — non-commercial small web results ($0.002/query)</option>
                    <option value="enrich_news">Enrich News — non-mainstream news and discussions ($0.002/query)</option>
                  </select>
                </div>
              )}
              {form.name === "google" && (
                <input value={form.cx} onChange={(e) => setForm({ ...form, cx: e.target.value })} placeholder="Custom Search Engine ID (cx)"
                  className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
              )}
              <div className="flex gap-2">
                <button type="submit" className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">Add</button>
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg bg-matrix-input px-4 py-2 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="space-y-3">
        {providers.length === 0 ? (
          <p className="text-matrix-text-faint">No search providers configured. Add one to enable web search for agents.</p>
        ) : providers.map((p) => (
          <div key={p.id} className="rounded-xl bg-matrix-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{p.display_name}</h3>
                  <span className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text-dim">{p.name}</span>
                  {p.is_default && <span className="rounded-full bg-matrix-accent/20 px-2 py-0.5 text-xs text-matrix-accent">default</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${p.is_enabled ? "bg-matrix-green/20 text-matrix-green" : "bg-matrix-input text-matrix-text-faint"}`}>
                    {p.is_enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-matrix-text-faint">
                  {p.has_api_key ? "API key configured" : "No API key"}
                  {p.api_base && ` · ${p.api_base}`}
                </div>
              </div>
              <div className="flex gap-2">
                {!p.is_default && (
                  <button onClick={() => setDefault(p.id)} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Set Default</button>
                )}
                <button onClick={() => del(p.id)} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-red hover:bg-matrix-hover transition-colors">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
