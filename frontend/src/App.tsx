import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import AppRoutes from "@/routes";
import CommandPalette from "@/components/CommandPalette";
import ToastContainer from "@/components/Toast";

export default function App() {
  const { isAuthenticated, fetchUser } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      fetchUser();
    }
  }, [isAuthenticated, fetchUser]);

  return (
    <>
      <AppRoutes />
      <CommandPalette />
      <ToastContainer />
    </>
  );
}
