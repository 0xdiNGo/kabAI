import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

interface Conversation {
  id: string;
  title: string | null;
  agent_id: string | null;
  model: string | null;
  collaboration_mode: string | null;
  message_count: number;
  summary: string | null;
  last_agent_name: string | null;
  updated_at: string;
  created_at: string;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ChatsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const load = () => {
    api.get<Conversation[]>("/conversations?limit=200").then(setConversations).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const deleteOne = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleting(id);
    await api.delete(`/conversations/${id}`).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
    setDeleting(null);
    if (location.pathname === `/chat/${id}`) navigate("/");
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    const deletedIds = [...selected];
    await Promise.all(deletedIds.map((id) => api.delete(`/conversations/${id}`).catch(() => {})));
    setConversations((prev) => prev.filter((c) => !selected.has(c.id)));
    setSelected(new Set());
    setBulkDeleting(false);
    if (deletedIds.some((id) => location.pathname === `/chat/${id}`)) navigate("/");
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const startRename = (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title ?? "");
  };

  const saveRename = async (id: string) => {
    const title = editTitle.trim();
    if (title) {
      await api.patch(`/conversations/${id}`, { title }).catch(() => {});
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title } : c));
    }
    setEditingId(null);
  };

  const allSelected = conversations.length > 0 && selected.size === conversations.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(conversations.map((c) => c.id)));
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-matrix-text-bright">Conversations</h1>
          <p className="text-sm text-matrix-text-faint mt-0.5">{conversations.length} total</p>
        </div>
        {selected.size > 0 && (
          <button
            onClick={deleteSelected}
            disabled={bulkDeleting}
            className="rounded-lg bg-matrix-red/10 border border-matrix-red/30 px-4 py-2 text-sm font-medium text-matrix-red hover:bg-matrix-red/20 disabled:opacity-50 transition-colors"
          >
            {bulkDeleting ? "Deleting..." : `Delete ${selected.size} selected`}
          </button>
        )}
      </div>

      {conversations.length === 0 ? (
        <div className="rounded-xl border border-matrix-border bg-matrix-card px-6 py-12 text-center">
          <p className="text-matrix-text-faint">No conversations yet</p>
        </div>
      ) : (
        <div className="rounded-xl border border-matrix-border overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-4 border-b border-matrix-border bg-matrix-surface px-4 py-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded accent-matrix-accent"
            />
            <span className="flex-1 text-xs font-medium text-matrix-text-faint uppercase tracking-wider">Title</span>
            <span className="w-32 text-xs font-medium text-matrix-text-faint uppercase tracking-wider hidden sm:block">Agent / Model</span>
            <span className="w-20 text-xs font-medium text-matrix-text-faint uppercase tracking-wider hidden md:block text-right">Messages</span>
            <span className="w-24 text-xs font-medium text-matrix-text-faint uppercase tracking-wider text-right">Updated</span>
            <span className="w-16" />
          </div>

          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => editingId !== c.id && navigate(`/chat/${c.id}`)}
              className={`group flex items-center gap-4 border-b border-matrix-border px-4 py-3 transition-colors cursor-pointer last:border-b-0 ${
                selected.has(c.id) ? "bg-matrix-accent/5" : "hover:bg-matrix-card"
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onClick={(e) => toggleSelect(e, c.id)}
                onChange={() => {}}
                className="h-3.5 w-3.5 rounded accent-matrix-accent shrink-0"
              />

              {/* Title */}
              <div className="flex-1 min-w-0">
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => saveRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(c.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded bg-matrix-surface border border-matrix-accent/50 px-2 py-0.5 text-sm text-matrix-text-bright outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-matrix-text-bright truncate">
                      {c.title ?? <span className="text-matrix-text-faint italic">Untitled</span>}
                    </span>
                    {c.collaboration_mode && (
                      <span className="shrink-0 rounded border border-matrix-purple/30 bg-matrix-purple/10 px-1.5 py-0.5 text-[10px] font-medium text-matrix-purple">
                        kabAInet
                      </span>
                    )}
                  </div>
                )}
                {c.summary && (
                  <p className="text-xs text-matrix-text-faint truncate mt-0.5">{c.summary}</p>
                )}
              </div>

              {/* Agent / Model */}
              <div className="w-32 hidden sm:block">
                <span className="text-xs text-matrix-text-dim truncate block">
                  {c.last_agent_name ?? c.model ?? "—"}
                </span>
              </div>

              {/* Message count */}
              <div className="w-20 hidden md:block text-right">
                <span className="text-xs text-matrix-text-faint">{c.message_count}</span>
              </div>

              {/* Timestamp */}
              <div className="w-24 text-right shrink-0">
                <span className="text-xs text-matrix-text-faint">{relativeTime(c.updated_at)}</span>
              </div>

              {/* Actions */}
              <div className="w-16 flex items-center justify-end gap-1 shrink-0">
                <button
                  onClick={(e) => startRename(e, c)}
                  className="rounded p-1 text-matrix-text-faint opacity-0 group-hover:opacity-100 hover:text-matrix-text hover:bg-matrix-input transition-all"
                  title="Rename"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  onClick={(e) => deleteOne(e, c.id)}
                  disabled={deleting === c.id}
                  className="rounded p-1 text-matrix-text-faint opacity-0 group-hover:opacity-100 hover:text-matrix-red hover:bg-matrix-input transition-all disabled:opacity-50"
                  title="Delete"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
