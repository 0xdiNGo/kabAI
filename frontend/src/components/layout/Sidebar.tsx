import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { api } from "@/lib/api";

interface Conversation {
  id: string;
  title: string | null;
  updated_at: string;
}

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: "◉" },
  { path: "/agents/manage", label: "Agents", icon: "⚙" },
  { path: "/knowledge-bases", label: "Knowledge", icon: "◈" },
  { path: "/exemplar-sets", label: "Exemplars", icon: "◇" },
];

const ADMIN_ITEMS = [
  { path: "/search-providers", label: "Search", icon: "◎" },
  { path: "/providers", label: "Settings", icon: "⚙" },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [recentChats, setRecentChats] = useState<Conversation[]>([]);
  const [chatsExpanded, setChatsExpanded] = useState(false);

  useEffect(() => {
    api.get<Conversation[]>("/conversations?limit=5")
      .then(setRecentChats)
      .catch(() => {});
  }, [location.pathname]);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const isChat = location.pathname.startsWith("/chat/");

  const navLink = (item: { path: string; label: string; icon: string }) => (
    <button
      key={item.path}
      onClick={() => navigate(item.path)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        isActive(item.path)
          ? "bg-matrix-accent/10 text-matrix-accent"
          : "text-matrix-text-dim hover:bg-matrix-hover hover:text-matrix-text"
      }`}
      title={collapsed ? item.label : undefined}
    >
      <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
      {!collapsed && <span>{item.label}</span>}
    </button>
  );

  return (
    <aside
      className="flex flex-col border-r border-matrix-border bg-matrix-card shrink-0 transition-all duration-200"
      style={{ width: collapsed ? 56 : 240 }}
    >
      {/* Logo */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 px-4 py-4 text-matrix-text-bright hover:text-matrix-accent transition-colors"
      >
        <span className="text-lg font-bold shrink-0">k</span>
        {!collapsed && <span className="text-lg font-bold">abAI</span>}
      </button>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-1">
        {NAV_ITEMS.map(navLink)}

        {/* Recent chats */}
        <button
          onClick={() => collapsed ? navigate("/") : setChatsExpanded(!chatsExpanded)}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            isChat
              ? "bg-matrix-accent/10 text-matrix-accent"
              : "text-matrix-text-dim hover:bg-matrix-hover hover:text-matrix-text"
          }`}
          title={collapsed ? "Chats" : undefined}
        >
          <span className="text-base w-5 text-center shrink-0">◆</span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Chats</span>
              <span className="text-xs text-matrix-text-faint">{chatsExpanded ? "▾" : "▸"}</span>
            </>
          )}
        </button>

        {!collapsed && chatsExpanded && (
          <div className="ml-8 space-y-0.5">
            {recentChats.length === 0 ? (
              <p className="text-xs text-matrix-text-faint py-1">No conversations</p>
            ) : (
              recentChats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/chat/${c.id}`)}
                  className={`block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors ${
                    location.pathname === `/chat/${c.id}`
                      ? "text-matrix-accent"
                      : "text-matrix-text-faint hover:text-matrix-text"
                  }`}
                >
                  {c.title ?? "Untitled"}
                </button>
              ))
            )}
          </div>
        )}

        {/* Divider */}
        <div className="my-2 border-t border-matrix-border" />

        {ADMIN_ITEMS.map(navLink)}
      </nav>

      {/* User + collapse */}
      <div className="border-t border-matrix-border px-2 py-3 space-y-2">
        {!collapsed && user && (
          <div className="flex items-center justify-between px-3">
            <span className="text-xs text-matrix-text-dim truncate">{user.display_name || user.username}</span>
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="text-xs text-matrix-text-faint hover:text-matrix-red transition-colors"
            >
              Logout
            </button>
          </div>
        )}
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-lg py-1.5 text-matrix-text-faint hover:bg-matrix-hover hover:text-matrix-text transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="text-sm">{collapsed ? "▸" : "◂"}</span>
        </button>
      </div>
    </aside>
  );
}
