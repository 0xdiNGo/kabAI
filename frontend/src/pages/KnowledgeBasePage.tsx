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
  const [aiDeepResearch, setAiDeepResearch] = useState(false);
  const [rfcAnalysis, setRfcAnalysis] = useState(true);
  const [chunkSize, setChunkSize] = useState("medium");
  const [aiTitles, setAiTitles] = useState(false);
  const [hfRepoId, setHfRepoId] = useState("");
  const [hfSubset, setHfSubset] = useState("");
  const [hfMaxRows, setHfMaxRows] = useState("500");
  const [hfEnabled, setHfEnabled] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ name: string; content: string; sizeKB: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    analysis: { content_type: string; complexity: string; recommended_tier: string; reasoning: string; suggested_chunk_size: string };
    suggested_model: string | null;
    available_models: Record<string, string[]>;
    analyzed_with: string;
  } | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [ingestResult, setIngestResult] = useState("");
  const [queueStatus, setQueueStatus] = useState<{
    pending: number; processing: number; done: number; failed: number; total: number;
  } | null>(null);
  const [ingestStatus, setIngestStatus] = useState<{
    state: string; current_step: string; chunks_total: number; chunks_completed: number;
    error: string | null;
  } | null>(null);
  const [jobs, setJobs] = useState<{
    job_id: string; source: string | null; total: number; done: number;
    failed: number; pending: number; processing: number; tokens_used: number;
  }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const pollingRef = useRef(false);

  const pollProgress = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      // Fast global query — no per-job aggregation
      const s = await api.get<{
        pending: number; processing: number; done: number; failed: number; total: number;
      }>("/knowledge-bases/queue-status");
      setQueueStatus(s);

      // Also poll per-KB ingest task status (covers pre-queue phases like HF fetching)
      let taskRunning = false;
      if (selectedKB) {
        const is = await api.get<{
          state: string; current_step: string; chunks_total: number; chunks_completed: number;
          error: string | null;
        }>(`/knowledge-bases/${selectedKB.id}/ingest-status`);
        setIngestStatus(is.state !== "idle" ? is : null);
        taskRunning = is.state === "running";
      }

      const queueActive = s.pending > 0 || s.processing > 0;
      const hasActive = queueActive || taskRunning;
      setIngesting(hasActive);
      if (!hasActive && pollRef.current) {
        clearInterval(pollRef.current); pollRef.current = null;
        setIngestStatus(null);
        loadKBs();
      }
    } catch { /* ignore */ }
    pollingRef.current = false;
  };

  const loadJobsDetail = async (kbId: string) => {
    // Only called when user expands the detail panel
    try {
      const j = await api.get<typeof jobs>(`/knowledge-bases/${kbId}/jobs`);
      setJobs([...j]);
    } catch { /* ignore */ }
  };

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollingRef.current = false;
    pollProgress();
    pollRef.current = setInterval(pollProgress, 3000);
  };

  const cancelJob = async (jobId: string) => {
    if (!selectedKB) return;
    await api.delete(`/knowledge-bases/${selectedKB.id}/jobs/${jobId}`);
    pollProgress();
  };

  const loadKBs = () => { api.get<KB[]>("/knowledge-bases").then(setKbs).catch(() => {}); };
  const loadItems = async (kb: KB) => { setItems(await api.get<KBItem[]>(`/knowledge-bases/${kb.id}/items`)); };
  const loadBatches = async (kbId: string) => { setBatches(await api.get<Batch[]>(`/knowledge-bases/${kbId}/batches`)); };
  const loadSources = async (kbId: string) => { setSources(await api.get<{ source: string | null; count: number }[]>(`/knowledge-bases/${kbId}/sources`)); };

  useEffect(() => {
    loadKBs();
    api.get<{ id: string; name: string; provider_display_name: string }[]>("/providers/models/all").then(setModels).catch(() => {});
    api.get<{ huggingface_enabled: boolean }>("/settings").then((s) => setHfEnabled(s.huggingface_enabled)).catch(() => {});
  }, []);

  const selectKB = async (kb: KB) => {
    setSelectedKB(kb); setSearchResults(null); setSearchQuery(""); setEditingKB(false);
    setEditName(kb.name); setEditDesc(kb.description); setEditModel(kb.ingest_model ?? "");
    // Clear ingest state
    setIngestText(""); setIngestSource(""); setIngestUrl(""); setDeepResearch(false); setAiDeepResearch(false); setRfcAnalysis(true); setHfRepoId(""); setHfSubset(""); setHfMaxRows("500");
    // Stop any active polling and clear all ingest state
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setIngesting(false); setIngestResult(""); setJobs([]); setExpandedItem(null);
    setStagedFile(null); setAnalysis(null); setIngestStatus(null);
    await Promise.all([loadItems(kb), loadBatches(kb.id), loadSources(kb.id)]);

    // Check for active ingestion via fast global endpoint + per-KB task status
    try {
      const [s, is] = await Promise.all([
        api.get<{ pending: number; processing: number; done: number; failed: number; total: number }>("/knowledge-bases/queue-status"),
        api.get<{ state: string; current_step: string; chunks_total: number; chunks_completed: number; error: string | null }>(`/knowledge-bases/${kb.id}/ingest-status`),
      ]);
      setQueueStatus(s);
      setIngestStatus(is.state !== "idle" ? is : null);
      if (s.pending > 0 || s.processing > 0 || is.state === "running") { setIngesting(true); startPolling(); }
    } catch { /* ignore */ }
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
    setIngesting(true); setIngestResult("");     try {
      await api.post(`/knowledge-bases/${selectedKB.id}/ingest`, { content: ingestText, source: ingestSource || null, chunk_size: chunkSize, ai_titles: aiTitles });
      setIngestText(""); setIngestSource(""); startPolling();
    } catch (err) { setIngesting(false); setIngestResult(err instanceof Error ? err.message : "Failed"); }
  };

  const ingestFromUrl = async () => {
    if (!selectedKB || !ingestUrl.trim()) return;
    setIngesting(true); setIngestResult("");     try {
      await api.post(`/knowledge-bases/${selectedKB.id}/ingest-url`, {
        url: ingestUrl, deep: deepResearch, chunk_size: chunkSize, ai_titles: aiTitles,
        ai_deep_research: aiDeepResearch, rfc_analysis: rfcAnalysis,
      });
      setIngestUrl(""); startPolling();
    } catch (err) { setIngesting(false); setIngestResult(err instanceof Error ? err.message : "Failed"); }
  };

  const ingestFromHF = async () => {
    if (!selectedKB || !hfRepoId.trim()) return;
    setIngesting(true); setIngestResult("");
    try {
      await api.post(`/knowledge-bases/${selectedKB.id}/ingest-hf`, {
        repo_id: hfRepoId.trim(), subset: hfSubset.trim() || undefined,
        split: "train", max_rows: parseInt(hfMaxRows, 10) || 500,
        chunk_size: chunkSize, ai_titles: aiTitles,
      });
      setHfRepoId(""); startPolling();
    } catch (err) { setIngesting(false); setIngestResult(err instanceof Error ? err.message : "Failed"); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (file.size > 1024 * 1024 * 1024) {
      setIngestResult("File too large (max 1GB)");
      return;
    }

    const sizeKB = Math.round(file.size / 1024);
    const sizeMB = Math.round(file.size / (1024 * 1024));

    if (file.size > 200 * 1024 * 1024) {
      setIngestResult(`Reading ${sizeMB}MB file — this may take a moment...`);
    }

    try {
      const content = await file.text();
      setStagedFile({ name: file.name, content, sizeKB });
      setIngestResult(file.size > 50 * 1024 * 1024
        ? `File loaded (${sizeMB}MB). Will upload in ${Math.ceil(content.length / (10 * 1024 * 1024))} segments.`
        : "");
    } catch {
      setIngestResult("Could not read file as text. It may be too large for the browser or a binary file.");
    }
  };

  const analyzeContent = async (content: string, source: string | null) => {
    setAnalyzing(true); setAnalysis(null);
    try {
      const res = await api.post<{
        analysis: { content_type: string; complexity: string; recommended_tier: string; reasoning: string; suggested_chunk_size: string };
        suggested_model: string | null;
        available_models: Record<string, string[]>;
        analyzed_with: string;
      }>("/knowledge-bases/analyze", {
        content_sample: content.slice(0, 3000),
        source,
      });
      setAnalysis(res);
      // Auto-apply suggestions
      if (res.analysis.suggested_chunk_size) setChunkSize(res.analysis.suggested_chunk_size);
    } catch {
      // Silent fail — analysis is optional
    } finally {
      setAnalyzing(false);
    }
  };

  const UPLOAD_SEGMENT_SIZE = 10 * 1024 * 1024; // 10MB per request

  const ingestStagedFile = async () => {
    if (!selectedKB || !stagedFile) return;
    setIngesting(true); setIngestResult("");

    try {
      const content = stagedFile.content;
      const source = stagedFile.name;

      if (content.length <= UPLOAD_SEGMENT_SIZE) {
        // Small file — single request
        await api.post(`/knowledge-bases/${selectedKB.id}/ingest`, {
          content, source, chunk_size: chunkSize, ai_titles: aiTitles,
        });
      } else {
        // Large file — split into segments and upload each
        const totalSegments = Math.ceil(content.length / UPLOAD_SEGMENT_SIZE);
        setIngestResult(`Uploading ${totalSegments} segments...`);

        for (let i = 0; i < totalSegments; i++) {
          const start = i * UPLOAD_SEGMENT_SIZE;
          const end = Math.min(start + UPLOAD_SEGMENT_SIZE, content.length);
          // Find a clean break point (newline) near the boundary
          let breakAt = end;
          if (end < content.length) {
            const lastNewline = content.lastIndexOf("\n", end);
            if (lastNewline > start) breakAt = lastNewline + 1;
          }
          const segment = content.slice(start, breakAt);
          const segSource = `${source} (part ${i + 1}/${totalSegments})`;

          setIngestResult(`Uploading segment ${i + 1} of ${totalSegments}...`);
          await api.post(`/knowledge-bases/${selectedKB.id}/ingest`, {
            content: segment, source: segSource, chunk_size: chunkSize, ai_titles: aiTitles,
          });
        }
      }

      setStagedFile(null); setAnalysis(null);
      startPolling();
    } catch (err) {
      setIngesting(false);
      setIngestResult(err instanceof Error ? err.message : "File ingestion failed");
    }
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
                      <button onClick={ingestFromUrl} disabled={ingesting || !ingestUrl.trim()}
                        className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {ingesting ? "Working..." : "Fetch & Ingest"}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer" title="Follow related links from the ingested page">
                        <input type="checkbox" checked={deepResearch} onChange={(e) => setDeepResearch(e.target.checked)} className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                        <span className="text-matrix-text-dim">Deep research</span>
                      </label>
                      {deepResearch && (
                        <label className="flex items-center gap-1.5 cursor-pointer" title="Use AI to select the most relevant links (costs tokens). Off = heuristic filtering (free, fast).">
                          <input type="checkbox" checked={aiDeepResearch} onChange={(e) => setAiDeepResearch(e.target.checked)} className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                          <span className="text-matrix-text-dim">AI link selection</span>
                        </label>
                      )}
                      <label className="flex items-center gap-1.5 cursor-pointer" title="For IETF RFCs: generate AI analysis comparing RFC versions, identifying what changed and compliance implications.">
                        <input type="checkbox" checked={rfcAnalysis} onChange={(e) => setRfcAnalysis(e.target.checked)} className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                        <span className="text-matrix-text-dim">RFC change analysis</span>
                      </label>
                    </div>
                  </div>
                  {/* HuggingFace Dataset */}
                  {hfEnabled && (
                    <div className="space-y-2">
                      <h3 className="text-sm text-matrix-text-dim">HuggingFace Dataset</h3>
                      <div className="flex gap-2">
                        <input value={hfRepoId} onChange={(e) => setHfRepoId(e.target.value)} placeholder="owner/dataset-name"
                          className="flex-1 rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                        <input value={hfSubset} onChange={(e) => setHfSubset(e.target.value)} placeholder="subset (optional)"
                          className="w-40 rounded-lg bg-matrix-input px-3 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                        <input type="number" value={hfMaxRows} onChange={(e) => setHfMaxRows(e.target.value)} min="1" max="10000"
                          title="Max rows to import"
                          className="w-24 rounded-lg bg-matrix-input px-3 py-2.5 text-sm text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
                        <button onClick={ingestFromHF} disabled={ingesting || !hfRepoId.trim()}
                          className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                          {ingesting ? "Working..." : "Import"}
                        </button>
                      </div>
                      <p className="text-xs text-matrix-text-faint">
                        Streams dataset rows and ingests as KB content. Supports text, chat, and instruction formats.
                      </p>
                    </div>
                  )}
                  {/* File upload */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm text-matrix-text-dim">Upload File</h3>
                      <button onClick={() => fileInputRef.current?.click()} className="rounded bg-matrix-input px-2 py-1 text-xs text-matrix-text hover:bg-matrix-hover transition-colors">
                        {stagedFile ? "Choose Different File" : "Choose File"}
                      </button>
                      <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
                    </div>

                    {/* Staged file preview with analysis and chunk size comparison */}
                    {stagedFile && (() => {
                      const charCount = stagedFile.content.length;
                      const tokEstimate = Math.round(charCount / 4);
                      const sizes = [
                        { key: "small", label: "Small", target: 1600, tokPerChunk: 400, desc: "Best retrieval accuracy" },
                        { key: "medium", label: "Medium", target: 3200, tokPerChunk: 800, desc: "Balanced (default)" },
                        { key: "large", label: "Large", target: 6400, tokPerChunk: 1600, desc: "Faster, fewer LLM calls" },
                        { key: "xlarge", label: "XLarge", target: 12800, tokPerChunk: 3200, desc: "Fastest, coarse chunks" },
                      ];
                      const a = analysis?.analysis;
                      return (
                        <div className="rounded-lg bg-matrix-input p-4 space-y-3">
                          {/* File info header */}
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-matrix-text-bright">{stagedFile.name}</p>
                              <p className="text-xs text-matrix-text-faint">
                                {stagedFile.sizeKB.toLocaleString()} KB · ~{tokEstimate.toLocaleString()} tokens of content
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => analyzeContent(stagedFile.content, stagedFile.name)}
                                disabled={analyzing}
                                className="rounded bg-matrix-purple/20 px-2.5 py-1 text-xs text-matrix-purple hover:bg-matrix-purple/30 disabled:opacity-50 transition-colors"
                              >
                                {analyzing ? "Analyzing..." : analysis ? "Re-analyze" : "Suggest Settings"}
                              </button>
                              <button onClick={() => { setStagedFile(null); setAnalysis(null); }}
                                className="text-xs text-matrix-text-faint hover:text-matrix-red transition-colors">Remove</button>
                            </div>
                          </div>

                          {/* AI recommendation */}
                          {analysis && a && (
                            <div className="rounded-lg bg-matrix-card p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-matrix-purple">AI Recommendation</span>
                                <span className="text-xs text-matrix-text-faint">via {analysis.analyzed_with}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <span className="text-matrix-text-faint">Content type</span>
                                <span className="text-matrix-text">{a.content_type}</span>
                                <span className="text-matrix-text-faint">Complexity</span>
                                <span className={`font-medium ${a.complexity === "simple" ? "text-matrix-green" : a.complexity === "moderate" ? "text-matrix-yellow" : "text-matrix-accent"}`}>
                                  {a.complexity}
                                </span>
                                <span className="text-matrix-text-faint">Recommended tier</span>
                                <span className="text-matrix-text">{a.recommended_tier === "local" ? "Local (free via Ollama)" : a.recommended_tier === "mid" ? "Mid-tier cloud" : "Premium cloud"}</span>
                                {analysis.suggested_model && (
                                  <>
                                    <span className="text-matrix-text-faint">Suggested model</span>
                                    <span className="text-matrix-text">{analysis.suggested_model}</span>
                                  </>
                                )}
                                <span className="text-matrix-text-faint">Suggested chunks</span>
                                <span className="text-matrix-text">{a.suggested_chunk_size}</span>
                              </div>
                              <p className="text-xs text-matrix-text-dim italic">{a.reasoning}</p>
                            </div>
                          )}

                          {/* Chunk size selector */}
                          <div className="space-y-1">
                            <p className="text-xs text-matrix-text-dim mb-2">
                              {aiTitles
                                ? "Select chunk size — each chunk costs one LLM call for title generation:"
                                : "Select chunk size — smaller chunks improve retrieval accuracy, larger chunks preserve more context:"}
                            </p>
                            {sizes.map((sz) => {
                              const chunks = Math.max(1, Math.ceil(charCount / sz.target));
                              const titleTokens = aiTitles ? chunks * 550 : 0;
                              const displayTokens = aiTitles ? tokEstimate + titleTokens : tokEstimate;
                              const selected = chunkSize === sz.key;
                              const suggested = a?.suggested_chunk_size === sz.key;
                              return (
                                <button key={sz.key} onClick={() => setChunkSize(sz.key)}
                                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                                    selected ? "bg-matrix-accent/15 border border-matrix-accent-hover" : "bg-matrix-card hover:bg-matrix-hover"
                                  }`}>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm font-medium ${selected ? "text-matrix-accent" : "text-matrix-text"}`}>
                                      {sz.label}
                                    </span>
                                    {suggested && !selected && (
                                      <span className="rounded bg-matrix-purple/20 px-1.5 py-0.5 text-[10px] text-matrix-purple">recommended</span>
                                    )}
                                    <span className="text-xs text-matrix-text-faint">~{sz.tokPerChunk} tok/chunk · {sz.desc}</span>
                                  </div>
                                  <div className="text-right">
                                    <span className={`text-sm ${selected ? "text-matrix-accent" : "text-matrix-text-dim"}`}>
                                      {chunks} chunk{chunks !== 1 ? "s" : ""}
                                    </span>
                                    {aiTitles ? (
                                      <span className="text-xs text-matrix-text-faint ml-2">
                                        ~{displayTokens.toLocaleString()} tok total
                                      </span>
                                    ) : (
                                      <span className="text-xs text-matrix-text-faint ml-2">
                                        ~{displayTokens.toLocaleString()} tok content
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={aiTitles} onChange={(e) => setAiTitles(e.target.checked)}
                                className="h-3.5 w-3.5 rounded accent-matrix-accent" />
                              <span className="text-xs text-matrix-text-dim">AI titles</span>
                              <span className="text-xs text-matrix-text-faint">{aiTitles ? "(LLM-generated, uses tokens)" : "(off — scripted titles, no LLM cost)"}</span>
                            </label>
                            <button onClick={ingestStagedFile} disabled={ingesting}
                              className="rounded-lg bg-matrix-accent px-6 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                              {ingesting ? "Ingesting..." : "Ingest File"}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Paste text */}
                  <div className="space-y-2">
                    <h3 className="text-sm text-matrix-text-dim">Paste Text</h3>
                    <textarea value={ingestText} onChange={(e) => setIngestText(e.target.value)} placeholder="Paste content here..." rows={4}
                      className="w-full resize-none rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent" />
                    <div className="flex items-center gap-3">
                      <input value={ingestSource} onChange={(e) => setIngestSource(e.target.value)} placeholder="Source name (optional)"
                        className="flex-1 rounded-lg bg-matrix-input px-3 py-2 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none" />
                      <button onClick={ingest} disabled={ingesting || !ingestText.trim()}
                        className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {ingesting ? "Working..." : "Ingest Text"}
                      </button>
                    </div>
                  </div>

                  {/* Ingest task status (pre-queue phases like HF fetching, URL crawling) */}
                  {ingestStatus && ingestStatus.state === "running" && (
                    <div className="rounded-lg bg-matrix-input p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-matrix-accent animate-pulse" />
                        <span className="text-sm text-matrix-text">{ingestStatus.current_step}</span>
                      </div>
                      {ingestStatus.chunks_total > 0 && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-matrix-bg overflow-hidden">
                            <div
                              className="h-full rounded-full bg-matrix-accent transition-all duration-500"
                              style={{ width: `${Math.round((ingestStatus.chunks_completed / ingestStatus.chunks_total) * 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-matrix-text-faint">
                            {ingestStatus.chunks_completed} / {ingestStatus.chunks_total} chunks
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {ingestStatus && ingestStatus.state === "failed" && ingestStatus.error && (
                    <div className="rounded-lg bg-matrix-red/10 p-3">
                      <p className="text-sm text-matrix-red">{ingestStatus.error}</p>
                    </div>
                  )}

                  {/* Ingest progress */}
                  {queueStatus && queueStatus.total > 0 && (() => {
                    const totalDone = queueStatus.done;
                    const totalAll = queueStatus.total;
                    const overallPct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;
                    const isActive = queueStatus.pending > 0 || queueStatus.processing > 0;

                    return (
                      <div
                        className="rounded-lg bg-matrix-input p-3 cursor-pointer"
                        onClick={() => setShowDetailPanel(!showDetailPanel)}
                      >
                        {/* Summary line + progress bar */}
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {isActive && (
                              <div className="flex gap-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="h-1.5 w-1.5 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="h-1.5 w-1.5 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "300ms" }} />
                              </div>
                            )}
                            <span className="text-sm text-matrix-text-bright">
                              {isActive
                                ? `Processing: ${totalDone.toLocaleString()} / ${totalAll.toLocaleString()} chunks`
                                : `Complete: ${totalDone.toLocaleString()} chunks`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-matrix-accent">{overallPct}%</span>
                            {isActive && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!selectedKB) return;
                                  const jbs = await api.get<typeof jobs>(`/knowledge-bases/${selectedKB.id}/jobs`);
                                  for (const j of jbs) {
                                    if (j.pending > 0 || j.processing > 0) await cancelJob(j.job_id);
                                  }
                                  pollProgress();
                                }}
                                className="rounded bg-matrix-card px-2 py-0.5 text-xs text-matrix-red hover:bg-matrix-hover transition-colors"
                              >
                                Cancel All
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-matrix-card overflow-hidden">
                          <div className="h-full bg-matrix-accent rounded-full transition-all duration-500" style={{ width: `${overallPct}%` }} />
                        </div>

                        {/* Expanded detail panel — loads job detail on demand */}
                        {showDetailPanel && (
                          <div className="mt-3 border-t border-matrix-border pt-3 space-y-2">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                              <span className="text-matrix-text-faint">Chunks processed</span>
                              <span className="text-matrix-text">{totalDone.toLocaleString()} / {totalAll.toLocaleString()}</span>
                              <span className="text-matrix-text-faint">Pending</span>
                              <span className="text-matrix-text">{queueStatus.pending.toLocaleString()}</span>
                              <span className="text-matrix-text-faint">Processing</span>
                              <span className="text-matrix-text">{queueStatus.processing}</span>
                              {queueStatus.failed > 0 && (
                                <>
                                  <span className="text-matrix-text-faint">Failed</span>
                                  <span className="text-matrix-red">{queueStatus.failed}</span>
                                </>
                              )}
                            </div>

                            {/* Per-segment detail — loaded on demand */}
                            {jobs.length > 0 ? (
                              <div className="max-h-40 overflow-y-auto space-y-0.5">
                                {jobs.map((job) => {
                                  const jdone = job.pending === 0 && job.processing === 0;
                                  return (
                                    <div key={job.job_id} className="flex items-center justify-between text-xs px-1">
                                      <span className={jdone ? "text-matrix-text-faint" : "text-matrix-text"}>
                                        {job.source || "Text ingest"}
                                      </span>
                                      <span className={jdone ? "text-matrix-green" : "text-matrix-text-dim"}>
                                        {job.done}/{job.total}
                                        {job.failed > 0 && <span className="text-matrix-red ml-1">({job.failed} err)</span>}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); if (selectedKB) loadJobsDetail(selectedKB.id); }}
                                className="text-xs text-matrix-accent hover:underline"
                              >
                                Load segment details
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
