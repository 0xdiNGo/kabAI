import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface InspectResult {
  repo_id: string;
  repo_type: string;
  suggestion: string;
  reason: string;
  details: Record<string, unknown>;
}

export default function HFImportRouter() {
  const [repoInput, setRepoInput] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const inspect = async () => {
    if (!repoInput.trim()) return;
    setInspecting(true); setResult(null); setError("");
    try {
      const res = await api.post<InspectResult>("/huggingface/inspect", { repo_id: repoInput.trim() });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inspect repository");
    } finally {
      setInspecting(false);
    }
  };

  const actionLabel: Record<string, string> = {
    exemplar_set: "Import as Exemplar Set",
    knowledge_base: "Import into Knowledge Base",
    lora_adapter: "Register LoRA Adapter",
  };

  const handleAction = () => {
    if (!result) return;
    const rid = encodeURIComponent(result.repo_id);
    if (result.suggestion === "exemplar_set") navigate(`/exemplar-sets?hf_repo=${rid}`);
    else if (result.suggestion === "knowledge_base") navigate(`/knowledge-bases?hf_repo=${rid}`);
    else if (result.suggestion === "lora_adapter") navigate(`/providers?hf_repo=${rid}`);
  };

  return (
    <div className="rounded-xl bg-matrix-card p-5">
      <h2 className="font-semibold mb-3">HuggingFace Import</h2>
      <p className="text-sm text-matrix-text-dim mb-3">
        Paste a HuggingFace URL or repo ID to auto-detect the best import action.
      </p>
      <div className="flex gap-2">
        <input
          value={repoInput}
          onChange={(e) => { setRepoInput(e.target.value); setResult(null); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && inspect()}
          placeholder="owner/repo-name or https://huggingface.co/..."
          className="flex-1 rounded-lg bg-matrix-input px-4 py-2.5 text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
        />
        <button
          onClick={inspect}
          disabled={inspecting || !repoInput.trim()}
          className="rounded-lg bg-matrix-accent px-4 py-2.5 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {inspecting ? "Inspecting..." : "Inspect"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-matrix-red">{error}</p>}
      {result && (
        <div className="mt-3 rounded-lg bg-matrix-bg/50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text-dim">
              {result.repo_type}
            </span>
            <span className="text-sm font-medium text-matrix-text-bright">{result.repo_id}</span>
          </div>
          <p className="text-sm text-matrix-text-dim">{result.reason}</p>
          {result.suggestion !== "unknown" && (
            <button
              onClick={handleAction}
              className="rounded-lg bg-matrix-accent px-4 py-2 text-sm font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors"
            >
              {actionLabel[result.suggestion] ?? result.suggestion}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
