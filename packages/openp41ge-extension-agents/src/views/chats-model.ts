/**
 * chats-model.ts — the Agents sidebar's chat list: the workspace's chats,
 * most recently used first, and where each is open (`here` / `elsewhere`),
 * kept current from the backend's `changed` and `open-state` pushes.
 *
 * A chat opens in the grid as a preview (or pinned), keyed by its id so the
 * tab already open for it is reused; one open in another window is not
 * opened again ("open in one window").
 *
 * Archived chats are listed only while `showArchived` is on. A chat's folder
 * (its conversation history) can be copied to the clipboard to share.
 */

import type { OpenTabRequest } from "openp41ge-sdk";
import type { ChatSummary } from "../chat/types.js";

/** The chat grid tab's app type. */
export const CHAT_APP_TYPE = "ext:openp41ge-extension-agents:chat";

/** The surface host, as far as the chat list uses it. */
export interface ChatsHost {
  dispatch(command: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
  subscribe(topic: string, fn: (payload: unknown) => void): () => void;
  openTab(request: OpenTabRequest): void;
}

export interface ChatsState {
  /** The chats, most recently used first (null: not loaded yet). */
  readonly chats: readonly ChatSummary[] | null;
  /** Where each open chat is open, seen from this window. */
  readonly open: Readonly<Record<string, "here" | "elsewhere">>;
  /** Whether archived chats are listed too. */
  readonly showArchived: boolean;
  readonly error?: string;
}

export class ChatsModel {
  state: ChatsState = { chats: null, open: {}, showArchived: false };
  private _offs: Array<() => void> = [];
  private _running = false;

  constructor(
    private readonly _host: ChatsHost,
    private readonly _changed: () => void,
  ) {}

  start(): void {
    this._running = true;
    this._offs.push(
      this._host.subscribe("changed", () => void this.refresh()),
      this._host.subscribe("open-state", () => void this._refreshOpen()),
    );
    void this.refresh();
  }

  stop(): void {
    this._running = false;
    for (const off of this._offs) off();
    this._offs = [];
  }

  async refresh(): Promise<void> {
    try {
      const [chats, open] = await Promise.all([
        this._host.dispatch(
          "list",
          this.state.showArchived ? { archived: true } : undefined,
        ) as Promise<ChatSummary[]>,
        this._host.dispatch("open-chats") as Promise<ChatsState["open"]>,
      ]);
      if (!this._running) return;
      this._set({
        ...this.state,
        chats: [...(chats ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
        open: open ?? {},
        error: undefined,
      });
    } catch (err) {
      this._set({ ...this.state, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Open a chat in the grid; false when it is open in another window. */
  openChat(chatId: string, pinned = false): boolean {
    if (this.state.open[chatId] === "elsewhere") return false;
    this._host.openTab({ appType: CHAT_APP_TYPE, params: { chatId }, key: chatId, pinned });
    return true;
  }

  /** Create a chat in this workspace and open it pinned. */
  async newChat(): Promise<void> {
    await this._run(async () => {
      const chat = (await this._host.dispatch("create", {})) as { id: string };
      this.openChat(chat.id, true);
    });
  }

  /** List archived chats too, or stop. */
  async toggleArchived(): Promise<void> {
    this._set({ ...this.state, showArchived: !this.state.showArchived });
    await this.refresh();
  }

  /** Archive a chat (the backend's `changed` push refreshes the list). */
  async archive(chatId: string): Promise<void> {
    await this._run(() => this._host.dispatch("archive", { id: chatId }));
  }

  async unarchive(chatId: string): Promise<void> {
    await this._run(() => this._host.dispatch("unarchive", { id: chatId }));
  }

  /** Copy a chat's folder (its conversation history) to the clipboard. */
  async copyPath(chatId: string): Promise<void> {
    await this._run(async () => {
      const path = (await this._host.dispatch("path", { id: chatId })) as string | null;
      if (path) await navigator.clipboard.writeText(path);
    });
  }

  private async _run(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this._set({ ...this.state, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async _refreshOpen(): Promise<void> {
    try {
      const open = (await this._host.dispatch("open-chats")) as ChatsState["open"];
      this._set({ ...this.state, open: open ?? {} });
    } catch {
      // the list refresh reports failures
    }
  }

  private _set(state: ChatsState): void {
    this.state = state;
    this._changed();
  }
}
