import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface KB {
  id: string;
  name: string;
  description: string;
  ingest_model: string | null;
  item_count: number;
}

interface KBItem {
  id: string;
  title: string;
  content: string;
  source: string | null;
  chunk_index: number;
}

interface Batch {
  id: string;
  source: string | null;
  item_count: number;
  created_at: string;
}

type Tab = "items" | "ingest" | "batches" | "sources";

export default function KnowledgeBasePage() {
  const [kbs, setKbs] = useState<KB[]>([]);
  const [models, setModels] = useState<{ id: string; name: string; provider_display_name: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ingestModel, setIngestModel] = useState("");
  const [selectedKB, setSelectedKB] = useState<KB | null>(null);
  const [editingKB, setEditingKB] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editModel, setEditModel] = useState("");
  const [tab, setTab] = useState<Tab>("items");
  const [items, setItems] = useState<KBItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [sources, setSources] = useState<{ source: string | null; count: number }[]>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KBItem[] | null>(null);
  const [ingestText, setIngestText] = useState("");
  const [ingestSource, setIngestSource] = useState("");
  const [ingestUrl, setIngestUrl] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestStep, setIngestStep] = useState("");
  const [ingestResult, setIngestResult] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = (kbId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.get<{ state: string; current_step: string; items_created: number; error: string | null; result: Record<string, unknown> | null }>(`/knowledge-bases/${kbId}/ingest-status`);
        setIngestStep(s.current_step);
        if (s.state === "completed") {
          clearInterval(pollRef.current!); pollRef.current = null; setIngesting(false);
          const items = (s.result?.items_created as number) || s.items_created || 0;
          setIngestResult(`Ingested ${items} knowledge items`);
          loadKBs(); if (selectedKB) { loadItems(selectedKB); loadBatches(selectedKB.id); loadSources(selectedKB.id); }
        } else if (s.state === "failed") {
          clearInterval(pollRef.current!); pollRef.current = null; setIngesting(false);
          setIngestResult(`Error: ${s.error}`);
        } else if (s.state === "cancelled") {
          clearInterval(pollRef.current!); pollRef.current = null; setIngesting(false);
          setIngestResult("Ingestion cancelled");
        }
      } catch { /* ignore */ }
    }, 2000);
  };

  const loadKBs = () => { api.get<KB[]>("/knowledge-bases").then(setKbs).catch(() => {}); };
  const loadItems = async (kb: KB) => { setItems(await api.get<KBItem[]>(`/knowledge-bases/${kb.id}/items`)); };
  const loadBatches = async (kbId: string) => { setBatches(await api.get<Batch[]>(`/knowledge-bases/${kbId}/batches`)); };
  const loadSources = async (kbId: string) => { setSources(await api.get<{ source: string | null; count: number }[]>(`/knowledge-bases/${kbId}/sources`)); };

  useEffect(() => {
    loadKBs();
    api.get<{ id: string; name: string; provider_display_name: string }[]>("/providers/models/all").then(setModels).catch(() => {});
  }, []);

  const selectKB = async (kb: KB) => {
    setSelectedKB(kb); setSearchResults(null); setSearchQuery(""); setEditingKB(false);
    setEditName(kb.name); setEditDesc(kb.description); setEditModel(kb.ingest_model ?? "");
    // Clear ingest state
    setIngestText(""); setIngestSource(""); setIngestUrl(""); setDeepResearch(false);
    setIngestResult(""); setIngestStep(""); setExpandedItem(null);
    await Promise.all([loadItems(kb), loadBatches(kb.id), loadSources(kb.id)]);
  };

  const createKB = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/knowledge-bases", { name, description, ingest_model: ingestModel || null });
    setName(""); setDescription(""); setIngestModel(""); setShowCreate(false); loadKBs();
  };

  const updateKB = async () => {
    if (!selectedKB) return;
    await api.put(`/knowledge-bases/${selectedKB.id}`, { name: editName, description: editDesc, ingest_model: editModel || null });
    setEditingKB(false); loadKBs();
    setSelectedKB({ ...selectedKB, name: editName, description: editDesc, ingest_model: editModel || null });
  };

  const deleteKB = async (id: string) => {
    await api.delete(`/knowledge-bases/${id}`);
    if (selectedKB?.id === id) { setSelectedKB(null); setItems([]); }
    loadKBs();
  };

  const deleteItem = async (itemId: string) => {
    if (!selectedKB) return;
    await api.delete(`/knowledge-bases/${selectedKB.id}/items/${itemId}`);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    loadKBs();
  };

  const rollbackBatch = async (batchId: string) => {
    if (!selectedKB) return;
    const res = await api.delete<{ items_deleted: number }>(`/knowledge-bases/${selectedKB.id}/batches/${batchId}`);
    setIngestResult(`Rolled back: ${res.items_deleted} items deleted`);
    loadKBs(); loadItems(selectedKB); loadBatches(selectedKB.id); loadSources(selectedKB.id);
  };

  const deleteBySource = async (source: string) => {
    if (!selectedKB) return;
    const res = await api.post<{ items_deleted: number }>(`/knowledge-bases/${selectedKB.id}/delete-by-source`, { source });
    setIngestResult(`Deleted ${res.items_deleted} items from "${source}"`);
    loadKBs(); loadItems(selectedKB); loadSources(selectedKB.id);
  };

  const searchKB = async () => {
    if (!selectedKB || !searchQuery.trim()) { setSearchResults(null); return; }
    const results = await api.post<KBItem[]>(`/knowledge-bases/${selectedKB.id}/search`, { query: searchQuery });
    setSearchResults(results);
  };

  const ingest = async () => {
    if (!selectedKB || !ingestText.trim()) return;
    setIngesting(true); setIngestResult(""); setIngestStep("Starting...");
    try {
      await api.post(`/knowledge-bases/${selectedKB.id}/ingest`, { content: ingestText, source: ingestSource || null });
      setIngestText(""); setIngestSource(""); startPolling(selectedKB.id);
    } catch (err) { setIngesting(false); setIngestResult(err instanceof Error ? err.message : "Failed"); }
  };

  const ingestFromUrl = async () => {
    if (!selectedKB || !ingestUrl.trim()) return;
    setIngesting(true); setIngestResult(""); setIngestStep("Starting URL ingestion...");
    try {
      await api.post(`/knowledge-bases/${selectedKB.id}/ingest-url`, { url: ingestUrl, deep: deepResearch });
      setIngestUrl(""); startPolling(selectedKB.id);
    } catch (err) { setIngesting(false); setIngestResult(err instanceof Error ? err.message : "Failed"); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIngestText(await file.text()); setIngestSource(file.name);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const exportKB = async () => {
    if (!selectedKB) return;
    const data = await api.get<unknown>(`/knowledge-bases/${selectedKB.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `kb-${selectedKB.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const displayItems = searchResults ?? items;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button onClick={() => navigate("/")} className="text-sm text-matrix-text-dim hover:text-matrix-text-bright transition-colors">&larr; Dashboard</button>
          <h1 className="text-2xl font-bold mt-1">Knowledge Bases</h1>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">
          Create KB
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-xl bg-matrix-card p-5">
          <form onSubmit={createKB} className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
            <select value={ingestModel} onChange={(e) => setIngestModel(e.target.value)} className="w-full rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright outline-none">
              <option value="">Ingest model: system default</option>
              {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.provider_display_name})</option>))}
            </select>
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg bg-matrix-input px-4 py-2 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* KB Sidebar */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-matrix-text-dim mb-2">{kbs.length} knowledge base{kbs.length !== 1 ? "s" : ""}</h2>
          {kbs.map((kb) => (
            <div key={kb.id} onClick={() => selectKB(kb)}
              className={`cursor-pointer rounded-lg p-3 transition-colors ${selectedKB?.id === kb.id ? "bg-matrix-accent/10 border border-matrix-accent-hover" : "bg-matrix-card hover:bg-matrix-input"}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{kb.name}</h3>
                  <p className="text-xs text-matrix-text-faint mt-0.5">{kb.item_count} items{kb.ingest_model ? ` · ${kb.ingest_model.split("/").pop()}` : ""}</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteKB(kb.id); }} className="text-matrix-text-faint hover:text-matrix-red text-xs ml-2">Del</button>
              </div>
            </div>
          ))}
        </div>

        {/* KB Detail */}
        <div className="lg:col-span-3">
          {selectedKB ? (
            <div className="space-y-4">
              {/* Header / Edit */}
              <div className="rounded-xl bg-matrix-card p-5">
                {editingKB ? (
                  <div className="space-y-3">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg bg-matrix-input px-4 py-2 text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                    <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" className="w-full rounded-lg bg-matrix-input px-4 py-2 text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                    <select value={editModel} onChange={(e) => setEditModel(e.target.value)} className="w-full rounded-lg bg-matrix-input px-4 py-2 text-sm text-matrix-text-bright outline-none">
                      <option value="">Ingest model: system default</option>
                      {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.provider_display_name})</option>))}
                    </select>
                    <div className="flex gap-2">
                      <button onClick={updateKB} className="rounded-lg bg-matrix-accent px-3 py-1.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">Save</button>
                      <button onClick={() => setEditingKB(false)} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="font-semibold text-lg">{selectedKB.name}</h2>
                      {selectedKB.description && <p className="text-sm text-matrix-text-dim mt-1">{selectedKB.description}</p>}
                      {selectedKB.ingest_model && <p className="text-xs text-matrix-text-faint mt-1">Ingest model: {selectedKB.ingest_model}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingKB(true)} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Edit</button>
                      <button onClick={exportKB} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Export</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1">
                {(["items", "ingest", "batches", "sources"] as Tab[]).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${tab === t ? "bg-matrix-accent text-matrix-bg" : "bg-matrix-card text-matrix-text hover:bg-matrix-input"}`}>
                    {t === "items" ? `Items (${items.length})` : t === "batches" ? `History (${batches.length})` : t === "sources" ? `Sources (${sources.length})` : "Ingest"}
                  </button>
                ))}
              </div>

              {/* Tab: Items */}
              {tab === "items" && (
                <div className="rounded-xl bg-matrix-card p-5">
                  <div className="flex gap-2 mb-3">
                    <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchKB()}
                      placeholder="Search items..." className="flex-1 rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                    <button onClick={searchKB} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text hover:bg-matrix-hover transition-colors">Search</button>
                    {searchResults && <button onClick={() => { setSearchResults(null); setSearchQuery(""); }} className="rounded-lg bg-matrix-input px-3 py-1.5 text-sm text-matrix-text-faint hover:bg-matrix-hover transition-colors">Clear</button>}
                  </div>
                  {searchResults && <p className="text-xs text-matrix-text-faint mb-2">{searchResults.length} results for "{searchQuery}"</p>}
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {displayItems.length === 0 ? (
                      <p className="text-matrix-text-faint text-sm">No items.</p>
                    ) : displayItems.map((item) => (
                      <div key={item.id} className="rounded-lg bg-matrix-input p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}>
                            <h4 className="text-sm font-medium text-matrix-text-bright">{item.title}</h4>
                            {expandedItem === item.id ? (
                              <p className="text-xs text-matrix-text mt-1 whitespace-pre-wrap">{item.content}</p>
                            ) : (
                              <p className="text-xs text-matrix-text-dim mt-1 line-clamp-2">{item.content}</p>
                            )}
                            {item.source && <p className="text-xs text-matrix-text-faint mt-1">Source: {item.source}</p>}
                          </div>
                          <button onClick={() => deleteItem(item.id)} className="ml-2 text-matrix-text-faint hover:text-matrix-red text-xs shrink-0">Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab: Ingest */}
              {tab === "ingest" && (
                <div className="rounded-xl bg-matrix-card p-5 space-y-4">
                  {/* URL */}
                  <div className="space-y-2">
                    <h3 className="text-sm text-matrix-text-dim">Ingest from URL</h3>
                    <div className="flex gap-2">
                      <input value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)} placeholder="https://docs.example.com/guide"
                        className="flex-1 rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                      <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={deepResearch} onChange={(e) => setDeepResearch(e.target.checked)} className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                        <span className="text-xs text-matrix-text-dim">Deep</span>
                      </label>
                      <button onClick={ingestFromUrl} disabled={ingesting || !ingestUrl.trim()}
                        className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {ingesting ? "Working..." : "Fetch & Ingest"}
                      </button>
                    </div>
                    <p className="text-xs text-matrix-text-faint">
                      {deepResearch ? "Deep: follows related links. IETF RFCs always get full lineage." : "IETF RFC URLs automatically get full lineage analysis."}
                    </p>
                  </div>
                  {/* Text */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm text-matrix-text-dim">Ingest Text</h3>
                      <button onClick={() => fileInputRef.current?.click()} className="rounded bg-matrix-input px-2 py-1 text-xs text-matrix-text hover:bg-matrix-hover transition-colors">Upload File</button>
                      <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown" onChange={handleFileUpload} className="hidden" />
                    </div>
                    <textarea value={ingestText} onChange={(e) => setIngestText(e.target.value)} placeholder="Paste content here..." rows={6}
                      className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                    <div className="flex items-center gap-3">
                      <input value={ingestSource} onChange={(e) => setIngestSource(e.target.value)} placeholder="Source name (optional)"
                        className="flex-1 rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                      <button onClick={ingest} disabled={ingesting || !ingestText.trim()}
                        className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {ingesting ? "Working..." : "Ingest"}
                      </button>
                    </div>
                  </div>
                  {/* Status */}
                  {ingesting && ingestStep && (
                    <div className="flex items-center gap-2 rounded-lg bg-matrix-input px-3 py-2">
                      <div className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-xs text-matrix-text-dim">{ingestStep}</span>
                    </div>
                  )}
                  {ingestResult && <p className="text-sm text-matrix-text-dim">{ingestResult}</p>}
                </div>
              )}

              {/* Tab: Batches (version history) */}
              {tab === "batches" && (
                <div className="rounded-xl bg-matrix-card p-5">
                  <h3 className="text-sm font-semibold text-matrix-text-dim mb-3">Ingest History</h3>
                  {batches.length === 0 ? (
                    <p className="text-matrix-text-faint text-sm">No ingestion history.</p>
                  ) : (
                    <div className="space-y-2">
                      {batches.map((b) => (
                        <div key={b.id} className="flex items-center justify-between rounded-lg bg-matrix-input p-3">
                          <div>
                            <p className="text-sm text-matrix-text-bright">{b.source || "Text ingest"}</p>
                            <p className="text-xs text-matrix-text-faint">{b.item_count} items · {new Date(b.created_at).toLocaleString()}</p>
                          </div>
                          <button onClick={() => rollbackBatch(b.id)}
                            className="rounded-lg bg-matrix-card px-3 py-1.5 text-sm text-matrix-red hover:bg-matrix-hover transition-colors">
                            Rollback
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {ingestResult && <p className="text-sm text-matrix-text-dim mt-3">{ingestResult}</p>}
                </div>
              )}

              {/* Tab: Sources */}
              {tab === "sources" && (
                <div className="rounded-xl bg-matrix-card p-5">
                  <h3 className="text-sm font-semibold text-matrix-text-dim mb-3">Items by Source</h3>
                  {sources.length === 0 ? (
                    <p className="text-matrix-text-faint text-sm">No sources.</p>
                  ) : (
                    <div className="space-y-2">
                      {sources.map((s, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg bg-matrix-input p-3">
                          <div>
                            <p className="text-sm text-matrix-text-bright">{s.source || "(no source)"}</p>
                            <p className="text-xs text-matrix-text-faint">{s.count} items</p>
                          </div>
                          {s.source && (
                            <button onClick={() => deleteBySource(s.source!)}
                              className="rounded-lg bg-matrix-card px-3 py-1.5 text-sm text-matrix-red hover:bg-matrix-hover transition-colors">
                              Delete All
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {ingestResult && <p className="text-sm text-matrix-text-dim mt-3">{ingestResult}</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl bg-matrix-card">
              <p className="text-matrix-text-faint">Select a knowledge base to manage</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
