import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import AppRoutes from "@/routes";

export default function App() {
  const { isAuthenticated, fetchUser } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      fetchUser();
    }
  }, [isAuthenticated, fetchUser]);

  return <AppRoutes />;
}
