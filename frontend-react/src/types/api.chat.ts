/** Patient chat contract: the messages, replies and stream callbacks of a chat turn. */

export interface SavedAction {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatMessage {
  /** Server row id. Returned by GET /me/chat; used to tell whether history has changed. */
  id?: string | number;
  role: "user" | "assistant";
  message: string;
  saved_actions_json?: string;
  citations?: string[];
}

export interface ChatResponse {
  reply: string;
  saved_actions: SavedAction[];
  citations?: string[];
  assistant_message_id?: string | number;
}

export interface ChatStreamHandlers {
  onStage?: (label: string) => void;
  onDelta?: (text: string) => void;
}
