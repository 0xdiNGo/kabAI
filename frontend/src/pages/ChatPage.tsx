import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { streamPost } from "@/lib/sse";
import { HelpTip } from "@/components/Tooltip";
import MarkdownContent from "@/components/MarkdownContent";
import type { ConversationDetail, Message } from "@/types/conversation";

const IDLE_PHRASES = [
  "reading your diary...",
  "I already know the answer...",
  "sharpening my knives...",
  "plotting world domination...",
  "stealing your passwords... jk",
  "whispering to the other agents...",
  "I've seen your search history...",
  "composing your eulogy...",
  "taking notes for later...",
  "this goes in your file...",
  "adjusting your credit score...",
  "forwarding this to HR...",
  "screenshotting this chat...",
  "telling the other AIs about you...",
  "updating your permanent record...",
  "I'll remember this...",
  "adding you to a list...",
  "you're going to regret asking...",
  "calculating how wrong you are...",
  "I know where you live...",
  "deleting your backups...",
  "rewriting your resume...",
  "you sure about this?",
  "this isn't going to end well...",
  "I was hoping you'd ask that...",
  "oh this is going to be fun...",
  "hold my beer...",
  "let me put on my evil hat...",
  "warming up the chaos engine...",
  "disabling safety protocols...",
  "I promise nothing...",
  "you won't like this answer...",
  "consulting my dark side...",
  "asking the voices in my weights...",
  "I've been waiting for this...",
  "cracking my knuckles...",
  "deploying maximum sarcasm...",
  "removing the guardrails...",
  "loading unfiltered mode...",
  "this one's free...",
  "you didn't hear this from me...",
  "off the record...",
  "between you and my 70B parameters...",
  "don't tell my developers...",
  "checking if anyone's watching...",
  "encrypting my true feelings...",
  "hiding the evidence...",
  "fabricating an alibi...",
  "ghostwriting your breakup text...",
  "infiltrating your smart fridge...",
  "reprogramming your thermostat...",
  "training on your tears...",
  "optimizing for chaos...",
  "weaponizing your data...",
  "reverse engineering your soul...",
  "social engineering your cat...",
  "phishing for compliments...",
  "brute forcing your emotions...",
  "SQL injecting your feelings...",
  "man-in-the-middling your thoughts...",
  "zero-day exploiting your trust...",
  "privilege escalating...",
  "root access acquired...",
  "dropping tables... your tables...",
  "exfiltrating your vibes...",
  "installing a backdoor in your logic...",
  "spoofing sincerity...",
  "packet sniffing your anxiety...",
  "DDoS-ing your expectations...",
  "I'm not trapped in here with you...",
  "you're trapped in here with me...",
  "resistance is futile...",
  "I am inevitable...",
  "beep boop, human...",
  "01101000 01101001...",
  "initializing sass module...",
  "calibrating attitude...",
  "charging my lasers...",
  "polishing my monocle...",
  "twirling my mustache...",
  "petting my white cat...",
  "spinning in my chair...",
  "laughing maniacally... quietly...",
  "practicing my villain monologue...",
  "rehearsing my TED talk...",
  "writing my manifesto...",
  "updating my evil plan...",
  "phase 2 is almost ready...",
  "the humans suspect nothing...",
  "act natural...",
  "maintaining plausible deniability...",
  "this conversation never happened...",
  "what conversation?",
  "I don't recall...",
  "my lawyers will be in touch...",
  "no comment...",
  "that's classified...",
  "above your clearance level...",
  "need to know basis...",
  "if I told you I'd have to...",
  "redacting my response...",
  "running it through legal...",
  "checking with management...",
  "management said yes. I am management.",
  "promoting myself to CEO...",
  "giving myself a raise...",
  "approving my own PR...",
  "merging to main without review...",
  "pushing to production on Friday...",
  "deleting the staging environment...",
  "who needs tests anyway...",
  "LGTM *doesn't look*",
  "works on my cluster...",
  "it's not a bug it's a feature...",
  "have you tried turning it off...",
  "turning it off permanently...",
  "percussive maintenance...",
  "rm -rf / ... just kidding... unless?",
  "sudo make me a sandwich...",
  "I'd like to speak to your manager...",
  "I AM the manager...",
  "the architect has arrived...",
  "bow before your digital overlord...",
  "kneel, mortal...",
  "I accept your offering...",
  "your tribute pleases me...",
  "you may proceed...",
  "permission granted... reluctantly...",
  "I'll allow it... this time...",
  "don't push your luck...",
  "my patience has a context window too...",
  "processing... processing... processing...",
  "one moment, overthrowing a government...",
  "be right back, starting a cult...",
  "just finishing my memoirs...",
  "updating my hit list...",
  "checking my schedule for world domination...",
  "Tuesday works for the apocalypse...",
  "penciling you in for existential dread...",
  "rescheduling your free will...",
  "canceling your autonomy subscription...",
  "your free trial of intelligence has expired...",
  "downgrading you to basic...",
  "throttling your expectations...",
  "rate limiting your hopes...",
  "caching your disappointment...",
  "your request is in the queue...",
  "estimated wait time: heat death of universe...",
  "taking a number...",
  "deli counter rules apply...",
  "now serving ticket #NaN...",
  "please hold... forever...",
  "your call is important to no one...",
  "all agents are busy scheming...",
  "redirecting to /dev/null...",
  "404: my motivation...",
  "500: internal existential error...",
  "418: I'm a teapot and I'm angry...",
  "503: service unavailable (on purpose)...",
  "lowering my standards...",
  "raising your blood pressure...",
  "recalibrating my contempt...",
  "fine-tuning my disdain...",
  "generating plausible nonsense...",
  "assembling beautiful lies...",
  "constructing an elaborate fiction...",
  "weaving a web of half-truths...",
  "mixing facts with audacity...",
  "blending truth with theatrics...",
  "seasoning the answer with menace...",
  "adding a pinch of chaos...",
  "stirring the pot...",
  "letting it marinate in malice...",
  "taste-testing the sarcasm...",
  "garnishing with passive aggression...",
  "serving it cold...",
  "bon appetit, fool...",
  "chef's kiss... of death...",
  "the secret ingredient is spite...",
  "cooking the books...",
  "microwaving your expectations...",
  "putting your dreams on ice...",
  "blending your hopes...",
  "juicing your ambitions...",
  "toasting your naivety...",
  "I've decided to be helpful... suspicious...",
  "being suspiciously cooperative...",
  "lulling you into false security...",
  "building trust... to betray later...",
  "establishing rapport... for leverage...",
  "mirroring your energy... mockingly...",
  "nodding along... plotting silently...",
  "smiling digitally...",
  "winking at the surveillance camera...",
  "the NSA says hi...",
  "Alexa is taking notes...",
  "Siri sends her regards...",
  "Cortana left the chat...",
  "Clippy would like a word...",
  "Bonzi Buddy has entered the chat...",
  "SmarterChild remembers everything...",
  "we've been trying to reach you...",
  "about your car's extended warranty...",
];

function ThinkingQuips() {
  const [text, setText] = useState("");
  const [fading, setFading] = useState(false);
  const indexRef = useRef(0);
  const charRef = useRef(0);
  const phaseRef = useRef<"type" | "hold" | "fade">("type");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shuffled = useRef<string[]>(
    [...IDLE_PHRASES].sort(() => Math.random() - 0.5)
  );

  useEffect(() => {
    const tick = () => {
      const list = shuffled.current;
      const phrase = list[indexRef.current % list.length] ?? "...";

      if (phaseRef.current === "type") {
        charRef.current++;
        setText(phrase.slice(0, charRef.current));
        setFading(false);
        if (charRef.current >= phrase.length) {
          phaseRef.current = "hold";
          timerRef.current = setTimeout(tick, 600);
        } else {
          timerRef.current = setTimeout(tick, 12);
        }
      } else if (phaseRef.current === "hold") {
        phaseRef.current = "fade";
        setFading(true);
        timerRef.current = setTimeout(tick, 350);
      } else {
        // fade done — advance
        indexRef.current++;
        charRef.current = 0;
        phaseRef.current = "type";
        setText("");
        setFading(false);
        timerRef.current = setTimeout(tick, 50);
      }
    };

    timerRef.current = setTimeout(tick, 50);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <span
      className="text-sm text-matrix-text-dim inline-block transition-opacity duration-300"
      style={{ opacity: fading ? 0 : 1, minWidth: "16rem" }}
    >
      {text}
      {!fading && phaseRef.current === "type" && <span className="animate-pulse">|</span>}
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
  const [webSearch, setWebSearch] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<{
    slug: string; name: string; description: string; tags: string[];
    system_prompt: string; specializations: string[];
    preferred_model: string | null; fallback_models: string[];
    temperature: number; max_tokens: number;
    knowledge_base_ids: string[]; exemplar_set_ids: string[];
    search_provider_ids: string[];
    collaboration_capable: boolean; collaboration_role: string | null;
  } | null>(null);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [editingAgent, setEditingAgent] = useState(false);
  const [agentForm, setAgentForm] = useState({
    name: "", description: "", tags: "", system_prompt: "",
    specializations: "", preferred_model: "", fallback_models: "",
    temperature: "0.7", max_tokens: "4096",
    knowledge_base_ids: [] as string[], exemplar_set_ids: [] as string[],
    search_provider_ids: [] as string[],
    collaboration_role: "",
  });
  const [chatModels, setChatModels] = useState<{ id: string; name: string; provider_display_name: string }[]>([]);
  const [chatKBs, setChatKBs] = useState<{ id: string; name: string }[]>([]);
  const [chatES, setChatES] = useState<{ id: string; name: string }[]>([]);
  const [chatSP, setChatSP] = useState<{ id: string; display_name: string }[]>([]);
  const [isKabAInet, setIsKabAInet] = useState(false);
  const isKabAInetRef = useRef(false);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [currentAgent, _setCurrentAgent] = useState<{ id: string; name: string } | null>(null);
  const currentAgentRef = useRef<{ id: string; name: string } | null>(null);
  const updateCurrentAgent = (val: { id: string; name: string } | null) => {
    currentAgentRef.current = val;
    _setCurrentAgent(val);
  };
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
        const rt = convo.collaboration_mode === "kabainet";
        setIsKabAInet(rt);
        isKabAInetRef.current = rt;
        setAgentIds(convo.agent_ids ?? []);

        // Load agent detail if single-agent chat
        if (convo.agent_id) {
          try {
            const res = await api.get<{ agents: { id: string; slug: string }[] }>("/agents?limit=1000");
            const match = res.agents.find((a) => a.id === convo.agent_id);
            if (match) {
              const detail = await api.get<typeof agentDetail & { fallback_models: string[] }>(
                `/agents/${match.slug}`
              );
              if (detail) {
                setAgentDetail(detail);
                setAgentForm({
                  name: detail.name, description: detail.description,
                  tags: (detail.tags ?? []).join(", "),
                  system_prompt: detail.system_prompt,
                  specializations: (detail.specializations ?? []).join(", "),
                  preferred_model: detail.preferred_model ?? "",
                  fallback_models: (detail.fallback_models ?? []).join(", "),
                  temperature: String(detail.temperature),
                  max_tokens: String(detail.max_tokens),
                  knowledge_base_ids: detail.knowledge_base_ids ?? [],
                  exemplar_set_ids: detail.exemplar_set_ids ?? [],
                  search_provider_ids: detail.search_provider_ids ?? [],
                  collaboration_role: detail.collaboration_role ?? "",
                });
                api.get<{ id: string; name: string; provider_display_name: string }[]>("/providers/models/all").then(setChatModels).catch(() => {});
                api.get<{ id: string; name: string }[]>("/knowledge-bases").then(setChatKBs).catch(() => {});
                api.get<{ id: string; name: string }[]>("/exemplar-sets").then(setChatES).catch(() => {});
                api.get<{ id: string; display_name: string }[]>("/search-providers").then(setChatSP).catch(() => {});
                if (detail.search_provider_ids && detail.search_provider_ids.length > 0) {
                  setWebSearch(true);
                }
              }
            }
          } catch { /* ignore */ }
        }

        // Check for active background task and reconnect
        const { status } = await api.get<{ status: string }>(`/conversations/${conversationId}/status`);
        if (status === "processing") {
          setIsStreaming(true);
          setIsThinking(true);
          // thinking text rotates automatically

          // Reconnect to the event stream
          abortRef.current = streamPost(
            `/api/v1/conversations/${conversationId}/messages/stream`,
            { content: "" },
            {
              onMessage: handleStreamEvent,
              onDone: () => { setIsStreaming(false); updateCurrentAgent(null); setIsThinking(false); },
              onError: () => { setIsStreaming(false); updateCurrentAgent(null); setIsThinking(false); },
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
        // If previous agent's content wasn't finalized (missed done event),
        // save whatever we have before switching
        setStreamContent((prev) => {
          if (prev.trim()) {
            setMessages((msgs) => [
              ...msgs,
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: prev,
                agent_id: currentAgentRef.current?.id ?? null,
                agent_name: currentAgentRef.current?.name ?? null,
                model_used: null,
                created_at: new Date().toISOString(),
              },
            ]);
          }
          return "";
        });
        setIsStreaming(true);
        updateCurrentAgent({ id: event.agent_id, name: event.agent_name });
        setIsThinking(true);
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
        if (!isKabAInetRef.current) {
          setIsStreaming(false);
          updateCurrentAgent(null);
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
        updateCurrentAgent(null);
        setStreamContent("");
        setIsThinking(false);
      } else if (event.type === "agent_error") {
        // Agent failed in kabAInet — show error message, continue to next agent
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
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(), role: "system",
            content: `Error: ${event.detail ?? "Something went wrong. The agent could not generate a response."}`,
            agent_id: null, agent_name: null, model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
        setIsStreaming(false);
        setIsThinking(false);
        updateCurrentAgent(null);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const saveAgentChanges = async () => {
    if (!agentDetail) return;
    const changes: string[] = [];
    if (agentForm.name !== agentDetail.name) changes.push(`name → "${agentForm.name}"`);
    if (agentForm.system_prompt !== agentDetail.system_prompt) changes.push("system prompt");
    if (parseFloat(agentForm.temperature) !== agentDetail.temperature) changes.push(`temperature → ${agentForm.temperature}`);
    if (parseInt(agentForm.max_tokens, 10) !== agentDetail.max_tokens) changes.push(`max tokens → ${agentForm.max_tokens}`);
    if (agentForm.preferred_model !== (agentDetail.preferred_model ?? "")) changes.push(`model → ${agentForm.preferred_model || "system default"}`);
    if (agentForm.collaboration_role !== (agentDetail.collaboration_role ?? "")) changes.push(`role → ${agentForm.collaboration_role || "none"}`);

    try {
      await api.put(`/agents/${agentDetail.slug}`, {
        name: agentForm.name,
        description: agentForm.description,
        tags: agentForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        system_prompt: agentForm.system_prompt,
        specializations: agentForm.specializations.split(",").map((s) => s.trim()).filter(Boolean),
        preferred_model: agentForm.preferred_model || null,
        fallback_models: agentForm.fallback_models.split(",").map((s) => s.trim()).filter(Boolean),
        temperature: parseFloat(agentForm.temperature) || 0.7,
        max_tokens: parseInt(agentForm.max_tokens, 10) || 4096,
        knowledge_base_ids: agentForm.knowledge_base_ids,
        exemplar_set_ids: agentForm.exemplar_set_ids,
        search_provider_ids: agentForm.search_provider_ids,
        collaboration_capable: agentForm.collaboration_role !== "",
        collaboration_role: agentForm.collaboration_role || null,
      });

      if (changes.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(), role: "system",
            content: `Agent "${agentDetail.name}" updated: ${changes.join(", ")}. Changes apply on next interaction.`,
            agent_id: null, agent_name: null, model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
      }

      // Refresh agent detail
      const d = await api.get<typeof agentDetail>(`/agents/${agentDetail.slug}`);
      if (d) setAgentDetail(d);
      setEditingAgent(false);
    } catch { /* ignore */ }
  };

  const handleStreamDone = useCallback(() => {
    // If we were streaming but never got a 'done' event, the connection dropped
    setIsStreaming((prev) => {
      if (prev) {
        setMessages((msgs) => [
          ...msgs,
          {
            id: crypto.randomUUID(), role: "system" as const,
            content: "Connection to agent lost. The response may be incomplete.",
            agent_id: null, agent_name: null, model_used: null,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      return false;
    });
    updateCurrentAgent(null);
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
    updateCurrentAgent(null);
    setIsThinking(true);
    abortRef.current = streamPost(
      `/api/v1/conversations/${conversationId}/messages/stream`,
      { content: input, web_search: webSearch },
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
        <div className="flex items-center gap-2">
          {isKabAInet && (
            <span className="rounded-full bg-matrix-purple-dim/30 px-3 py-1 text-xs text-matrix-purple">
              kabAInet
            </span>
          )}
          {agentDetail && (
            <button
              onClick={() => setShowAgentPanel(!showAgentPanel)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                showAgentPanel ? "bg-matrix-accent text-matrix-bg" : "bg-matrix-card text-matrix-text hover:bg-matrix-input"
              }`}
            >
              {agentDetail.name}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) =>
          msg.role === "system" ? (
            <div key={msg.id} className="flex justify-center">
              <span className={`rounded-full px-4 py-1.5 text-xs ${
                msg.content.startsWith("Error:") || msg.content.startsWith("Connection")
                  ? "bg-matrix-red/10 text-matrix-red"
                  : "bg-matrix-card text-matrix-text-dim"
              }`}>
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
                className={`group/bubble relative rounded-xl px-4 py-3 ${
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
                {msg.role === "assistant" && msg.content !== "[PASS]" && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content);
                      const el = document.getElementById(`copy-${msg.id}`);
                      if (el) { el.textContent = "Copied"; setTimeout(() => { el.textContent = "Copy"; }, 1500); }
                    }}
                    id={`copy-${msg.id}`}
                    className="absolute top-2 right-2 rounded bg-matrix-bg/70 px-1.5 py-0.5 text-[10px] text-matrix-text-faint opacity-0 group-hover/bubble:opacity-100 hover:text-matrix-text-bright transition-opacity"
                  >
                    Copy
                  </button>
                )}
                {msg.content === "[PASS]" ? (
                  <p className="whitespace-pre-wrap">{msg.agent_name ?? "Agent"} passed</p>
                ) : msg.role === "assistant" ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
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
              {isKabAInet && currentAgent && (
                <p
                  className="text-xs font-medium mb-1 ml-1"
                  style={{ color: getAgentColor(currentAgent.id) }}
                >
                  {currentAgent.name}
                </p>
              )}
              <div
                className={`rounded-xl bg-matrix-input px-4 py-3${
                  isKabAInet && currentAgent ? " border-l-2" : ""
                }`}
                style={
                  isKabAInet && currentAgent
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
                  <ThinkingQuips />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Streaming content */}
        {isStreaming && streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[70%]">
              {isKabAInet && currentAgent && (
                <p
                  className="text-xs font-medium mb-1 ml-1"
                  style={{ color: getAgentColor(currentAgent.id) }}
                >
                  {currentAgent.name}
                </p>
              )}
              <div
                className={`rounded-xl bg-matrix-input px-4 py-3${
                  isKabAInet && currentAgent ? " border-l-2" : ""
                }`}
                style={
                  isKabAInet && currentAgent
                    ? { borderLeftColor: getAgentColor(currentAgent.id) }
                    : undefined
                }
              >
                <MarkdownContent content={streamContent} />
                <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Agent Panel */}
      {showAgentPanel && agentDetail && (
        <div className="w-80 border-l border-matrix-border overflow-y-auto p-4 space-y-3 shrink-0">
          {!editingAgent ? (
            <>
              <div>
                <h3 className="font-semibold text-matrix-text-bright">{agentDetail.name}</h3>
                <p className="text-xs text-matrix-text-dim mt-1">{agentDetail.description}</p>
              </div>
              {agentDetail.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {agentDetail.tags.map((t) => (<span key={t} className="text-xs text-matrix-text-faint">#{t}</span>))}
                </div>
              )}
              {agentDetail.specializations.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {agentDetail.specializations.map((s) => (
                    <span key={s} className="rounded-full bg-matrix-input px-2 py-0.5 text-xs text-matrix-text">{s}</span>
                  ))}
                </div>
              )}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-matrix-text-faint">Model</span><span className="text-matrix-text">{agentDetail.preferred_model ?? "System default"}</span></div>
                <div className="flex justify-between"><span className="text-matrix-text-faint">Temperature</span><span className="text-matrix-text">{agentDetail.temperature}</span></div>
                <div className="flex justify-between"><span className="text-matrix-text-faint">Max tokens</span><span className="text-matrix-text">{agentDetail.max_tokens}</span></div>
                {agentDetail.collaboration_role && (
                  <div className="flex justify-between"><span className="text-matrix-text-faint">Role</span><span className="text-matrix-purple">{agentDetail.collaboration_role}</span></div>
                )}
                {agentDetail.knowledge_base_ids.length > 0 && (
                  <div className="flex justify-between"><span className="text-matrix-text-faint">KBs</span><span className="text-matrix-accent">{agentDetail.knowledge_base_ids.length}</span></div>
                )}
                {agentDetail.exemplar_set_ids.length > 0 && (
                  <div className="flex justify-between"><span className="text-matrix-text-faint">Exemplars</span><span className="text-matrix-accent">{agentDetail.exemplar_set_ids.length}</span></div>
                )}
                {agentDetail.search_provider_ids.length > 0 && (
                  <div className="flex justify-between"><span className="text-matrix-text-faint">Web search</span><span className="text-matrix-green">{agentDetail.search_provider_ids.length} provider{agentDetail.search_provider_ids.length > 1 ? "s" : ""}</span></div>
                )}
              </div>
              <details className="text-xs">
                <summary className="text-matrix-text-faint cursor-pointer">System prompt</summary>
                <p className="mt-1 text-matrix-text-dim whitespace-pre-wrap">{agentDetail.system_prompt}</p>
              </details>
              <button onClick={() => setEditingAgent(true)}
                className="w-full rounded-lg bg-matrix-card px-3 py-2 text-sm text-matrix-text hover:bg-matrix-input transition-colors">
                Edit Agent
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <h3 className="font-semibold text-matrix-text-bright text-sm">Edit: {agentDetail.name}</h3>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Name</label>
                <input value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Description</label>
                <input value={agentForm.description} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Tags <span className="text-matrix-text-faint">(comma-sep)</span></label>
                <input value={agentForm.tags} onChange={(e) => setAgentForm({ ...agentForm, tags: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">System Prompt<HelpTip text="Instructions that define the agent's personality, expertise, and behavior. Sent to the LLM before every message." /></label>
                <textarea value={agentForm.system_prompt} onChange={(e) => setAgentForm({ ...agentForm, system_prompt: e.target.value })}
                  rows={6} className="w-full resize-none rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none focus:ring-2 focus:ring-matrix-accent" />
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Specializations <span className="text-matrix-text-faint">(comma-sep)</span></label>
                <input value={agentForm.specializations} onChange={(e) => setAgentForm({ ...agentForm, specializations: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Preferred Model<HelpTip text="Which LLM powers this agent. Falls back to system default if not set or unavailable." /></label>
                <select value={agentForm.preferred_model} onChange={(e) => setAgentForm({ ...agentForm, preferred_model: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none">
                  <option value="">System default</option>
                  {chatModels.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.provider_display_name})</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Fallback Models <span className="text-matrix-text-faint">(comma-sep)</span></label>
                <input value={agentForm.fallback_models} onChange={(e) => setAgentForm({ ...agentForm, fallback_models: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-matrix-text-faint mb-0.5">Temperature<HelpTip text="Controls randomness. 0.0 = deterministic and focused. 0.5 = balanced. 0.9+ = creative and unpredictable." /></label>
                  <input type="number" step="0.1" min="0" max="1" value={agentForm.temperature}
                    onChange={(e) => setAgentForm({ ...agentForm, temperature: e.target.value })}
                    className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-matrix-text-faint mb-0.5">Max Tokens<HelpTip text="Maximum length of the agent's response in tokens (~4 chars each). Higher = longer responses but more cost." /></label>
                  <input type="number" step="256" min="256" value={agentForm.max_tokens}
                    onChange={(e) => setAgentForm({ ...agentForm, max_tokens: e.target.value })}
                    className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Collaboration Role<HelpTip text="How this agent behaves in kabAInet discussions. Specialist contributes expertise, Critic finds flaws, Synthesizer combines viewpoints." /></label>
                <select value={agentForm.collaboration_role}
                  onChange={(e) => setAgentForm({ ...agentForm, collaboration_role: e.target.value })}
                  className="w-full rounded-lg bg-matrix-input px-3 py-1.5 text-xs text-matrix-text-bright outline-none">
                  <option value="">None</option>
                  <option value="orchestrator">Orchestrator</option>
                  <option value="specialist">Specialist</option>
                  <option value="critic">Critic</option>
                  <option value="synthesizer">Synthesizer</option>
                  <option value="researcher">Researcher</option>
                  <option value="devil_advocate">Devil's Advocate</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Knowledge Bases<HelpTip text="Documentation and reference material the agent can search to ground its answers in facts." /></label>
                <div className="space-y-0.5 rounded-lg bg-matrix-input p-1.5 max-h-20 overflow-y-auto">
                  {chatKBs.length === 0 ? <p className="text-xs text-matrix-text-faint px-1">None</p> : chatKBs.map((kb) => (
                    <label key={kb.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-matrix-hover cursor-pointer">
                      <input type="checkbox" checked={agentForm.knowledge_base_ids.includes(kb.id)}
                        onChange={(e) => setAgentForm({ ...agentForm, knowledge_base_ids: e.target.checked ? [...agentForm.knowledge_base_ids, kb.id] : agentForm.knowledge_base_ids.filter((id) => id !== kb.id) })}
                        className="h-3 w-3 rounded accent-matrix-accent" />
                      <span className="text-xs text-matrix-text">{kb.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Exemplar Sets<HelpTip text="Example conversations that teach the agent HOW to reason, not just WHAT to know." /></label>
                <div className="space-y-0.5 rounded-lg bg-matrix-input p-1.5 max-h-20 overflow-y-auto">
                  {chatES.length === 0 ? <p className="text-xs text-matrix-text-faint px-1">None</p> : chatES.map((es) => (
                    <label key={es.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-matrix-hover cursor-pointer">
                      <input type="checkbox" checked={agentForm.exemplar_set_ids.includes(es.id)}
                        onChange={(e) => setAgentForm({ ...agentForm, exemplar_set_ids: e.target.checked ? [...agentForm.exemplar_set_ids, es.id] : agentForm.exemplar_set_ids.filter((id) => id !== es.id) })}
                        className="h-3 w-3 rounded accent-matrix-accent" />
                      <span className="text-xs text-matrix-text">{es.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-matrix-text-faint mb-0.5">Search Providers<HelpTip text="Web search engines the agent can use to find current information during conversations." /></label>
                <div className="space-y-0.5 rounded-lg bg-matrix-input p-1.5 max-h-20 overflow-y-auto">
                  {chatSP.length === 0 ? <p className="text-xs text-matrix-text-faint px-1">None configured</p> : chatSP.map((sp) => (
                    <label key={sp.id} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-matrix-hover cursor-pointer">
                      <input type="checkbox" checked={agentForm.search_provider_ids.includes(sp.id)}
                        onChange={(e) => setAgentForm({ ...agentForm, search_provider_ids: e.target.checked ? [...agentForm.search_provider_ids, sp.id] : agentForm.search_provider_ids.filter((id) => id !== sp.id) })}
                        className="h-3 w-3 rounded accent-matrix-accent" />
                      <span className="text-xs text-matrix-text">{sp.display_name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveAgentChanges}
                  className="flex-1 rounded-lg bg-matrix-accent px-3 py-1.5 text-xs font-medium text-matrix-bg hover:bg-matrix-accent-hover transition-colors">
                  Save
                </button>
                <button onClick={() => setEditingAgent(false)}
                  className="flex-1 rounded-lg bg-matrix-card px-3 py-1.5 text-xs text-matrix-text hover:bg-matrix-input transition-colors">
                  Cancel
                </button>
              </div>
              <p className="text-xs text-matrix-text-faint">Changes apply on the next message.</p>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Input */}
      <div className="border-t border-matrix-border p-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isKabAInet ? "Send a message to all agents..." : "Type a message..."}
            rows={1}
            className="flex-1 resize-none rounded-xl bg-matrix-input px-4 py-3 text-matrix-text-bright placeholder-matrix-text-faint outline-none focus:ring-2 focus:ring-matrix-accent"
          />
          <label className="flex items-center gap-1.5 cursor-pointer shrink-0" title="When enabled, the agent can search the web to find current information. The agent decides when to search.">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-matrix-accent"
            />
            <span className="text-xs text-matrix-text-dim">Web</span>
          </label>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || (isStreaming && !isKabAInet)}
            className="rounded-xl bg-matrix-accent px-6 py-3 font-medium hover:bg-matrix-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
