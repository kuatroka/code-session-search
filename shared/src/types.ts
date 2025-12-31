export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
}

export interface Session {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  projectName: string;
}

export interface ConversationMessage {
  type: "user" | "assistant" | "summary" | "file-history-snapshot";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
  summary?: string;
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface StreamResult {
  messages: ConversationMessage[];
  nextOffset: number;
}
