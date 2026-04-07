import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { api } from "@/lib/api";

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  action: () => void;
  category: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input on open + fetch items
  useEffect(() => {
    if (!open || !isAuthenticated) return;
    setQuery("");
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 50);

    // Build static items
    const staticItems: PaletteItem[] = [
      { id: "nav-dash", label: "Dashboard", category: "Navigate", action: () => navigate("/") },
      { id: "nav-agents", label: "Agents", category: "Navigate", action: () => navigate("/agents/manage") },
      { id: "nav-kb", label: "Knowledge Bases", category: "Navigate", action: () => navigate("/knowledge-bases") },
      { id: "nav-ex", label: "Exemplar Sets", category: "Navigate", action: () => navigate("/exemplar-sets") },
      { id: "nav-search", label: "Search Providers", category: "Navigate", action: () => navigate("/search-providers") },
      { id: "nav-settings", label: "Settings", category: "Navigate", action: () => navigate("/providers") },
      { id: "act-logout", label: "Logout", category: "Actions", action: () => { logout(); navigate("/login"); } },
    ];

    // Fetch dynamic items
    Promise.all([
      api.get<{ agents: { slug: string; name: string }[] }>("/agents?limit=50").catch(() => ({ agents: [] })),
      api.get<{ id: string; name: string }[]>("/knowledge-bases").catch(() => []),
      api.get<{ id: string; title: string | null }[]>("/conversations?limit=20").catch(() => []),
    ]).then(([agentsRes, kbs, convos]) => {
      const agentItems: PaletteItem[] = (agentsRes.agents || []).map((a) => ({
        id: `agent-${a.slug}`,
        label: a.name,
        sublabel: "Open agent",
        category: "Agents",
        action: () => navigate(`/agents/manage`),
      }));

      const kbItems: PaletteItem[] = (kbs || []).map((kb) => ({
        id: `kb-${kb.id}`,
        label: kb.name,
        sublabel: "Knowledge base",
        category: "Knowledge",
        action: () => navigate(`/knowledge-bases`),
      }));

      const convoItems: PaletteItem[] = (convos || []).map((c) => ({
        id: `conv-${c.id}`,
        label: c.title ?? "Untitled",
        sublabel: "Conversation",
        category: "Chats",
        action: () => navigate(`/chat/${c.id}`),
      }));

      setItems([...staticItems, ...agentItems, ...kbItems, ...convoItems]);
    });
  }, [open, isAuthenticated, navigate, logout]);

  const filtered = query.trim()
    ? items.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        (i.sublabel || "").toLowerCase().includes(query.toLowerCase()) ||
        i.category.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  const visible = filtered.slice(0, 12);

  const execute = useCallback((item: PaletteItem) => {
    setOpen(false);
    item.action();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && visible[selectedIndex]) {
      e.preventDefault();
      execute(visible[selectedIndex]);
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  // Group by category
  const groups: Record<string, PaletteItem[]> = {};
  for (const item of visible) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category]!.push(item);
  }

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-matrix-card border border-matrix-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="border-b border-matrix-border px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, agents, conversations..."
            className="w-full bg-transparent text-sm text-matrix-text-bright placeholder-matrix-text-faint outline-none"
          />
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {visible.length === 0 ? (
            <p className="px-4 py-3 text-sm text-matrix-text-faint">No results</p>
          ) : (
            Object.entries(groups).map(([category, groupItems]) => (
              <div key={category}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase text-matrix-text-faint tracking-wider">
                  {category}
                </p>
                {groupItems.map((item) => {
                  const idx = flatIndex++;
                  return (
                    <button
                      key={item.id}
                      onClick={() => execute(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex w-full items-center justify-between px-4 py-2 text-sm transition-colors ${
                        idx === selectedIndex
                          ? "bg-matrix-accent/10 text-matrix-accent"
                          : "text-matrix-text hover:bg-matrix-hover"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.sublabel && (
                        <span className="text-xs text-matrix-text-faint">{item.sublabel}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-matrix-border px-4 py-2 flex gap-4 text-[10px] text-matrix-text-faint">
          <span><kbd className="rounded bg-matrix-input px-1">↑↓</kbd> navigate</span>
          <span><kbd className="rounded bg-matrix-input px-1">↵</kbd> select</span>
          <span><kbd className="rounded bg-matrix-input px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
