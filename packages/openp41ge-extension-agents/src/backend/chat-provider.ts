/**
 * ChatProvider interface — provider-agnostic LLM chat streaming.
 *
 * A provider wraps a single backend (vLLM now; others later) and exposes a
 * narrow contract: stream a chat completion and ping. Delta granularity is
 * text fragments and tool-call requests, which the AgentRuntime folds into the
 * chat transcript.
 */

import type { ChatMessage } from "../chat/types.js";
import type { ToolDefinition } from "./tool.js";

/** Provider connection config (the extension config's `providers`). */
export interface ChatProviderConfig {
  baseUrl: string;
  /** The default model id used when a chat doesn't pick one explicitly. */
  defaultModel: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  /** Friendly display name — settings UI only, ignored by the runtime. */
  name?: string;
  /** Available models — settings UI only, ignored by the runtime. */
  models?: { id: string }[];
}

/** Token usage reported by a provider completion. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Local approximation of generation throughput (completion tokens / sec). */
  tokensPerSecond?: number;
}

/** Streamed delta from a provider. */
export type ProviderDelta =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "usage"; usage: TokenUsage; elapsedMs?: number; live?: boolean };

/** Input to a streamChat call. */
export interface ChatStreamRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  /** Reasoning-effort level selected in the composer ("Off"/"Low"/"Medium"/"High"). */
  thinking?: string;
}

/** A single provider implementation (registry/strategy based — Open/Closed). */
export interface ChatProvider {
  readonly id: string;
  readonly label: string;
  /** Stream a chat completion, yielding text + tool-call deltas. */
  streamChat(req: ChatStreamRequest): AsyncIterable<ProviderDelta>;
  /** True when the provider is reachable/configured; resolves quickly. */
  ping(): Promise<boolean>;
}

/** A provider factory — creates a configured provider from persisted config. */
export interface ChatProviderFactory {
  readonly id: string;
  readonly label: string;
  create(config: ChatProviderConfig): ChatProvider;
}
