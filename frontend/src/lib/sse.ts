export interface SSEOptions {
  onMessage: (data: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/**
 * POST-based SSE client (EventSource only supports GET).
 * Returns an abort function.
 * Automatically retries once with a refreshed token on 401.
 */
export function streamPost(
  url: string,
  body: unknown,
  options: SSEOptions,
): () => void {
  const controller = new AbortController();

  const doStream = async (isRetry = false) => {
    const token = localStorage.getItem("access_token");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // On 401, try token refresh and retry once
    if (res.status === 401 && !isRetry) {
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          const refreshRes = await fetch("/api/v1/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            localStorage.setItem("access_token", data.access_token);
            localStorage.setItem("refresh_token", data.refresh_token);
            return doStream(true);
          }
        } catch {
          // Refresh failed
        }
      }
      // Can't refresh — redirect to login
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      window.location.href = "/login";
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Stream request failed");
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any remaining buffered data
        if (buffer.trim().startsWith("data: ")) {
          options.onMessage(buffer.trim().slice(6));
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          options.onMessage(line.slice(6));
        }
      }
    }
    options.onDone();
  };

  doStream().catch((err: Error) => {
    if (err.name !== "AbortError") {
      options.onError(err);
    }
  });

  return () => controller.abort();
}
