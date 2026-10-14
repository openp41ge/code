/**
 * chat-pane.ts — the chat grid tab (`ext:openp41ge-extension-agents:chat`,
 * saved `{ chatId, cwd? }`): one chat in `<agents-chat>`.
 *
 * `ChatPane` is the logic between the surface host and the element:
 *   - while the tab exists (start → stop) the chat is claimed for this
 *     window (`open` / `close`; a tab switch hides the tab without stopping
 *     it, so the chat stays claimed);
 *   - it loads the transcript — whole, or the last page of a long one (the
 *     element pulls older pages through `loadMessages`);
 *   - it feeds the element the backend's pushes for this chat;
 *   - it gives the composer the configured providers and the enabled tools,
 *     and sends with the composer's choices.
 * `<agents-chat-pane>` (chat-pane-element.ts) creates the element and runs
 * a `ChatPane` while connected.
 */

import type {
  Chat,
  ChatDeltaPayload,
  ChatErrorPayload,
  ChatHeader,
  ChatLiveRatePayload,
  ChatReasoningPayload,
  ChatRuntimeStatus,
  ChatSearchOptions,
  ChatStatusPayload,
  ChatToolPayload,
  ChatTranscriptPage,
  ChatTranscriptSearch,
  ChatUsagePayload,
  TokenUsage,
  ToolCall,
} from "../chat/types.js";
import type { AgentsChat } from "../chat/ui/agents-chat.js";

/** The surface host, as far as the chat pane uses it. */
export interface ChatPaneHost {
  readonly context: Readonly<Record<string, unknown>>;
  dispatch(command: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
  subscribe(topic: string, fn: (payload: unknown) => void): () => void;
  readonly config: {
    get(): Readonly<Record<string, unknown>>;
    subscribe(fn: (config: Readonly<Record<string, unknown>>) => void): () => void;
  };
  readonly log: { error(...args: unknown[]): void };
  /** Open an error's log entry (`SurfaceHost.openLog`). */
  openLog(errorId: string): void;
}

/** The `<agents-chat>` methods the pane drives. */
export interface ChatElement {
  readonly title: string;
  chatSearch?: AgentsChat["chatSearch"];
  loadMessages?: AgentsChat["loadMessages"];
  setChat(chat: Chat): void;
  openTranscriptPaged(
    chat: { id: string; title: string; providerId: string },
    page: ChatTranscriptPage,
  ): void;
  appendDelta(text: string): void;
  appendReasoning(text: string): void;
  setToolCallState(tc: ToolCall, result?: string): void;
  setProviderStatus(status: ChatRuntimeStatus): void;
  setUsage(usage: TokenUsage): void;
  setStreamRate(tps: number | null): void;
  appendError(errorId: string | undefined): void;
  setTitle(title: string): void;
  setComposerContext(ctx: Parameters<AgentsChat["setComposerContext"]>[0]): void;
}

/** Messages per page when a long chat opens. */
const PAGE_SIZE = 200;

/** A provider as the config stores it (`providers.<id>`). */
interface ProviderConfig {
  name?: string;
  defaultModel?: string;
  baseUrl?: string;
  models?: Array<{
    id: string;
    thinking?: Record<string, string>;
    contextWindow?: number;
    maxTokens?: number;
  }>;
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export class ChatPane {
  readonly chatId: string;
  private readonly _cwd: string | undefined;
  private _offs: Array<() => void> = [];
  /** The composer's enabled tools (null until the tool list is known). */
  private _activeTools: string[] | null = null;
  private _providerId = "";

  constructor(
    private readonly _host: ChatPaneHost,
    private readonly _el: ChatElement,
  ) {
    this.chatId = str(_host.context.chatId) ?? "";
    this._cwd = str(_host.context.cwd);
  }

  start(): void {
    if (!this.chatId) return;
    const id = this.chatId;
    this._el.chatSearch = (chatId, query, opts) =>
      this._host.dispatch("search-transcript", {
        id: chatId,
        query,
        options: opts as ChatSearchOptions,
      }) as Promise<ChatTranscriptSearch>;
    this._el.loadMessages = (chatId, offset, count) =>
      this._host.dispatch("messages", { id: chatId, offset, count }) as Promise<ChatTranscriptPage>;

    const forChat =
      <P extends { chatId: string }>(fn: (payload: P) => void) =>
      (payload: unknown) => {
        if ((payload as P)?.chatId === id) fn(payload as P);
      };
    this._offs.push(
      this._host.subscribe(
        "delta",
        forChat<ChatDeltaPayload>((p) => this._el.appendDelta(p.delta)),
      ),
      this._host.subscribe(
        "reasoning",
        forChat<ChatReasoningPayload>((p) => this._el.appendReasoning(p.delta)),
      ),
      this._host.subscribe(
        "tool",
        forChat<ChatToolPayload>((p) => this._el.setToolCallState(p.toolCall, p.result)),
      ),
      this._host.subscribe(
        "status",
        forChat<ChatStatusPayload>((p) => this._el.setProviderStatus(p.status)),
      ),
      this._host.subscribe(
        "usage",
        forChat<ChatUsagePayload>((p) => this._el.setUsage(p.usage)),
      ),
      this._host.subscribe(
        "live-rate",
        forChat<ChatLiveRatePayload>((p) => this._el.setStreamRate(p.tps)),
      ),
      this._host.subscribe(
        "error",
        forChat<ChatErrorPayload>((p) => this._el.appendError(p.errorId)),
      ),
      this._host.subscribe("changed", () => void this._refreshTitle()),
      this._host.config.subscribe(() => void this._loadComposer()),
    );

    void this._call("open", { id });
    void this._load();
  }

  stop(): void {
    for (const off of this._offs) off();
    this._offs = [];
    if (this.chatId) void this._call("close", { id: this.chatId });
  }

  send(text: string, thinkingLevel?: string): void {
    if (!text) return;
    void this._call("send", {
      id: this.chatId,
      text,
      ...(this._cwd ? { cwd: this._cwd } : {}),
      ...(this._activeTools ? { tools: this._activeTools } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
  }

  abort(): void {
    void this._call("abort", { id: this.chatId });
  }

  /** Open an error's log entry in a Logs tab (an error block's link). */
  openLog(errorId: string): void {
    this._host.openLog(errorId);
  }

  toolsChanged(tools: string[]): void {
    this._activeTools = tools;
  }

  private async _call(command: string, payload: Record<string, unknown>): Promise<unknown> {
    try {
      return await this._host.dispatch(command, payload);
    } catch (err) {
      this._host.log.error(`chat '${command}' failed:`, err);
      return undefined;
    }
  }

  private async _load(): Promise<void> {
    const header = (await this._call("header", { id: this.chatId })) as ChatHeader | null;
    if (!header) {
      this._el.setChat({
        id: this.chatId,
        title: "Chat not found",
        providerId: "",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
      });
      return;
    }
    this._providerId = header.providerId;
    if (header.totalMessages <= PAGE_SIZE) {
      const chat = (await this._call("get", { id: this.chatId })) as Chat | null;
      this._el.setChat(
        chat ?? {
          id: header.id,
          title: header.title,
          providerId: header.providerId,
          createdAt: 0,
          updatedAt: 0,
          messages: [],
        },
      );
    } else {
      const offset = Math.max(0, header.totalMessages - PAGE_SIZE);
      const page = (await this._call("messages", {
        id: this.chatId,
        offset,
        count: PAGE_SIZE,
      })) as ChatTranscriptPage;
      this._el.openTranscriptPaged(
        { id: header.id, title: header.title, providerId: header.providerId },
        page,
      );
    }
    await this._loadComposer();
  }

  private async _refreshTitle(): Promise<void> {
    const chat = (await this._call("get", { id: this.chatId })) as Chat | null;
    if (chat && chat.title !== this._el.title) this._el.setTitle(chat.title);
  }

  /** The composer's providers/models (the config) and tools (the enabled ones). */
  private async _loadComposer(): Promise<void> {
    const config = this._host.config.get() as {
      providers?: Record<string, ProviderConfig>;
    };
    const providers = Object.entries(config.providers ?? {}).map(([id, p]) => ({
      id,
      label: p.name ?? id,
      defaultModel: p.defaultModel ?? "",
      baseUrl: p.baseUrl ?? "",
      models: (p.models ?? []).map((m) => ({
        id: m.id,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
      })),
    }));
    const activeProviderId = this._providerId;
    if (activeProviderId && !providers.some((p) => p.id === activeProviderId)) {
      providers.push({
        id: activeProviderId,
        label: activeProviderId,
        defaultModel: "",
        baseUrl: "",
        models: [],
      });
    }
    const availableTools =
      ((await this._call("list-tools", {})) as Array<{ name: string; description: string }>) ?? [];
    // Keep the user's choice (minus tools no longer enabled); else all.
    this._activeTools = this._activeTools
      ? this._activeTools.filter((n) => availableTools.some((t) => t.name === n))
      : availableTools.map((t) => t.name);
    this._el.setComposerContext({
      providers,
      activeProviderId,
      activeModelId: providers.find((p) => p.id === activeProviderId)?.defaultModel ?? "",
      availableTools,
      activeTools: this._activeTools,
    });
  }
}
