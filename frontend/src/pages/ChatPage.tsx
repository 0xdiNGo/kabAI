import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { streamPost } from "@/lib/sse";
import type { ConversationDetail, Message } from "@/types/conversation";

function ThinkingText({ phrases }: { phrases: string[] }) {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    if (phrases.length <= 1) return;
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % phrases.length);
        setFade(true);
      }, 400);
    }, 2500);
    return () => clearInterval(interval);
  }, [phrases]);

  // Reset index when phrases change
  useEffect(() => {
    setIndex(0);
    setFade(true);
  }, [phrases.length]);

  return (
    <span
      className="text-sm text-matrix-text-dim inline-block transition-opacity duration-400"
      style={{ opacity: fade ? 1 : 0 }}
    >
      {phrases[index % phrases.length] ?? "Thinking..."}
    </span>
  );
}

const AGENT_COLORS = [
  "#fe8019", // gruvbox orange
  "#b8bb26", // gruvbox green
  "#83a598", // gruvbox blue
  "#d3869b", // gruvbox purple
  "#fabd2f", // gruvbox yellow
  "#8ec07c", // gruvbox aqua
  "#fb4934", // gruvbox red
  "#ebdbb2", // gruvbox fg
];

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [thinkingPhrases, setThinkingPhrases] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [isRoundtable, setIsRoundtable] = useState(false);
  const isRoundtableRef = useRef(false);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [currentAgent, setCurrentAgent] = useState<{ id: string; name: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!conversationId) return;

    // Load conversation and check if background processing is active
    const load = async () => {
      try {
        const convo = await api.get<ConversationDetail>(`/conversations/${conversationId}`);
        setMessages(convo.messages);
        setTitle(convo.title);
        const rt = convo.collaboration_mode === "roundtable";
        setIsRoundtable(rt);
        isRoundtableRef.current = rt;
        setAgentIds(convo.agent_ids ?? []);

        // Check for active background task and reconnect
        const { status } = await api.get<{ status: string }>(`/conversations/${conversationId}/status`);
        if (status === "processing") {
          setIsStreaming(true);
          setIsThinking(true);
          setThinkingPhrases(["Reconnecting...", "Processing in background..."]);

          // Reconnect to the event stream
          abortRef.current = streamPost(
            `/api/v1/conversations/${conversationId}/messages/stream`,
            { content: "" },
            {
              onMessage: handleStreamEvent,
              onDone: () => { setIsStreaming(false); setCurrentAgent(null); setIsThinking(false); },
              onError: () => { setIsStreaming(false); setCurrentAgent(null); setIsThinking(false); },
            },
          );
        }
      } catch {
        // ignore
      }
    };
    load();

    return () => {
      // Don't abort on unmount — let the background task continue
      abortRef.current = null;
    };
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const getAgentColor = (agentId: string | null) => {
    if (!agentId) return AGENT_COLORS[0];
    const idx = agentIds.indexOf(agentId);
    return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0];
  };

  const handleStreamEvent = useCallback((data: string) => {
    try {
      const event = JSON.parse(data);

      if (event.type === "round_start") {
        // Show round separator in messages
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: event.round === 1
              ? `Round ${event.round} of ${event.max_rounds}`
              : `Round ${event.round} of ${event.max_rounds} — continuing discussion`,
            agent_id: null,
            agent_name: null,
            model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
      } else if (event.type === "consensus") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Consensus reached in round ${event.round} — ${event.passes} of ${event.total} agents passed`,
            agent_id: null,
            agent_name: null,
            model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
      } else if (event.type === "agent_turn") {
        setStreamContent("");
        setIsStreaming(true);
        setCurrentAgent({ id: event.agent_id, name: event.agent_name });
        setIsThinking(true);
        setThinkingPhrases([`${event.agent_name} is thinking...`]);
      } else if (event.type === "status") {
        const phrase =
          event.status === "thinking"
            ? event.agent_name ? `${event.agent_name} is thinking...` : "Thinking..."
            : event.status === "connecting"
              ? `Connecting to ${event.model ?? "model"}...`
              : event.status === "generating"
                ? "Generating response..."
                : "Processing...";
        setThinkingPhrases((prev) => {
          if (prev.includes(phrase)) return prev;
          return [...prev, phrase];
        });
      } else if (event.type === "token") {
        setIsThinking(false);
        setStreamContent((prev) => prev + event.content);
      } else if (event.type === "done") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: event.content,
            agent_id: event.agent_id ?? null,
            agent_name: event.agent_name ?? null,
            model_used: event.model_used,
            created_at: new Date().toISOString(),
          },
        ]);
        setStreamContent("");
        setIsThinking(false);
        if (!isRoundtableRef.current) {
          setIsStreaming(false);
          setCurrentAgent(null);
        }
      } else if (event.type === "agent_pass") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "[PASS]",
            agent_id: event.agent_id,
            agent_name: event.agent_name,
            model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
        setStreamContent("");
        setIsThinking(false);
      } else if (event.type === "round_done") {
        setIsStreaming(false);
        setCurrentAgent(null);
        setStreamContent("");
        setIsThinking(false);
      } else if (event.type === "agent_error") {
        // Agent failed in roundtable — show error message, continue to next agent
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${event.detail}`,
            agent_id: event.agent_id,
            agent_name: event.agent_name,
            model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
        setStreamContent("");
        setIsThinking(false);
      } else if (event.type === "keepalive") {
        // ignore keepalives
      } else if (event.type === "error") {
        setIsStreaming(false);
        setIsThinking(false);
        setCurrentAgent(null);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const handleStreamDone = useCallback(() => {
    setIsStreaming(false);
    setCurrentAgent(null);
    setIsThinking(false);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !conversationId) return;

    if (isStreaming && abortRef.current) {
      abortRef.current();
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      agent_id: null,
      agent_name: null,
      model_used: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setStreamContent("");
    setCurrentAgent(null);
    setIsThinking(true);
    setThinkingPhrases(["Thinking..."]);

    abortRef.current = streamPost(
      `/api/v1/conversations/${conversationId}/messages/stream`,
      { content: input },
      {
        onMessage: handleStreamEvent,
        onDone: handleStreamDone,
        onError: handleStreamDone,
      },
    );
  }, [input, conversationId, isStreaming, handleStreamEvent, handleStreamDone]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b border-matrix-border px-6 py-3 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/")}
            className="text-sm text-matrix-text-dim hover:text-matrix-text-bright transition-colors"
          >
            &larr; Dashboard
          </button>
          <h1 className="font-semibold">{title ?? "Chat"}</h1>
        </div>
        {isRoundtable && (
          <span className="rounded-full bg-matrix-purple-dim/30 px-3 py-1 text-xs text-matrix-purple">
            Roundtable
          </span>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) =>
          msg.role === "system" ? (
            <div key={msg.id} className="flex justify-center">
              <span className="rounded-full bg-matrix-card px-4 py-1.5 text-xs text-matrix-text-dim">
                {msg.content}
              </span>
            </div>
          ) : (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[70%] ${msg.role === "user" ? "" : ""}`}>
              {/* Agent name label */}
              {msg.role === "assistant" && msg.agent_name && (
                <p
                  className="text-xs font-medium mb-1 ml-1"
                  style={{ color: getAgentColor(msg.agent_id) }}
                >
                  {msg.agent_name}
                </p>
              )}
              <div
                className={`rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-matrix-accent text-matrix-bg"
                    : msg.content === "[PASS]"
                      ? "bg-matrix-input/50 text-matrix-text-faint italic"
                      : "bg-matrix-input text-matrix-text-bright"
                }${
                  msg.role === "assistant" && msg.agent_name && msg.agent_id
                    ? " border-l-2"
                    : ""
                }`}
                style={
                  msg.role === "assistant" && msg.agent_name && msg.agent_id
                    ? { borderLeftColor: getAgentColor(msg.agent_id) }
                    : undefined
                }
              >
                <p className="whitespace-pre-wrap">
                  {msg.content === "[PASS]" ? `${msg.agent_name ?? "Agent"} passed` : msg.content}
                </p>
                {msg.model_used && msg.content !== "[PASS]" && (
                  <p className="mt-1 text-xs opacity-60">{msg.model_used}</p>
                )}
              </div>
            </div>
          </div>
          )
        )}

        {/* Thinking indicator */}
        {isStreaming && isThinking && (
          <div className="flex justify-start">
            <div className="max-w-[70%]">
              {isRoundtable && currentAgent && (
                <p
                  className="text-xs font-medium mb-1 ml-1"
                  style={{ color: getAgentColor(currentAgent.id) }}
                >
                  {currentAgent.name}
                </p>
              )}
              <div
                className={`rounded-xl bg-matrix-input px-4 py-3${
                  isRoundtable && currentAgent ? " border-l-2" : ""
                }`}
                style={
                  isRoundtable && currentAgent
                    ? { borderLeftColor: getAgentColor(currentAgent.id) }
                    : undefined
                }
              >
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 rounded-full bg-matrix-accent animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <ThinkingText phrases={thinkingPhrases} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Streaming content */}
        {isStreaming && streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[70%]">
              {isRoundtable && currentAgent && (
                <p
                  className="text-xs font-medium mb-1 ml-1"
                  style={{ color: getAgentColor(currentAgent.id) }}
                >
                  {currentAgent.name}
                </p>
              )}
              <div
                className={`rounded-xl bg-matrix-input px-4 py-3${
                  isRoundtable && currentAgent ? " border-l-2" : ""
                }`}
                style={
                  isRoundtable && currentAgent
                    ? { borderLeftColor: getAgentColor(currentAgent.id) }
                    : undefined
                }
              >
                <p className="whitespace-pre-wrap">{streamContent}</p>
                <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-matrix-border p-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRoundtable ? "Send a message to all agents..." : "Type a message..."}
            rows={1}
            className="flex-1 resize-none rounded-xl bg-matrix-input px-4 py-3 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || (isStreaming && !isRoundtable)}
            className="rounded-xl bg-matrix-accent px-6 py-3 font-medium hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
