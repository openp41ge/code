/**
 * AgentRuntime — the provider-agnostic agent loop.
 *
 * `send(chatId, winId, userText, cwd?)`:
 *   1. persist the user message,
 *   2. build the provider request (system prompt + history + tool defs),
 *   3. stream deltas from the provider, folding text into the assistant reply
 *      and accumulating tool calls,
 *   4. execute accumulated tool calls (looping back to the provider until the
 *      model stops calling tools or the request is aborted),
 *   5. persist + broadcast mutations and forward incremental deltas to the
 *      owning window.
 *
 * The runtime depends only on abstractions (ChatProviderRegistry, ToolRegistry,
 * ChatThreads) and a small hooks object for the fan-out to the views
 * (Dependency Inversion).
 */

import type { GitRequest, GitResult } from "openp41ge-sdk";
import { logFor } from "./log.js";
import type {
  ChatMessage,
  ChatRuntimeStatus,
  MessageSegment,
  ToolCallStatus,
} from "../chat/types.js";
import type { AgentRuntimeHooks } from "./agent-runtime-hooks.js";
import type { ChatProvider, ChatProviderConfig, ProviderDelta } from "./chat-provider.js";
import type { ChatThreads } from "./chat-threads.js";
import type { ChatProviderRegistry } from "./chat-provider-registry.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ToolExecutionContext } from "./tool.js";

const log = logFor("AgentRuntime");

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful coding agent inside Openp41ge. You can use tools to read and search " +
  "files. When you use a tool, explain briefly what you found. Be concise.";

/** A repository of the chat's workspace; its worktrees are what the agent's
 *  file tools are scoped to. */
export interface ConnectedRepository {
  /** Repo identifier as shown in the explorer (e.g. "github.com/org/repo"). */
  repo: string;
  /** Whether it is cloned (a worktree can be checked out of it). */
  cloned: boolean;
  /** Its checked-out worktrees: the branch, and the worktree directory. */
  worktrees: Array<{ branch: string; path: string }>;
}

/** A worktree checked out (`path`), or why not (`error`). */
export interface WorktreeResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/** The tool that checks out a worktree (named in the system prompt). */
const CREATE_WORKTREE_TOOL = "create_worktree";

/** The git tools (named in the system prompt when enabled). */
const GIT_TOOL_PREFIX = "git_";

export interface AgentRuntimeConfig {
  /** Resolve the persisted config for a provider id, or null when unconfigured. */
  getProviderConfig(providerId: string): ChatProviderConfig | null;
  /**
   * Resolve the repositories of the chat's workspace, whose worktrees the
   * agent's file tools are allowed to touch (read again for each request to
   * the provider). Return an empty array when nothing is connected (tools
   * must deny all file access). Omit to keep the previous unrestricted
   * behaviour.
   */
  getConnectedRepositories?(chatId: string): Promise<ConnectedRepository[]>;
  /** Check out `branch` of `repo` as a worktree of the chat's workspace. */
  addWorktree?(chatId: string, repo: string, branch: string): Promise<WorktreeResult>;
  /** Run git in a repository of the chat's workspace (the git tools). */
  git?(chatId: string, request: GitRequest): Promise<GitResult>;
}

/**
 * The system prompt, with the connected repositories appended so the model
 * knows exactly which paths its file tools may read and search, and which
 * repositories it could check a worktree out of (`canCheckOut`: the
 * create_worktree tool is available).
 */
function buildSystemPrompt(
  connected: ConnectedRepository[] | undefined,
  canCheckOut: boolean,
  gitTools: readonly string[] = [],
): string {
  if (connected === undefined) return DEFAULT_SYSTEM_PROMPT;
  if (connected.length === 0) {
    return `${DEFAULT_SYSTEM_PROMPT}\n\nNo connected worktrees. The file tools (read_file, search_files) are scoped and cannot access anything.`;
  }

  // Worktrees are listed under their repo so the model understands a repo may
  // have several branch checkouts — the same repository at different
  // branches, not distinct targets — and does not re-read shared files across
  // sibling worktrees. A repo with no worktree is listed too, so the model
  // knows it is there.
  const blocks = connected.map((r) => {
    const lines = !r.cloned
      ? ["    - not cloned yet"]
      : r.worktrees.length === 0
        ? ["    - no worktree checked out"]
        : r.worktrees.map((w) => `    - branch ${w.branch}: ${w.path}`);
    return `- ${r.repo}\n${lines.join("\n")}`;
  });

  const checkOut = canCheckOut
    ? ` To work in a repository with no worktree, or on another branch, check one out with ${CREATE_WORKTREE_TOOL}; it is then in scope.`
    : "";
  const git =
    gitTools.length > 0
      ? ` To read a repository's history, commits, changes and blame, use the git tools (${gitTools.join(", ")}) with the repository's name; they only read. A worktree is named by its branch.`
      : "";
  return `${DEFAULT_SYSTEM_PROMPT}\n\nConnected repositories you may read and search (file tools are scoped to their worktrees):\n\n${blocks.join("\n")}\n\nEach repository has one or more worktree checkouts (one per branch) — they are the same repository at different branches. To read or search a repository, use any one of its worktree paths; do not repeat the same file across sibling worktrees.${checkOut}${git}`;
}

/** A tool call accumulated from streamed deltas, awaiting execution. */
interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class AgentRuntime {
  private readonly _active = new Map<string, AbortController>();
  private readonly _streaming = new Set<string>();

  constructor(
    private readonly _store: ChatThreads,
    private readonly _providers: ChatProviderRegistry,
    private readonly _tools: ToolRegistry,
    private readonly _hooks: AgentRuntimeHooks,
    private readonly _config: AgentRuntimeConfig,
  ) {}

  isStreaming(chatId: string): boolean {
    return this._streaming.has(chatId);
  }

  /** Name + description of all tools registered in the runtime (for the
   *  composer selector, which shows a name row and a description row). */
  listTools(): Array<{ name: string; description: string }> {
    return this._tools.list().map((t) => ({ name: t.name, description: t.description }));
  }

  async send(
    chatId: string,
    winId: string,
    userText: string,
    cwd?: string,
    enabledTools?: string[],
    thinkingLevel?: string,
  ): Promise<void> {
    const text = userText.trim();
    if (!text) return;
    if (this._streaming.has(chatId)) return;

    const chat = this._store.get(chatId);
    if (!chat) return;

    this._streaming.add(chatId);
    const controller = new AbortController();
    this._active.set(chatId, controller);

    this._setStatus(winId, chatId, { streaming: true, providerOk: null });

    try {
      // 1. Persist the user message.
      this._store.appendMessage(chatId, {
        id: this._id("msg"),
        role: "user",
        content: text,
      });
      this._hooks.broadcast("chat:changed", {});

      // 2. Resolve the provider factory + config.
      const providerId = chat.providerId || this._providers.defaultId || "";
      const factory = this._providers.get(providerId);
      const providerConfig = this._config.getProviderConfig(providerId);

      if (!factory) {
        this._store.appendMessage(chatId, {
          id: this._id("msg"),
          role: "assistant",
          content: "[not configured] No agent provider configured.",
        });
        this._setStatus(winId, chatId, { streaming: false, providerOk: false });
        this._hooks.broadcast("chat:changed", {});
        return;
      }
      if (!providerConfig) {
        this._store.appendMessage(chatId, {
          id: this._id("msg"),
          role: "assistant",
          content: "[not configured] Agent provider not configured. Open ⚙ Agent to set it up.",
        });
        this._setStatus(winId, chatId, { streaming: false, providerOk: false });
        this._hooks.broadcast("chat:changed", {});
        return;
      }
      if (!providerConfig.defaultModel) {
        this._store.appendMessage(chatId, {
          id: this._id("msg"),
          role: "assistant",
          content:
            "[not configured] Agent provider has no model configured. Open ⚙ Agent to set one.",
        });
        this._setStatus(winId, chatId, { streaming: false, providerOk: false });
        this._hooks.broadcast("chat:changed", {});
        return;
      }

      const provider = factory.create(providerConfig);
      const ping = await provider.ping();
      this._setStatus(winId, chatId, { streaming: true, providerOk: ping });

      // 3. Agent loop.
      await this._runLoop(
        chatId,
        winId,
        provider,
        controller.signal,
        cwd,
        enabledTools,
        thinkingLevel,
      );

      this._setStatus(winId, chatId, { streaming: false, providerOk: ping });
    } catch (err) {
      const errorId = log.error("agent send error:", err);
      if (!controller.signal.aborted) {
        this._appendError(chatId, winId, errorId);
        this._setStatus(winId, chatId, { streaming: false, providerOk: false });
      }
    } finally {
      this._streaming.delete(chatId);
      this._active.delete(chatId);
      this._hooks.broadcast("chat:changed", {});
    }
  }

  async abort(chatId: string): Promise<void> {
    const controller = this._active.get(chatId);
    if (!controller) return;
    controller.abort();
    this._store.setLastToolCallStatus(chatId, "error", "interrupted");
    const winId = this._store.getOpenWin(chatId);
    if (winId) {
      this._setStatus(winId, chatId, { streaming: false, providerOk: null });
    }
    this._hooks.broadcast("chat:changed", {});
  }

  private async _runLoop(
    chatId: string,
    winId: string,
    provider: ChatProvider,
    signal: AbortSignal,
    cwd?: string,
    enabledTools?: string[],
    thinkingLevel?: string,
  ): Promise<void> {
    const addWorktree = this._config.addWorktree;
    const git = this._config.git;
    while (!signal.aborted) {
      const chat = this._store.get(chatId);
      if (!chat) return;

      const toolDefs = this._tools.definitions();
      // `enabledTools` is optional: when omitted/undefined, every registered
      // tool is available (the pre-settings default). When provided — even as
      // an empty list — it is authoritative, so a workspace that disables all
      // of its tools yields `[]` and no tool runs.
      const tools =
        enabledTools !== undefined
          ? toolDefs.filter((t) => enabledTools.includes(t.name))
          : toolDefs;

      // The connected-repository scope, read for each request (a tool may
      // have checked out a worktree). When no resolver is configured,
      // `connected` stays undefined and tools keep the previous unrestricted
      // behaviour.
      const connected = this._config.getConnectedRepositories
        ? await this._config.getConnectedRepositories(chatId)
        : undefined;
      if (signal.aborted) return;
      // Roots = the connected worktree paths; undefined when no scope is
      // configured (legacy behaviour). Empty when nothing is connected (deny).
      const roots = connected?.flatMap((r) => r.worktrees.map((w) => w.path));
      const systemContent = buildSystemPrompt(
        connected,
        !!addWorktree && tools.some((t) => t.name === CREATE_WORKTREE_TOOL),
        git ? tools.map((t) => t.name).filter((n) => n.startsWith(GIT_TOOL_PREFIX)) : [],
      );

      const system: ChatMessage = {
        id: this._id("sys"),
        role: "system",
        content: systemContent,
        timestamp: Date.now(),
      };
      const requestMessages: ChatMessage[] = [system, ...chat.messages];

      let toolCalls: PendingToolCall[] = [];
      let currentAssistant: ChatMessage | null = null;
      for await (const delta of provider.streamChat({
        messages: requestMessages,
        tools,
        signal,
        thinking: thinkingLevel,
      })) {
        if (signal.aborted) break;
        if (delta.type === "reasoning" && delta.text) {
          // Reasoning/thinking text streamed ahead of the final answer. Persist
          // it on the assistant message and forward it so the chat pane can
          // render the thinking block.
          if (!currentAssistant) currentAssistant = this._beginAssistant(chatId);
          this._store.updateMessage(chatId, currentAssistant.id, (m) => {
            m.reasoning = (m.reasoning ?? "") + delta.text;
          });
          this._hooks.sendToWindow(winId, "chat:reasoning", { chatId, delta: delta.text });
        } else if (delta.type === "text" && delta.text) {
          if (!currentAssistant) currentAssistant = this._beginAssistant(chatId);
          this._store.updateMessage(chatId, currentAssistant.id, (m) => {
            m.content = (m.content ?? "") + delta.text;
            m.segments = appendTextSegment(m.segments, delta.text);
          });
          this._hooks.sendToWindow(winId, "chat:delta", { chatId, delta: delta.text });
        } else if (delta.type === "error") {
          this._appendError(chatId, winId, delta.errorId);
        } else if (delta.type === "tool_call") {
          toolCalls = this._mergeTool(toolCalls, delta);
          if (!currentAssistant) currentAssistant = this._beginAssistant(chatId);
          this._upsertToolCall(chatId, winId, currentAssistant.id, delta);
        } else if (delta.type === "usage") {
          if (delta.live) {
            // A throttled progress delta while the response is streaming: report
            // a live average gen rate, but never persist it as the completion's
            // authoritative usage.
            if (delta.elapsedMs && delta.elapsedMs > 0 && delta.usage.completionTokens > 0) {
              this._hooks.sendToWindow(winId, "chat:live-rate", {
                chatId,
                tps: delta.usage.completionTokens / (delta.elapsedMs / 1000),
              });
            }
            continue;
          }
          // The provider's final chunk carries the token usage for THIS
          // completion. Persist it on the streaming assistant message and
          // forward it to the window so the chat's bottom bar can show it.
          // Derive an approximate generation throughput from the streamed
          // elapsed time (completion tokens / seconds).
          const usage = delta.usage;
          if (delta.elapsedMs && delta.elapsedMs > 0 && usage.completionTokens > 0) {
            usage.tokensPerSecond = usage.completionTokens / (delta.elapsedMs / 1000);
          }
          if (currentAssistant) {
            this._store.updateMessage(chatId, currentAssistant.id, (m) => {
              m.usage = usage;
            });
          }
          this._hooks.sendToWindow(winId, "chat:usage", { chatId, usage });
        }
      }

      if (signal.aborted) return;

      if (toolCalls.length === 0) return;

      // Execute accumulated tool calls and feed results back to the provider.
      for (const tc of toolCalls) {
        if (signal.aborted) break;
        const ctx: ToolExecutionContext = roots !== undefined ? { cwd, roots } : { cwd };
        if (addWorktree) {
          // A worktree checked out is in scope for the rest of this batch too.
          ctx.addWorktree = async (repo, branch) => {
            const added = await addWorktree(chatId, repo, branch);
            if (added.ok && added.path) roots?.push(added.path);
            return added;
          };
        }
        if (git) ctx.git = (request) => git(chatId, request);
        const result = await this._tools.execute(tc.name, parseArgs(tc.arguments), ctx);
        const chatNow = this._store.get(chatId);
        if (!chatNow) break;
        const tool = chatNow.messages.flatMap((m) => m.toolCalls ?? []).find((t) => t.id === tc.id);
        if (!tool) break;
        this._store.updateToolCall(chatId, tc.id, (t) => {
          t.status = result.error ? "error" : "done";
          if (result.error) t.error = result.error;
        });
        this._store.appendMessage(chatId, {
          id: this._id("msg"),
          role: "tool",
          toolCallId: tc.id,
          content: result.error ? result.error : result.content,
        });
        const updated = this._store.get(chatId);
        const updatedTool = updated?.messages
          .flatMap((m) => m.toolCalls ?? [])
          .find((t) => t.id === tc.id);
        if (updatedTool)
          this._hooks.sendToWindow(winId, "chat:tool", {
            chatId,
            toolCall: updatedTool,
            result: result.error ? result.error : result.content,
          });
      }

      if (signal.aborted) return;
      this._hooks.broadcast("chat:changed", {});
    }
  }

  /**
   * End the turn with an error: an `error` segment on this turn's assistant
   * message (a new one when the turn has none yet), pushed live as
   * `chat:error`. The error's text stays in the log (`errorId`), never in the
   * message, so it is not sent to the model.
   */
  private _appendError(chatId: string, winId: string, errorId: string | undefined): void {
    const segment: MessageSegment = { type: "error", ...(errorId ? { errorId } : {}) };
    const last = this._store.get(chatId)?.messages.at(-1);
    if (last?.role === "assistant") {
      this._store.updateMessage(chatId, last.id, (m) => {
        m.segments = [...(m.segments ?? []), segment];
      });
    } else {
      this._store.appendMessage(chatId, {
        id: this._id("msg"),
        role: "assistant",
        segments: [segment],
      });
    }
    this._hooks.sendToWindow(winId, "chat:error", { chatId, ...(errorId ? { errorId } : {}) });
  }

  private _beginAssistant(chatId: string): ChatMessage {
    const assistant: ChatMessage = {
      id: this._id("msg"),
      role: "assistant",
      content: "",
      segments: [],
      timestamp: Date.now(),
    };
    this._store.appendMessage(chatId, {
      id: assistant.id,
      role: "assistant",
      content: "",
      segments: [],
    });
    return assistant;
  }

  private _mergeTool(
    pending: PendingToolCall[],
    delta: ProviderDelta & { type: "tool_call" },
  ): PendingToolCall[] {
    const existing = pending.find((t) => t.id === delta.id);
    if (existing) {
      if (delta.name) existing.name = delta.name;
      if (delta.arguments) existing.arguments = delta.arguments; // accumulated args
      return pending;
    }
    return [...pending, { id: delta.id, name: delta.name, arguments: delta.arguments }];
  }

  private _upsertToolCall(
    chatId: string,
    winId: string,
    assistantId: string,
    delta: { id: string; name: string; arguments: string },
  ): void {
    this._store.updateMessage(chatId, assistantId, (m) => {
      const existing = m.toolCalls?.find((t) => t.id === delta.id);
      if (existing) {
        existing.arguments = delta.arguments || existing.arguments;
        if (delta.name) existing.name = delta.name;
      } else {
        m.toolCalls = [
          ...(m.toolCalls ?? []),
          { id: delta.id, name: delta.name, arguments: delta.arguments, status: "running" },
        ];
      }
      m.segments = upsertToolSegment(m.segments, delta);
    });
    const chat = this._store.get(chatId);
    const tool = chat?.messages.flatMap((m) => m.toolCalls ?? []).find((t) => t.id === delta.id);
    if (tool) this._hooks.sendToWindow(winId, "chat:tool", { chatId, toolCall: tool });
  }

  private _setStatus(winId: string, chatId: string, status: ChatRuntimeStatus): void {
    this._hooks.sendToWindow(winId, "chat:status", { chatId, status });
  }

  private _id(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Parse a raw arguments string (JSON or plain text) into a record. */
function parseArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — fall through
  }
  return { command: trimmed };
}

/** Append a text chunk to the ordered segment list, merging into a trailing text segment. */
function appendTextSegment(segments: MessageSegment[] | undefined, text: string): MessageSegment[] {
  const segs = segments ?? [];
  const last = segs[segs.length - 1];
  if (last && last.type === "text") {
    return [...segs.slice(0, -1), { type: "text", text: (last.text ?? "") + text }];
  }
  return [...segs, { type: "text", text }];
}

/** Insert or update a tool-call segment at its recorded position in the ordered list. */
function upsertToolSegment(
  segments: MessageSegment[] | undefined,
  tool: { id: string; name?: string; arguments?: string; status?: ToolCallStatus },
): MessageSegment[] {
  const segs = segments ?? [];
  const idx = segs.findIndex((s) => s.type === "tool" && s.toolCall?.id === tool.id);
  if (idx >= 0) {
    return segs.map((s, i) => {
      if (i !== idx) return s;
      const existing = s.toolCall!;
      return {
        ...s,
        toolCall: {
          ...existing,
          name: tool.name ?? existing.name,
          arguments: tool.arguments ?? existing.arguments,
          status: tool.status ?? existing.status,
        },
      };
    });
  }
  return [
    ...segs,
    {
      type: "tool",
      toolCall: {
        id: tool.id,
        name: tool.name ?? "",
        arguments: tool.arguments ?? "",
        status: tool.status ?? "running",
      },
    },
  ];
}
