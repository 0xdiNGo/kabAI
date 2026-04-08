import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { api } from "@/lib/api";

interface Conversation {
  id: string;
  title: string | null;
  updated_at: string;
}

function Icon({ name, className }: { name: string; className?: string }) {
  const cls = className ?? "h-[18px] w-[18px] shrink-0";
  const props = { className: cls, fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "dashboard":
      return <svg {...props}><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>;
    case "agents":
      return <svg {...props}><path d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" /></svg>;
    case "knowledge":
      return <svg {...props}><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>;
    case "exemplars":
      return <svg {...props}><path d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>;
    case "chats":
      return <svg {...props}><path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>;
    case "search":
      return <svg {...props}><path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>;
    case "settings":
      return <svg {...props}><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
    case "collapse-left":
      return <svg {...props}><path d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>;
    case "collapse-right":
      return <svg {...props}><path d="M5.25 4.5l7.5 7.5-7.5 7.5m6-15l7.5 7.5-7.5 7.5" /></svg>;
    case "chevron-down":
      return <svg {...props}><path d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>;
    case "chevron-right":
      return <svg {...props}><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>;
    default:
      return null;
  }
}

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: "dashboard" },
  { path: "/agents/manage", label: "Agents", icon: "agents" },
  { path: "/knowledge-bases", label: "Knowledge", icon: "knowledge" },
  { path: "/exemplar-sets", label: "Exemplars", icon: "exemplars" },
];

const ADMIN_ITEMS = [
  { path: "/search-providers", label: "Search", icon: "search" },
  { path: "/providers", label: "Settings", icon: "settings" },
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
      <Icon name={item.icon} />
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
        <span className="text-lg font-bold shrink-0">{collapsed ? "k" : "kabAI"}</span>
      </button>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {NAV_ITEMS.map(navLink)}

        {/* Chats section */}
        <button
          onClick={() => collapsed ? navigate("/chats") : setChatsExpanded(!chatsExpanded)}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            location.pathname === "/chats" || isChat
              ? "bg-matrix-accent/10 text-matrix-accent"
              : "text-matrix-text-dim hover:bg-matrix-hover hover:text-matrix-text"
          }`}
          title={collapsed ? "Chats" : undefined}
        >
          <Icon name="chats" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left" onClick={(e) => { e.stopPropagation(); navigate("/chats"); }}>Chats</span>
              <span onClick={(e) => { e.stopPropagation(); setChatsExpanded(!chatsExpanded); }} className="p-0.5">
                <Icon name={chatsExpanded ? "chevron-down" : "chevron-right"} className="h-3.5 w-3.5 opacity-60" />
              </span>
            </>
          )}
        </button>

        {!collapsed && chatsExpanded && (
          <div className="ml-9 space-y-0.5">
            {recentChats.length === 0 ? (
              <p className="text-xs text-matrix-text-faint py-1 px-2">No conversations</p>
            ) : (
              recentChats.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center rounded px-2 py-1 transition-colors ${
                    location.pathname === `/chat/${c.id}`
                      ? "text-matrix-accent"
                      : "text-matrix-text-faint hover:text-matrix-text"
                  }`}
                >
                  <button
                    onClick={() => navigate(`/chat/${c.id}`)}
                    className="flex-1 truncate text-left text-xs"
                  >
                    {c.title ?? "Untitled"}
                  </button>
                </div>
              ))
            )}
            <button
              onClick={() => navigate("/chats")}
              className="block w-full text-left px-2 py-1 text-xs text-matrix-text-faint hover:text-matrix-accent transition-colors"
            >
              Manage all →
            </button>
          </div>
        )}

        {/* Divider */}
        <div className="my-1 border-t border-matrix-border" />

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
          className="flex w-full items-center justify-center rounded-lg py-2.5 text-matrix-text-dim hover:bg-matrix-hover hover:text-matrix-text transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name={collapsed ? "collapse-right" : "collapse-left"} className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}
