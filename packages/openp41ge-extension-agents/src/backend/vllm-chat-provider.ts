/**
 * VllmChatProvider — OpenAI-compatible `/v1/chat/completions` SSE provider
 * for a local vLLM server.
 *
 * Reads the SSE stream line by line, parses `data:` JSON chunks, and yields:
 *   - `text` deltas for streaming assistant content,
 *   - `tool_call` deltas accumulated per tool-call index (arguments streamed
 *     as fragments are merged before being emitted).
 *
 * `ping()` probes `/v1/models` so the UI can show "connecting…" vs
 * "unreachable — configure in ⚙ Agent".
 */

import type {
  ChatProvider,
  ChatProviderConfig,
  ChatStreamRequest,
  ProviderDelta,
} from "./chat-provider.js";
import type { ToolDefinition } from "./tool.js";
import type { ChatMessage } from "../chat/types.js";
import { logFor } from "./log.js";

const log = logFor("vllm-chat-provider");

/** Resolve the composer's thinking level to the provider's reasoning_effort
 *  value. The value configured in the model's `thinking` map is passed through
 *  verbatim — the user defines the levels the provider understands in config.
 *  Only values that mean "off" (null, empty, "off", "none", "0") omit the
 *  field so the model applies its default behaviour. */
function resolveReasoningEffort(level?: string | null): string | undefined {
  if (level === undefined || level === null) return undefined;
  const t = level.trim();
  if (t === "" || /^(off|none|0)$/i.test(t)) return undefined;
  return t;
}

/** Convert our chat messages to the OpenAI chat-completions wire format. */
export function toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "system") {
      return { role: "system", content: m.content ?? "" };
    }
    if (m.role === "user") {
      return { role: "user", content: m.content ?? "" };
    }
    if (m.role === "assistant") {
      const out: Record<string, unknown> = { role: "assistant", content: m.content ?? "" };
      if (m.toolCalls && m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }));
      }
      return out;
    }
    // role === "tool"
    return {
      role: "tool",
      tool_call_id: m.toolCallId,
      content: m.content ?? "",
    };
  });
}

function toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Accumulator for one in-progress streaming tool call (index-keyed). */
interface ToolAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class VllmChatProvider implements ChatProvider {
  readonly id = "vllm";
  readonly label = "vLLM";

  constructor(private _config: ChatProviderConfig) {}

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseUrl()}/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { data?: unknown[] };
      return Array.isArray(data.data);
    } catch (err) {
      log.warn("ping failed:", (err as Error).message);
      return false;
    }
  }

  async *streamChat(req: ChatStreamRequest): AsyncIterable<ProviderDelta> {
    const body: Record<string, unknown> = {
      model: this._config.defaultModel,
      messages: toOpenAIMessages(req.messages),
      stream: true,
      // Request a final SSE chunk carrying `usage` so we can surface token
      // counts in the chat UI. vLLM does NOT include usage by default.
      stream_options: { include_usage: true },
    };
    if (this._config.temperature !== undefined) body.temperature = this._config.temperature;
    if (this._config.maxTokens !== undefined) body.max_tokens = this._config.maxTokens;
    if (req.tools && req.tools.length > 0) {
      body.tools = toOpenAITools(req.tools);
      body.tool_choice = "auto";
    }
    // Pass the composer's thinking level straight through as the provider's
    // reasoning_effort value (verbatim from config). Off/empty values leave
    // the setting absent so the model applies its default behaviour.
    const effort = resolveReasoningEffort(req.thinking);
    if (effort) body.reasoning_effort = effort;

    // Log the request so a failure that follows has the context of the call
    // that produced it (model, prompt size, tool count).
    const messageCount = req.messages.length;
    const promptChars = req.messages.reduce(
      (n, m) =>
        n +
        (typeof (m as { content?: unknown }).content === "string"
          ? (m as { content: string }).content.length
          : JSON.stringify((m as { content?: unknown }).content ?? "").length),
      0,
    );
    const toolCount = req.tools?.length ?? 0;
    log.debug("chat request", {
      model: this._config.defaultModel,
      baseUrl: this._baseUrl(),
      messageCount,
      promptChars,
      toolCount,
      thinking: req.thinking ?? undefined,
    });

    let res: Response;
    try {
      res = await fetch(`${this._baseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this._config.apiKey ? { authorization: `Bearer ${this._config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (req.signal?.aborted) return;
      log.error("stream request failed:", msg);
      yield { type: "text", text: `[provider error: ${msg}]` };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const msg = `vLLM returned ${res.status}: ${text.slice(0, 200)}`;
      log.error(msg);
      yield { type: "text", text: `[provider error: ${msg}]` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const toolAccumulators = new Map<number, ToolAccumulator>();
    let buffer = "";
    let done = false;
    // Wall-clock start of the request, used to derive a live (average)
    // tokens-per-second readout while the response streams.
    let streamStartAt: number | null = null;
    let streamedTokens = 0;
    let lastLiveAt = 0;

    try {
      streamStartAt = Date.now();
      lastLiveAt = streamStartAt;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on newlines; keep the trailing partial line in buffer.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            done = true;
            break;
          }
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          for (const d of this._emitChunk(chunk, toolAccumulators)) {
            if (d.type === "text" || d.type === "reasoning" || d.type === "tool_call") {
              streamedTokens++;
              // Always stream the content (text or reasoning) first.
              yield d;
              // Throttled live progress: surface an approximate average rate
              // (completion tokens so far / elapsed since the request started)
              // while the response is still streaming.
              if (streamStartAt !== null && Date.now() - lastLiveAt >= 250) {
                lastLiveAt = Date.now();
                yield {
                  type: "usage",
                  usage: {
                    promptTokens: 0,
                    completionTokens: streamedTokens,
                    totalTokens: streamedTokens,
                  },
                  elapsedMs: Date.now() - streamStartAt,
                  live: true,
                };
              }
            } else if (d.type === "usage") {
              // The provider's final usage chunk carries the authoritative
              // counts; report the overall request elapsed time alongside it.
              yield {
                type: "usage",
                usage: d.usage,
                elapsedMs: streamStartAt === null ? 0 : Date.now() - streamStartAt,
              };
            } else {
              yield d;
            }
          }
        }
      }
    } catch (err) {
      if (!req.signal?.aborted) {
        log.error("stream read error:", (err as Error).message);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private _baseUrl(): string {
    return this._config.baseUrl.replace(/\/$/, "");
  }

  /** Parse one SSE chunk into deltas, mutating/reading the tool accumulator. */
  private *_emitChunk(
    chunk: unknown,
    toolAccumulators: Map<number, ToolAccumulator>,
  ): Generator<ProviderDelta> {
    const c = chunk as {
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<Record<string, unknown>>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    // The final chunk with `stream_options.include_usage` carries `usage` and
    // NO choices — surface it and stop. (Without this, the `if (!choice)`
    // below silently discards the only place the token counts arrive.)
    if (c.usage && typeof c.usage === "object") {
      yield {
        type: "usage",
        usage: {
          promptTokens: c.usage.prompt_tokens ?? 0,
          completionTokens: c.usage.completion_tokens ?? 0,
          totalTokens: c.usage.total_tokens ?? 0,
        },
      };
      return;
    }

    const choice = c.choices?.[0];
    if (!choice) return;
    const delta = choice.delta;
    if (!delta) return;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text", text: delta.content };
    }

    if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
      yield { type: "reasoning", text: delta.reasoning };
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === "number" ? tc.index : 0;
        const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
        let acc = toolAccumulators.get(index);
        if (!acc) {
          acc = { id: "", name: "", arguments: "" };
          toolAccumulators.set(index, acc);
        }
        if (typeof tc.id === "string") acc.id = tc.id;
        if (typeof fn.name === "string" && fn.name) acc.name = fn.name;
        if (typeof fn.arguments === "string" && fn.arguments) {
          acc.arguments += fn.arguments;
        }
        // Only emit once we have a name to reference (arguments may stream as
        // fragments; we emit the accumulated value so the runtime can update).
        if (acc.name) {
          yield { type: "tool_call", id: acc.id, name: acc.name, arguments: acc.arguments };
        }
      }
    }
  }
}
