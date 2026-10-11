/**
 * chat-search-model.ts — the Search chats sidebar: the query (with regex /
 * match case) searches the workspace's chats — their messages and tool
 * calls, in the backend — and the results are the matching chats with how
 * many of their messages and tool calls match. A newer query wins over an
 * answer still on its way. A result opens its chat as a preview.
 */

import type { ChatSearchResult, ChatSummary } from "../chat/types.js";
import { CHAT_APP_TYPE, type ChatsHost } from "./chats-model.js";

export type ChatSearchHost = ChatsHost;

export interface ChatSearchHit {
  readonly chat: ChatSummary;
  readonly messages: number;
  readonly toolCalls: number;
}

export interface ChatSearchState {
  readonly query: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  /** The chats searched (the workspace's). */
  readonly chats: readonly ChatSummary[];
  /** The matching chats; null without a query. */
  readonly results: readonly ChatSearchHit[] | null;
  readonly searching: boolean;
  readonly error?: string;
}

/** The results bar's line. */
export function searchSummary(s: ChatSearchState): string {
  if (s.error) return s.error;
  if (s.searching) return "Searching…";
  if (s.results === null) {
    return `Searches ${s.chats.length} chat${s.chats.length === 1 ? "" : "s"}`;
  }
  if (s.results.length === 0) return "No chats match";
  return s.results.length === 1 ? "1 chat matches" : `${s.results.length} chats match`;
}

export class ChatSearchModel {
  state: ChatSearchState = {
    query: "",
    regex: false,
    caseSensitive: false,
    chats: [],
    results: null,
    searching: false,
  };
  /** The latest search; an older one's answer is dropped. */
  private _seq = 0;
  private _offs: Array<() => void> = [];

  constructor(
    private readonly _host: ChatSearchHost,
    private readonly _changed: () => void,
  ) {}

  /** Load the chats (and search again when they change). */
  async start(): Promise<void> {
    this._offs.push(this._host.subscribe("changed", () => void this._reload()));
    await this._reload();
  }

  stop(): void {
    for (const off of this._offs) off();
    this._offs = [];
  }

  setQuery(query: string): Promise<void> {
    this._set({ query });
    return this._search();
  }

  toggle(option: "regex" | "caseSensitive"): Promise<void> {
    this._set({ [option]: !this.state[option] });
    return this._search();
  }

  openChat(chatId: string): void {
    this._host.openTab({ appType: CHAT_APP_TYPE, params: { chatId }, key: chatId, pinned: false });
  }

  private async _reload(): Promise<void> {
    try {
      const chats = ((await this._host.dispatch("list")) as ChatSummary[]) ?? [];
      this._set({ chats });
    } catch (err) {
      this._set({ error: err instanceof Error ? err.message : String(err) });
    }
    if (this.state.query) await this._search();
  }

  private async _search(): Promise<void> {
    const seq = ++this._seq;
    const { query, regex, caseSensitive } = this.state;
    if (!query) {
      this._set({ results: null, searching: false, error: undefined });
      return;
    }
    this._set({ searching: true, error: undefined });
    try {
      const found = ((await this._host.dispatch("search", {
        query,
        options: { regex, caseSensitive },
      })) ?? []) as ChatSearchResult[];
      if (seq !== this._seq) return;
      const byId = new Map(this.state.chats.map((c) => [c.id, c]));
      const results: ChatSearchHit[] = [];
      for (const r of found) {
        const chat = byId.get(r.chatId);
        if (chat) {
          results.push({
            chat,
            messages: r.matchedMessageIds.length,
            toolCalls: r.matchedToolCallIds.length,
          });
        }
      }
      results.sort((a, b) => b.chat.updatedAt - a.chat.updatedAt);
      this._set({ results, searching: false });
    } catch (err) {
      if (seq !== this._seq) return;
      this._set({
        results: [],
        searching: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _set(change: Partial<ChatSearchState>): void {
    this.state = { ...this.state, ...change };
    this._changed();
  }
}
