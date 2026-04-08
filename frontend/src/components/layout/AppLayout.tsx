import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import MatrixRain from "@/components/MatrixRain";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const apply = useThemeStore((s) => s.apply);
  const background = useThemeStore((s) => s.background);
  const rainBaseSpeed = useThemeStore((s) => s.rainBaseSpeed);
  const streamingIntensity = useThemeStore((s) => s.streamingIntensity);

  // Ensure theme CSS variables are set on mount
  useEffect(() => { apply(); }, [apply]);

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen overflow-hidden relative">
      {background === "matrix-rain" && (
        <MatrixRain baseSpeed={rainBaseSpeed} intensity={streamingIntensity} />
      )}
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className="relative z-[1] flex-1 overflow-y-auto h-full">
        <Outlet />
      </main>
    </div>
  );
}
