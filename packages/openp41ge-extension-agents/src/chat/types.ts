/**
 * chat/types.ts — canonical chat data model types.
 *
 * These are plain, dependency-free TypeScript types shared by:
 *   - the <agents-chat> UI component (rendering),
 *   - the views (sidebars, chat pane),
 *   - the backend (chat store, agent runtime, providers).
 *
 * Nothing in this file imports Lit — it is the single source of truth for the
 * chat data shape.
 */

/** Status of a single tool call. */
export type ToolCallStatus = "running" | "done" | "error";

/** A tool invocation recorded in the transcript (name + arguments, not result). */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw command string (e.g. `cat package.json`) or structured JSON arguments. */
  arguments: string | Record<string, unknown>;
  status: ToolCallStatus;
  /** Set when status === "error". */
  error?: string;
  /** The command it ran (`run_command`): its tool call opens it in a terminal. */
  run?: { binary: string; args: string[]; repo: string; worktree: string; runId: string };
}

/** An ordered slice of an assistant message: streamed text, a tool call, or
 *  an error that ended the turn. */
export interface MessageSegment {
  type: "text" | "tool" | "error";
  /** Present when type === "text". */
  text?: string;
  /** Present when type === "tool". */
  toolCall?: ToolCall;
  /** For type === "error": the error's log entry id (opens it in the Logs
   *  window). Absent when nothing was logged. */
  errorId?: string;
}

/** Token usage reported by the provider for a single completion. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Local approximation of generation throughput (completion tokens per
   * second), measured by timing the stream. Undefined when unknown.
   */
  tokensPerSecond?: number;
}

/** A single message in a chat transcript. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  /** Only present on assistant messages that called tools. */
  toolCalls?: ToolCall[];
  /**
   * The model's reasoning/thinking text, streamed before the final answer.
   * Present on assistant messages from reasoning models.
   */
  reasoning?: string;
  /**
   * Ordered interleaving of text and tool calls for assistant messages, so the
   * UI can render tool calls inline at the position they occurred rather than
   * grouping all text above all tool calls. Absent on legacy messages.
   */
  segments?: MessageSegment[];
  /** For role === "tool": the id of the tool call this result answers. */
  toolCallId?: string;
  /** Token usage for the completion that produced this assistant message. */
  usage?: TokenUsage;
  timestamp: number;
}

/** A full chat conversation. */
export interface Chat {
  id: string;
  title: string;
  providerId: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Optional AI-written one-line summary shown in the sidebar. */
  description?: string;
  /** Set when the chat is archived — hidden from the default sidebar list. */
  archivedAt?: number;
}

/** Lightweight chat listing entry for the sidebar / search. */
export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  toolCallCount: number;
  lastMessagePreview?: string;
  /** AI-written one-line summary; shown as "No description" when absent. */
  description?: string;
  /** Set when the chat is archived (listed only when archived chats are asked for). */
  archivedAt?: number;
}

/** Search hit for a chat: which messages and tool calls matched. */
export interface ChatSearchResult {
  chatId: string;
  matchedMessageIds: string[];
  matchedToolCallIds: string[];
}

/** Options for chat search: regex mode + case sensitivity. */
export interface ChatSearchOptions {
  /** Treat the query as a regular expression. */
  regex?: boolean;
  /** Enable case-sensitive matching (default is case-insensitive). */
  caseSensitive?: boolean;
}

/** One occurrence of a query within a single chat transcript message.
 *
 * `text` is the matched substring as it appears in the message's flattened
 * searchable text; `order` is the 0-based occurrence index of that substring
 * within the same message. The renderer re-locates the occurrence in its own
 * DOM text (markdown-rendered) by searching for `text` and skipping `order`
 * prior occurrences, so byte offsets never have to agree across processes.
 */
export interface ChatTranscriptHit {
  messageId: string;
  /** The matched substring (as it appears in the flattened searchable text). */
  text: string;
  /** 0-based occurrence index of `text` within the message. */
  order: number;
  /** Transcript index of the message (0-based), so the client can fetch the
   *  page containing it if it is not currently loaded. */
  messageIndex: number;
}

/** A page slice of a chat transcript, fetched on demand from the main process
 *  so the renderer never has to hold an entire long conversation at once. */
export interface ChatTranscriptPage {
  chatId: string;
  /** Transcript index of `messages[0]`. */
  start: number;
  /** Total number of messages in the chat. */
  total: number;
  messages: ChatMessage[];
}

/** Lightweight chat metadata (no messages) for opening a chat without pulling
 *  the whole transcript into the renderer. */
export interface ChatHeader {
  id: string;
  title: string;
  providerId: string;
  totalMessages: number;
  description?: string;
}

/** Result of a Node-side in-chat search: the full ordered hit list plus the
 *  transcript-wide running total, sent back to the client for result cycling. */
export interface ChatTranscriptSearch {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  /** Transcript-wide number of matches (== hits.length). */
  total: number;
  hits: ChatTranscriptHit[];
}

/** Provider reachability / streaming status surfaced in the chat pane. */
export interface ChatRuntimeStatus {
  streaming: boolean;
  /** null = unknown/not yet checked; true/false = reachable/ping failed. */
  providerOk: boolean | null;
  providerLabel?: string;
}

/** Broadcast payload for `chat:delta` (streamed assistant text). */
export interface ChatDeltaPayload {
  chatId: string;
  delta: string;
}

/** Broadcast payload for `chat:reasoning` (streamed reasoning text). */
export interface ChatReasoningPayload {
  chatId: string;
  delta: string;
}

/** Broadcast payload for `chat:tool` (tool-call state change). */
export interface ChatToolPayload {
  chatId: string;
  toolCall: ToolCall;
  /** Final result (or error) content once the tool has completed. */
  result?: string;
}

/** Broadcast payload for `chat:status` (streaming/provider connection). */
export interface ChatStatusPayload {
  chatId: string;
  status: ChatRuntimeStatus;
}

/** Broadcast payload for `chat:usage` (token usage from a completion). */
export interface ChatUsagePayload {
  chatId: string;
  usage: TokenUsage;
}

/** Broadcast payload for `chat:error` (the turn failed; see the log entry). */
export interface ChatErrorPayload {
  chatId: string;
  errorId?: string;
}

/** Broadcast payload for `chat:liveRate` (live gen rate during streaming). */
export interface ChatLiveRatePayload {
  chatId: string;
  tps: number;
}

/**
 * A short, human-readable preview of a chat's latest activity.
 * Used by the sidebar rows and ChatSummary.lastMessagePreview.
 */
export function chatLastPreview(chat: Chat): string {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.role === "user" && m.content) return m.content.slice(0, 80);
    if (m.role === "assistant" && m.content) return m.content.slice(0, 80);
    if (m.role === "tool" && m.toolCalls?.length) {
      return `Tool: ${m.toolCalls.map((t) => t.name).join(", ")}`;
    }
  }
  return "";
}
