import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { login, register } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (isRegister) {
        await register(username, email, password);
        await login(username, password);
      } else {
        await login(username, password);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-matrix-card p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Tiger Team</h1>
          <p className="mt-2 text-matrix-text-dim">
            {isRegister ? "Create an account" : "Sign in to continue"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg bg-matrix-input px-4 py-3 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
            required
          />
          {isRegister && (
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-matrix-input px-4 py-3 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
              required
            />
          )}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-matrix-input px-4 py-3 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
            required
          />
          {error && <p className="text-sm text-matrix-red">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-matrix-accent py-3 font-medium hover:bg-matrix-accent-hover transition-colors"
          >
            {isRegister ? "Register" : "Sign In"}
          </button>
        </form>

        <div className="text-center text-sm text-matrix-text-dim">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-matrix-accent hover:underline"
          >
            {isRegister ? "Sign in" : "Register"}
          </button>
        </div>

        {/* OAuth placeholder */}
        <div className="border-t border-matrix-border pt-4">
          <button
            disabled
            className="w-full rounded-lg border border-matrix-border py-3 text-matrix-text-faint cursor-not-allowed"
          >
            Sign in with SSO (coming soon)
          </button>
        </div>
      </div>
    </div>
  );
}
