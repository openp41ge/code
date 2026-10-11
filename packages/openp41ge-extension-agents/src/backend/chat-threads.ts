/**
 * chat-threads.ts — chat threads across workspaces.
 *
 * Threads belong to a workspace and live in the extension's data folder
 * there (`<data>/chat-threads/`), so workspaces never mix. Each
 * workspace has its own ChatThreadStore, loaded the first time one of its
 * windows asks (`useWorkspace`); calls by thread id are routed to the store
 * that holds the thread. A window without a workspace (the manager) has no
 * threads.
 *
 * Which window has a thread open is tracked here, across workspaces, and is
 * memory-only ("opened once": no thread is open in two windows).
 */

import type {
  Chat,
  ChatHeader,
  ChatMessage,
  ChatSearchOptions,
  ChatSearchResult,
  ChatSummary,
  ChatTranscriptPage,
  ChatTranscriptSearch,
  ToolCall,
  ToolCallStatus,
} from "../chat/types.js";
import {
  ChatThreadStore,
  searchTranscript,
  type ChatThreadStoreOptions,
} from "./chat-thread-store.js";

/** A workspace's chat threads: its id, and the folder that holds its
 *  `chat-threads/` (the extension's data folder in that workspace). */
export interface WorkspaceDataDir {
  readonly id: string;
  readonly dataDir: string;
}

export class ChatThreads {
  private readonly _stores = new Map<string, ChatThreadStore>(); // workspaceId -> store
  private readonly _workspaces = new Map<ChatThreadStore, WorkspaceDataDir>(); // store -> workspace
  private readonly _owner = new Map<string, ChatThreadStore>(); // threadId -> store
  private readonly _openChats = new Map<string, string>(); // threadId -> winId
  private readonly _openStateListeners = new Set<() => void>();

  constructor(private readonly _options: ChatThreadStoreOptions = {}) {}

  /** Load a workspace's threads (once). */
  useWorkspace(workspace: WorkspaceDataDir): void {
    if (this._stores.has(workspace.id)) return;
    const store = new ChatThreadStore(workspace.dataDir, this._options);
    store.init();
    this._stores.set(workspace.id, store);
    this._workspaces.set(store, workspace);
    for (const id of store.threadIds()) this._owner.set(id, store);
  }

  // ── Per workspace ────────────────────────────────────────────────────

  /** The workspace's unarchived threads (none without a workspace). */
  listSummaries(workspaceId: string | undefined): ChatSummary[] {
    return this._store(workspaceId)?.listSummaries() ?? [];
  }

  search(
    query: string,
    opts: ChatSearchOptions | undefined,
    workspaceId: string | undefined,
  ): ChatSearchResult[] {
    return this._store(workspaceId)?.search(query, opts) ?? [];
  }

  /** Create a thread in a (loaded) workspace. */
  create(
    workspaceId: string | undefined,
    opts: { providerId?: string; title?: string } = {},
  ): Chat {
    const store = this._store(workspaceId);
    if (!store) throw new Error("Chat threads belong to a workspace; open one first.");
    const chat = store.create(opts);
    this._owner.set(chat.id, store);
    return chat;
  }

  // ── By thread id ─────────────────────────────────────────────────────

  /** The workspace that owns thread `id` (null: unknown thread). */
  workspaceOf(id: string): WorkspaceDataDir | null {
    const store = this._owner.get(id);
    return store ? (this._workspaces.get(store) ?? null) : null;
  }

  get(id: string): Chat | null {
    return this._owner.get(id)?.get(id) ?? null;
  }

  getHeader(id: string): ChatHeader | null {
    return this._owner.get(id)?.getHeader(id) ?? null;
  }

  getMessages(id: string, offset?: number, count?: number): ChatTranscriptPage {
    const store = this._owner.get(id);
    return store
      ? store.getMessages(id, offset, count)
      : { chatId: id, start: 0, total: 0, messages: [] };
  }

  rename(id: string, title: string): Chat | null {
    return this._owner.get(id)?.rename(id, title) ?? null;
  }

  archive(id: string): boolean {
    return this._owner.get(id)?.archive(id) ?? false;
  }

  delete(id: string): boolean {
    const existed = this._owner.get(id)?.delete(id) ?? false;
    this._owner.delete(id);
    this.markClosed(id);
    return existed;
  }

  appendMessage(id: string, msg: Omit<ChatMessage, "timestamp">): boolean {
    return this._owner.get(id)?.appendMessage(id, msg) ?? false;
  }

  updateMessage(id: string, messageId: string, fn: (msg: ChatMessage) => void): boolean {
    return this._owner.get(id)?.updateMessage(id, messageId, fn) ?? false;
  }

  updateToolCall(id: string, toolCallId: string, fn: (tc: ToolCall) => void): boolean {
    return this._owner.get(id)?.updateToolCall(id, toolCallId, fn) ?? false;
  }

  setLastToolCallStatus(id: string, status: ToolCallStatus, error?: string): boolean {
    return this._owner.get(id)?.setLastToolCallStatus(id, status, error) ?? false;
  }

  setMessages(id: string, messages: ChatMessage[]): boolean {
    return this._owner.get(id)?.setMessages(id, messages) ?? false;
  }

  searchTranscript(id: string, query: string, opts?: ChatSearchOptions): ChatTranscriptSearch {
    const store = this._owner.get(id);
    return store
      ? store.searchTranscript(id, query, opts)
      : searchTranscript(undefined, query, opts);
  }

  // ── Open state ("opened once", memory-only) ──────────────────────────

  markOpen(id: string, winId: string): void {
    if (this._openChats.get(id) === winId) return;
    this._openChats.set(id, winId);
    this._notifyOpen();
  }

  markClosed(id: string): void {
    if (!this._openChats.delete(id)) return;
    this._notifyOpen();
  }

  getOpenWin(id: string): string | null {
    return this._openChats.get(id) ?? null;
  }

  /** True when the thread is open in a window other than `winId`. */
  isOpenElsewhere(id: string, winId: string): boolean {
    const owner = this._openChats.get(id);
    return owner !== undefined && owner !== winId;
  }

  /** All open-thread window ids (for broadcast targeting). */
  getOpenChatWindowIds(): string[] {
    return Array.from(this._openChats.values());
  }

  /** The full open map (threadId -> winId), for broadcast snapshots. */
  getOpenChats(): Record<string, string> {
    return Object.fromEntries(this._openChats);
  }

  onOpenStateChange(cb: () => void): () => void {
    this._openStateListeners.add(cb);
    return () => this._openStateListeners.delete(cb);
  }

  /** Write every workspace's unsaved changes now (at quit). */
  flush(): void {
    for (const store of this._stores.values()) store.flush();
  }

  private _store(workspaceId: string | undefined): ChatThreadStore | undefined {
    return workspaceId ? this._stores.get(workspaceId) : undefined;
  }

  private _notifyOpen(): void {
    for (const cb of this._openStateListeners) {
      try {
        cb();
      } catch {
        // ignore listener errors
      }
    }
  }
}
