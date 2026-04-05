export interface SSEOptions {
  onMessage: (data: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/**
 * POST-based SSE client (EventSource only supports GET).
 * Returns an abort function.
 */
export function streamPost(
  url: string,
  body: unknown,
  options: SSEOptions,
): () => void {
  const controller = new AbortController();
  const token = localStorage.getItem("access_token");

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
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
    })
    .catch((err: Error) => {
      if (err.name !== "AbortError") {
        options.onError(err);
      }
    });

  return () => controller.abort();
}
