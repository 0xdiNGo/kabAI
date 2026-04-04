export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent_id: string | null;
  agent_name: string | null;
  model_used: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  agent_id: string | null;
  agent_ids: string[];
  model: string | null;
  is_collaboration: boolean;
  collaboration_mode: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}
