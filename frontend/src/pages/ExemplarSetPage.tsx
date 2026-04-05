import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface ES { id: string; name: string; description: string; source_dataset: string | null; pair_count: number; }
interface Pair { id: string; user_content: string; assistant_content: string; topic_tags: string[]; source: string | null; }

export default function ExemplarSetPage() {
  const [sets, setSets] = useState<ES[]>([]);
  const [selectedSet, setSelectedSet] = useState<ES | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Manual pair
  const [userContent, setUserContent] = useState("");
  const [assistantContent, setAssistantContent] = useState("");
  // HF import
  const [hfRepo, setHfRepo] = useState("");
  const [hfSubset, setHfSubset] = useState("");
  const [hfMaxPairs, setHfMaxPairs] = useState("50");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const navigate = useNavigate();

  const loadSets = () => { api.get<ES[]>("/exemplar-sets").then(setSets).catch(() => {}); };
  const loadPairs = async (es: ES) => { setPairs(await api.get<Pair[]>(`/exemplar-sets/${es.id}/pairs`)); };

  useEffect(() => { loadSets(); }, []);

  const selectSet = async (es: ES) => {
    setSelectedSet(es); setExpandedPair(null); setImportResult("");
    await loadPairs(es);
  };

  const createSet = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/exemplar-sets", { name, description });
    setName(""); setDescription(""); setShowCreate(false); loadSets();
  };

  const deleteSet = async (id: string) => {
    await api.delete(`/exemplar-sets/${id}`);
    if (selectedSet?.id === id) { setSelectedSet(null); setPairs([]); }
    loadSets();
  };

  const addPair = async () => {
    if (!selectedSet || !userContent.trim() || !assistantContent.trim()) return;
    await api.post(`/exemplar-sets/${selectedSet.id}/pairs`, {
      user_content: userContent, assistant_content: assistantContent,
    });
    setUserContent(""); setAssistantContent("");
    loadSets(); loadPairs(selectedSet);
  };

  const deletePair = async (pairId: string) => {
    if (!selectedSet) return;
    await api.delete(`/exemplar-sets/${selectedSet.id}/pairs/${pairId}`);
    setPairs((prev) => prev.filter((p) => p.id !== pairId));
    loadSets();
  };

  const importHF = async () => {
    if (!selectedSet || !hfRepo.trim()) return;
    setImporting(true); setImportResult("");
    try {
      const res = await api.post<{ pairs_imported: number; source: string }>(
        `/exemplar-sets/${selectedSet.id}/import-hf`,
        { repo_id: hfRepo, subset: hfSubset || undefined, max_pairs: parseInt(hfMaxPairs, 10) || 50 },
      );
      setImportResult(`Imported ${res.pairs_imported} pairs from ${res.source}`);
      setHfRepo(""); setHfSubset("");
      loadSets(); loadPairs(selectedSet);
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const exportSet = async () => {
    if (!selectedSet) return;
    const data = await api.get<unknown>(`/exemplar-sets/${selectedSet.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `exemplars-${selectedSet.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button onClick={() => navigate("/")} className="text-sm text-matrix-text-dim hover:text-matrix-text-bright transition-colors">&larr; Dashboard</button>
          <h1 className="text-2xl font-bold mt-1">Exemplar Sets</h1>
          <p className="text-sm text-matrix-text-dim mt-1">Few-shot conversation pairs that shape how agents reason</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">
          Create Set
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-xl bg-matrix-card p-5">
          <form onSubmit={createSet} className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Set name" required className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (e.g. 'Chain-of-thought math reasoning')" className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg bg-matrix-input px-4 py-2 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Sidebar */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-matrix-text-dim mb-2">{sets.length} set{sets.length !== 1 ? "s" : ""}</h2>
          {sets.map((es) => (
            <div key={es.id} onClick={() => selectSet(es)}
              className={`cursor-pointer rounded-lg p-3 transition-colors ${selectedSet?.id === es.id ? "bg-matrix-accent/10 border border-matrix-accent-hover" : "bg-matrix-card hover:bg-matrix-input"}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{es.name}</h3>
                  <p className="text-xs text-matrix-text-faint mt-0.5">
                    {es.pair_count} pair{es.pair_count !== 1 ? "s" : ""}
                    {es.source_dataset && ` · ${es.source_dataset.split("/").pop()}`}
                  </p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteSet(es.id); }} className="text-matrix-text-faint hover:text-matrix-red text-xs ml-2">Del</button>
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3">
          {selectedSet ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="rounded-xl bg-matrix-card p-5 flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-lg">{selectedSet.name}</h2>
                  {selectedSet.description && <p className="text-sm text-matrix-text-dim mt-1">{selectedSet.description}</p>}
                  {selectedSet.source_dataset && <p className="text-xs text-matrix-text-faint mt-1">Source: {selectedSet.source_dataset}</p>}
                </div>
                <button onClick={exportSet} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Export</button>
              </div>

              {/* HF Import */}
              <div className="rounded-xl bg-matrix-card p-5 space-y-3">
                <h3 className="text-sm font-semibold text-matrix-text-dim">Import from Hugging Face</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input value={hfRepo} onChange={(e) => setHfRepo(e.target.value)} placeholder="owner/dataset-name"
                    className="rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                  <input value={hfSubset} onChange={(e) => setHfSubset(e.target.value)} placeholder="Subset (optional)"
                    className="rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                  <div className="flex gap-2">
                    <input type="number" value={hfMaxPairs} onChange={(e) => setHfMaxPairs(e.target.value)} min="1" max="1000" placeholder="Max pairs"
                      className="w-20 rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright outline-none" />
                    <button onClick={importHF} disabled={importing || !hfRepo.trim()}
                      className="flex-1 rounded-lg bg-matrix-accent px-3 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                      {importing ? "Importing..." : "Import"}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-matrix-text-faint">Expects datasets with a `messages` column (standard HF chat format: [{"{"}role, content{"}"}]).</p>
                {importResult && <p className="text-sm text-matrix-text-dim">{importResult}</p>}
              </div>

              {/* Add manual pair */}
              <div className="rounded-xl bg-matrix-card p-5 space-y-3">
                <h3 className="text-sm font-semibold text-matrix-text-dim">Add Pair Manually</h3>
                <textarea value={userContent} onChange={(e) => setUserContent(e.target.value)} placeholder="User message (the question/prompt)" rows={2}
                  className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                <textarea value={assistantContent} onChange={(e) => setAssistantContent(e.target.value)} placeholder="Assistant response (the expected reasoning/answer)" rows={3}
                  className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                <button onClick={addPair} disabled={!userContent.trim() || !assistantContent.trim()}
                  className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  Add Pair
                </button>
              </div>

              {/* Pairs list */}
              <div className="rounded-xl bg-matrix-card p-5">
                <h3 className="text-sm font-semibold text-matrix-text-dim mb-3">Pairs ({pairs.length})</h3>
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {pairs.length === 0 ? (
                    <p className="text-matrix-text-faint text-sm">No pairs yet. Import from HF or add manually.</p>
                  ) : pairs.map((p) => (
                    <div key={p.id} className="rounded-lg bg-matrix-input p-3 cursor-pointer" onClick={() => setExpandedPair(expandedPair === p.id ? null : p.id)}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-matrix-accent font-medium">User:</p>
                          <p className={`text-sm text-matrix-text ${expandedPair === p.id ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{p.user_content}</p>
                          <p className="text-xs text-matrix-green mt-2 font-medium">Assistant:</p>
                          <p className={`text-sm text-matrix-text-dim ${expandedPair === p.id ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{p.assistant_content}</p>
                          {p.source && <p className="text-xs text-matrix-text-faint mt-1">Source: {p.source}</p>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deletePair(p.id); }} className="ml-2 text-matrix-text-faint hover:text-matrix-red text-xs shrink-0">Del</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl bg-matrix-card">
              <p className="text-matrix-text-faint">Select an exemplar set to manage</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
