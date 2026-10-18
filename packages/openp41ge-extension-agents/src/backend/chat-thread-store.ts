/**
 * ChatThreadStore — CRUD + search for the chat threads in one folder,
 * `<dataDir>/chat-threads/` (one folder per thread; see chat-thread-files.ts
 * for the format). Each workspace has its own store in its data folder; see
 * chat-threads.ts, which routes between them and tracks open state.
 *
 *   - Startup reads only the thread headers; a thread's message files load on
 *     demand (a page loads only the files it covers) and then stay cached.
 *   - Writes are batched: a change marks its header / message file dirty and
 *     dirty files are written within `flushDelayMs` (and on `flush()`, called
 *     at quit), so streaming a reply never rewrites files per chunk.
 */

import path from "path";
import { logFor } from "./log.js";
import { defaultChatTitle } from "../chat/title.js";
import {
  ChatThreadFiles,
  MESSAGES_SOFT_LIMIT,
  messageBytes,
  placeAppend,
  type ThreadFileInfo,
  type ThreadHeader,
} from "./chat-thread-files.js";
import { searchTranscript } from "../chat/search.js";

export { searchTranscript };
import type {
  Chat,
  ChatMessage,
  ChatSearchOptions,
  ChatSearchResult,
  ChatHeader,
  ChatSummary,
  ChatTranscriptPage,
  ChatTranscriptSearch,
  ToolCall,
  ToolCallStatus,
} from "../chat/types.js";

const log = logFor("chat-thread-store");

let _seq = 0;
function generateId(prefix: string): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ─── Pure search matcher (unit-testable, no I/O) ──────────────────────────

/**
 * Search chats by message text (user + assistant) and by tool-call command
 * (name + arguments). Tool results (role: "tool" content) are NEVER matched.
 * Returns per-chat matched message + tool-call ids.
 */
export function searchChats(
  chats: Chat[],
  query: string,
  opts: ChatSearchOptions = {},
): ChatSearchResult[] {
  const q = query.trim();
  if (!q) return [];

  let re: RegExp | null = null;
  if (opts.regex) {
    try {
      re = new RegExp(q, opts.caseSensitive ? "" : "i");
    } catch {
      return []; // invalid regex → nothing matches
    }
  }
  const needle = opts.caseSensitive ? q : q.toLowerCase();
  const matches = (text: string): boolean => {
    if (re) return re.test(text);
    return (opts.caseSensitive ? text : text.toLowerCase()).includes(needle);
  };

  const results: ChatSearchResult[] = [];
  for (const chat of chats) {
    const matchedMessageIds: string[] = [];
    const matchedToolCallIds: string[] = [];
    for (const msg of chat.messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        if (matches(msg.content ?? "")) matchedMessageIds.push(msg.id);
      }
      for (const tc of msg.toolCalls ?? []) {
        if (matches(tc.name) || matches(stringifyArgs(tc.arguments))) {
          matchedToolCallIds.push(tc.id);
        }
      }
    }
    if (matchedMessageIds.length > 0 || matchedToolCallIds.length > 0) {
      results.push({ chatId: chat.id, matchedMessageIds, matchedToolCallIds });
    }
  }
  return results;
}

function stringifyArgs(args: ToolCall["arguments"]): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

/** Build a ChatSummary from a Chat (user/assistant content + tool call counts). */
export function toSummary(chat: Chat): ChatSummary {
  let toolCallCount = 0;
  let messageCount = 0;
  let lastMessagePreview: string | undefined;
  for (const m of chat.messages) {
    messageCount += 1;
    toolCallCount += m.toolCalls?.length ?? 0;
    if (m.role === "user" || m.role === "assistant") {
      if ((m.content ?? "").trim()) lastMessagePreview = m.content!.slice(0, 80);
    }
  }
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    messageCount,
    toolCallCount,
    lastMessagePreview,
    description: chat.description,
  };
}

// ─── ChatThreadStore ─────────────────────────────────────────────────────

/** Folder (under the app-data root) holding one sub-folder per thread. */
export const CHAT_THREADS_DIR = "chat-threads";

/** A mutable thread header held in memory. */
type Header = { -readonly [K in keyof ThreadHeader]: ThreadHeader[K] } & {
  files: ThreadFileInfo[];
};

/** Per-thread in-memory state: loaded message files and what is unsaved. */
interface ThreadState {
  header: Header;
  /** Loaded message files by name (each in file order). */
  loaded: Map<string, ChatMessage[]>;
  headerDirty: boolean;
  dirtyFiles: Set<string>;
  /** Files to delete at the next flush (dropped by setMessages). */
  obsoleteFiles: Set<string>;
}

export interface ChatThreadStoreOptions {
  /** Soft size limit of a message file (default 512 KB). */
  readonly softLimit?: number;
  /** How soon unsaved changes are written (default 1000 ms). */
  readonly flushDelayMs?: number;
}

export class ChatThreadStore {
  private readonly _files: ChatThreadFiles;
  private readonly _softLimit: number;
  private readonly _flushDelayMs: number;
  private readonly _threads = new Map<string, ThreadState>();
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(openp41geDir: string, options: ChatThreadStoreOptions = {}) {
    this._files = new ChatThreadFiles(path.join(openp41geDir, CHAT_THREADS_DIR));
    this._softLimit = options.softLimit ?? MESSAGES_SOFT_LIMIT;
    this._flushDelayMs = options.flushDelayMs ?? 1000;
  }

  /** Read the thread headers (no messages). */
  init(): void {
    try {
      for (const h of this._files.listHeaders()) {
        this._threads.set(h.id, {
          header: { ...h, files: [...h.files] },
          loaded: new Map(),
          headerDirty: false,
          dirtyFiles: new Set(),
          obsoleteFiles: new Set(),
        });
      }
      log.info(`Chat threads loaded: ${this._threads.size}`);
    } catch (err) {
      log.error("Failed to load chat threads:", err);
    }
  }

  // ── Reading ──────────────────────────────────────────────────────────

  /** Every thread id (archived included). */
  threadIds(): string[] {
    return [...this._threads.keys()];
  }

  /** Unarchived threads, newest first. Loads every message; prefer listSummaries. */
  list(): Chat[] {
    return this._visible().map((t) => this._chat(t));
  }

  /** Summaries of the threads `list` returns, from the headers alone;
   *  with `archived`, the archived threads too (they carry `archivedAt`). */
  listSummaries(opts: { archived?: boolean } = {}): ChatSummary[] {
    return this._visible(opts.archived).map(({ header: h }) => ({
      id: h.id,
      title: h.title,
      updatedAt: h.updatedAt,
      messageCount: h.messageCount,
      toolCallCount: h.toolCallCount,
      lastMessagePreview: h.lastMessagePreview,
      description: h.description,
      ...(h.archivedAt ? { archivedAt: h.archivedAt } : {}),
    }));
  }

  /** A thread's folder: its header and message files (null: unknown). */
  threadDir(id: string): string | null {
    return this._threads.has(id) ? this._files.threadDir(id) : null;
  }

  /** The whole thread (loads every message file). */
  get(id: string): Chat | null {
    const t = this._threads.get(id);
    return t ? this._chat(t) : null;
  }

  /** A thread's header (no messages) so it can be opened without loading its
   *  transcript. */
  getHeader(id: string): ChatHeader | null {
    const h = this._threads.get(id)?.header;
    if (!h) return null;
    return {
      id: h.id,
      title: h.title,
      providerId: h.providerId,
      totalMessages: h.messageCount,
      description: h.description,
    };
  }

  /** A page of a thread's transcript (0-based index), loading only the
   *  message files the page covers. */
  getMessages(chatId: string, offset = 0, count = 100): ChatTranscriptPage {
    const t = this._threads.get(chatId);
    if (!t) return { chatId, start: 0, total: 0, messages: [] };
    const total = t.header.messageCount;
    const start = Math.max(0, Math.min(offset, total));
    const end = Math.min(total, start + Math.max(0, count));
    const messages: ChatMessage[] = [];
    let first = 0;
    for (const f of t.header.files) {
      const last = first + f.count;
      if (last > start && first < end) {
        const file = this._load(t, f.name);
        messages.push(...file.slice(Math.max(0, start - first), Math.min(f.count, end - first)));
      }
      first = last;
    }
    return { chatId, start, total, messages };
  }

  // ── Threads ──────────────────────────────────────────────────────────

  create(opts: { providerId?: string; title?: string } = {}): Chat {
    const now = Date.now();
    const header: Header = {
      version: 1,
      id: generateId("chat"),
      title: opts.title?.trim() || defaultChatTitle(now),
      providerId: opts.providerId ?? "vllm",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      toolCallCount: 0,
      files: [],
    };
    const t: ThreadState = {
      header,
      loaded: new Map(),
      headerDirty: true,
      dirtyFiles: new Set(),
      obsoleteFiles: new Set(),
    };
    this._threads.set(header.id, t);
    this._scheduleFlush();
    return this._chat(t);
  }

  delete(id: string): boolean {
    const existed = this._threads.delete(id);
    if (existed) {
      try {
        this._files.deleteThread(id);
      } catch (err) {
        log.error("Failed to delete chat thread:", id, err);
      }
    }
    return existed;
  }

  /**
   * Archive a thread: hidden from the default list and search, NOT deleted —
   * still retrievable via get() and kept on disk.
   */
  archive(id: string): boolean {
    const t = this._threads.get(id);
    if (!t || t.header.archivedAt) return false;
    t.header.archivedAt = Date.now();
    this._touchHeader(t);
    return true;
  }

  /** Bring an archived thread back into the default list. */
  unarchive(id: string): boolean {
    const t = this._threads.get(id);
    if (!t?.header.archivedAt) return false;
    delete t.header.archivedAt;
    this._touchHeader(t);
    return true;
  }

  rename(id: string, title: string): Chat | null {
    const t = this._threads.get(id);
    if (!t) return null;
    const next = title.trim();
    if (next) t.header.title = next;
    t.header.updatedAt = Date.now();
    this._touchHeader(t);
    return this._chat(t);
  }

  // ── Message / tool-call mutations (used by AgentRuntime) ─────────────

  appendMessage(id: string, msg: Omit<ChatMessage, "timestamp">): boolean {
    const t = this._threads.get(id);
    if (!t) return false;
    const message = { ...msg, timestamp: Date.now() } as ChatMessage;
    // Size the newest file from memory when loaded (a streamed message may
    // have grown since the header's byte count was written).
    const newest = t.header.files[t.header.files.length - 1];
    if (newest && t.loaded.has(newest.name)) {
      const bytes = t.loaded.get(newest.name)!.reduce((n, m) => n + messageBytes(m), 0);
      t.header.files[t.header.files.length - 1] = { ...newest, bytes };
    }
    const { files, fileIndex } = placeAppend(
      t.header.files,
      messageBytes(message),
      this._softLimit,
    );
    const name = files[fileIndex].name;
    const target = fileIndex < t.header.files.length ? this._load(t, name) : [];
    t.header.files = files;
    t.loaded.set(name, [...target, message]);
    const h = t.header;
    if (msg.role === "user" && !h.lastMessagePreview && (msg.content ?? "").slice(0, 40)) {
      // The first user message titles the thread.
      h.title = (msg.content ?? "").slice(0, 40);
    }
    h.messageCount += 1;
    h.toolCallCount += msg.toolCalls?.length ?? 0;
    this._notePreview(h, message);
    h.updatedAt = Date.now();
    t.dirtyFiles.add(name);
    this._touchHeader(t);
    return true;
  }

  /** Update a message in place (streaming assistant content, tool status). */
  updateMessage(id: string, messageId: string, fn: (msg: ChatMessage) => void): boolean {
    return this._mutate(id, (m) => m.id === messageId, fn);
  }

  updateToolCall(id: string, toolCallId: string, fn: (tc: ToolCall) => void): boolean {
    return this._mutate(
      id,
      (m) => !!m.toolCalls?.some((t) => t.id === toolCallId),
      (m) => {
        const tc = m.toolCalls!.find((t) => t.id === toolCallId)!;
        fn(tc);
        if (m.segments) {
          m.segments = m.segments.map((s) =>
            s.type === "tool" && s.toolCall?.id === toolCallId
              ? {
                  ...s,
                  toolCall: {
                    ...s.toolCall,
                    status: tc.status,
                    ...(tc.error ? { error: tc.error } : {}),
                    ...(tc.run ? { run: tc.run } : {}),
                  },
                }
              : s,
          );
        }
      },
    );
  }

  setLastToolCallStatus(chatId: string, status: ToolCallStatus, error?: string): boolean {
    const t = this._threads.get(chatId);
    const newest = t?.header.files[t.header.files.length - 1];
    if (!t || !newest) return false;
    const last = this._load(t, newest.name).at(-1);
    if (!last) return false;
    return this._mutate(
      chatId,
      (m) => m === last,
      (m) => {
        const tc = m.toolCalls?.[m.toolCalls.length - 1];
        if (tc) {
          tc.status = status;
          if (error !== undefined) tc.error = error;
        }
      },
    );
  }

  /** Replace the entire message list (used to replace the in-flight reply). */
  setMessages(id: string, messages: ChatMessage[]): boolean {
    const t = this._threads.get(id);
    if (!t) return false;
    for (const f of t.header.files) t.obsoleteFiles.add(f.name);
    t.loaded.clear();
    t.dirtyFiles.clear();
    let files: ThreadFileInfo[] = [];
    const h = t.header;
    h.messageCount = 0;
    h.toolCallCount = 0;
    h.lastMessagePreview = undefined;
    for (const m of messages) {
      const placed = placeAppend(files, messageBytes(m), this._softLimit);
      files = placed.files;
      const name = files[placed.fileIndex].name;
      t.loaded.set(name, [...(t.loaded.get(name) ?? []), m]);
      t.dirtyFiles.add(name);
      t.obsoleteFiles.delete(name);
      h.messageCount += 1;
      h.toolCallCount += m.toolCalls?.length ?? 0;
      this._notePreview(h, m);
    }
    h.files = files;
    h.updatedAt = Date.now();
    this._touchHeader(t);
    return true;
  }

  /**
   * Import whole chats as threads (the one-time migration from chats.json):
   * ids, titles, dates, archived state and messages are kept; the threads
   * have no workspace. Written immediately. Existing ids are left alone.
   */
  importThreads(chats: readonly Chat[]): number {
    let imported = 0;
    for (const chat of chats) {
      if (!chat?.id || this._threads.has(chat.id)) continue;
      const t: ThreadState = {
        header: {
          version: 1,
          id: chat.id,
          title: chat.title,
          providerId: chat.providerId,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          ...(chat.description ? { description: chat.description } : {}),
          ...(chat.archivedAt ? { archivedAt: chat.archivedAt } : {}),
          messageCount: 0,
          toolCallCount: 0,
          files: [],
        },
        loaded: new Map(),
        headerDirty: true,
        dirtyFiles: new Set(),
        obsoleteFiles: new Set(),
      };
      this._threads.set(chat.id, t);
      const updatedAt = chat.updatedAt;
      this.setMessages(chat.id, chat.messages ?? []);
      t.header.updatedAt = updatedAt;
      this._flushThread(t);
      imported++;
    }
    return imported;
  }

  // ── Search ───────────────────────────────────────────────────────────

  /** Search unarchived threads (loads their messages). */
  search(query: string, opts?: ChatSearchOptions): ChatSearchResult[] {
    return searchChats(this.list(), query, opts);
  }

  /** Node-side in-thread search: the ordered hit list + running total for
   *  one thread, so the view never scans the whole transcript. */
  searchTranscript(chatId: string, query: string, opts?: ChatSearchOptions): ChatTranscriptSearch {
    return searchTranscript(this.get(chatId) ?? undefined, query, opts);
  }

  // ── Persistence ──────────────────────────────────────────────────────

  /** Write every unsaved change now (called at quit; tests). */
  flush(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    for (const t of this._threads.values()) {
      try {
        this._flushThread(t);
      } catch (err) {
        log.error("Failed to save chat thread:", t.header.id, err);
      }
    }
  }

  private _flushThread(t: ThreadState): void {
    const id = t.header.id;
    for (const name of t.dirtyFiles) {
      const bytes = this._files.writeMessages(id, name, t.loaded.get(name) ?? []);
      t.header.files = t.header.files.map((f) => (f.name === name ? { ...f, bytes } : f));
      t.headerDirty = true;
    }
    t.dirtyFiles.clear();
    for (const name of t.obsoleteFiles) this._files.removeMessages(id, name);
    t.obsoleteFiles.clear();
    if (t.headerDirty) this._files.writeHeader(t.header);
    t.headerDirty = false;
  }

  private _scheduleFlush(): void {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, this._flushDelayMs);
    this._flushTimer.unref?.();
  }

  private _touchHeader(t: ThreadState): void {
    t.headerDirty = true;
    this._scheduleFlush();
  }

  // ── Internals ────────────────────────────────────────────────────────

  private _visible(archived = false): ThreadState[] {
    return Array.from(this._threads.values())
      .filter((t) => archived || !t.header.archivedAt)
      .sort((a, b) => b.header.updatedAt - a.header.updatedAt);
  }

  /** A message file's messages, loading (and caching) it on first use. */
  private _load(t: ThreadState, name: string): ChatMessage[] {
    let messages = t.loaded.get(name);
    if (!messages) {
      messages = this._files.readMessages(t.header.id, name);
      t.loaded.set(name, messages);
    }
    return messages;
  }

  /** The whole thread as a Chat (loads every message file). */
  private _chat(t: ThreadState): Chat {
    const h = t.header;
    return {
      id: h.id,
      title: h.title,
      providerId: h.providerId,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
      messages: h.files.flatMap((f) => this._load(t, f.name)),
      ...(h.description ? { description: h.description } : {}),
      ...(h.archivedAt ? { archivedAt: h.archivedAt } : {}),
    };
  }

  /**
   * Apply `fn` to the newest message matching `match`, searching loaded files
   * newest first and loading older files only as needed.
   */
  private _mutate(
    id: string,
    match: (m: ChatMessage) => boolean,
    fn: (m: ChatMessage) => void,
  ): boolean {
    const t = this._threads.get(id);
    if (!t) return false;
    for (let i = t.header.files.length - 1; i >= 0; i--) {
      const name = t.header.files[i].name;
      const messages = this._load(t, name);
      const m = [...messages].reverse().find(match);
      if (!m) continue;
      const toolsBefore = m.toolCalls?.length ?? 0;
      fn(m);
      const h = t.header;
      h.toolCallCount += (m.toolCalls?.length ?? 0) - toolsBefore;
      if (i === t.header.files.length - 1 && messages[messages.length - 1] === m) {
        this._notePreview(h, m);
      }
      h.updatedAt = Date.now();
      t.dirtyFiles.add(name);
      this._touchHeader(t);
      return true;
    }
    return false;
  }

  /** Keep the header's preview: the latest user/assistant text. */
  private _notePreview(h: Header, m: ChatMessage): void {
    if ((m.role === "user" || m.role === "assistant") && (m.content ?? "").trim()) {
      h.lastMessagePreview = m.content!.slice(0, 80);
    }
  }
}
