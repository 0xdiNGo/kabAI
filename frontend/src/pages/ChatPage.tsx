import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { streamPost } from "@/lib/sse";
import type { ConversationDetail, Message } from "@/types/conversation";

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    api
      .get<ConversationDetail>(`/conversations/${conversationId}`)
      .then((convo) => {
        setMessages(convo.messages);
        setTitle(convo.title);
      })
      .catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !conversationId || isStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      agent_id: null,
      model_used: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setStreamContent("");

    abortRef.current = streamPost(
      `/api/v1/conversations/${conversationId}/messages/stream`,
      { content: input },
      {
        onMessage: (data: string) => {
          try {
            const event = JSON.parse(data);
            if (event.type === "token") {
              setStreamContent((prev) => prev + event.content);
            } else if (event.type === "done") {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: event.content,
                  agent_id: null,
                  model_used: event.model_used,
                  created_at: new Date().toISOString(),
                },
              ]);
              setStreamContent("");
              setIsStreaming(false);
            }
          } catch {
            // ignore parse errors
          }
        },
        onDone: () => setIsStreaming(false),
        onError: () => setIsStreaming(false),
      },
    );
  }, [input, conversationId, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3">
        <h1 className="font-semibold">{title ?? "Chat"}</h1>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[70%] rounded-xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-100"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.model_used && (
                <p className="mt-1 text-xs opacity-60">{msg.model_used}</p>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {isStreaming && streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[70%] rounded-xl bg-gray-800 px-4 py-3">
              <p className="whitespace-pre-wrap">{streamContent}</p>
              <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none rounded-xl bg-gray-800 px-4 py-3 text-gray-100 placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="rounded-xl bg-blue-600 px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
