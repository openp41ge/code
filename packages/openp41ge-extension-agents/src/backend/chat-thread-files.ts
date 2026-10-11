/**
 * chat-thread-files.ts — the on-disk format of chat threads.
 *
 *   <root>/<threadId>/thread.json            small header (see ThreadHeader)
 *   <root>/<threadId>/messages-000001.jsonl  one whole message per line
 *   <root>/<threadId>/messages-000002.jsonl  …oldest first
 *
 * Like the log files, a thread's history is spread over many files linked by
 * the header's ordered `files` list, so a reader loads only what it needs and
 * a write touches one small file. A message is never split across files: it
 * is written whole to the newest file, and a new file starts only once the
 * newest has passed MESSAGES_SOFT_LIMIT (so a file may exceed the limit by one
 * message). Every write is atomic (temp file + rename).
 */

import fs from "fs";
import path from "path";
import type { ChatMessage } from "../chat/types.js";

/** Soft size limit of one message file (see the module doc). */
export const MESSAGES_SOFT_LIMIT = 512 * 1024;

const HEADER_FILE = "thread.json";

/** One message file of a thread, as listed in its header. */
export interface ThreadFileInfo {
  readonly name: string;
  /** Messages in the file. */
  readonly count: number;
  /** Size of the file in bytes. */
  readonly bytes: number;
}

/** A thread's header: everything needed without loading its messages. */
export interface ThreadHeader {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly providerId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly description?: string;
  readonly archivedAt?: number;
  readonly messageCount: number;
  readonly toolCallCount: number;
  readonly lastMessagePreview?: string;
  /** The thread's message files, oldest first. */
  readonly files: readonly ThreadFileInfo[];
}

/** `messages-000001.jsonl` for n = 1. */
export function messageFileName(n: number): string {
  return `messages-${String(n).padStart(6, "0")}.jsonl`;
}

/** The bytes a message takes in a message file (its line). */
export function messageBytes(message: ChatMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf-8") + 1;
}

/**
 * Where a new message of `bytes` goes: the newest file, or a new file when
 * there is none or the newest has passed the soft limit. Returns the updated
 * file list and the index of the file the message went into.
 */
export function placeAppend(
  files: readonly ThreadFileInfo[],
  bytes: number,
  limit = MESSAGES_SOFT_LIMIT,
): { files: ThreadFileInfo[]; fileIndex: number } {
  const last = files[files.length - 1];
  if (!last || last.bytes >= limit) {
    return {
      files: [...files, { name: messageFileName(files.length + 1), count: 1, bytes }],
      fileIndex: files.length,
    };
  }
  const next = [...files];
  next[next.length - 1] = { ...last, count: last.count + 1, bytes: last.bytes + bytes };
  return { files: next, fileIndex: next.length - 1 };
}

/** Reads and writes thread folders under one root directory. */
export class ChatThreadFiles {
  constructor(private readonly _root: string) {}

  /** Every readable thread header (a corrupt or missing header is skipped). */
  listHeaders(): ThreadHeader[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this._root, { withFileTypes: true });
    } catch {
      return [];
    }
    const headers: ThreadHeader[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const raw = fs.readFileSync(path.join(this._root, e.name, HEADER_FILE), "utf-8");
        const h = JSON.parse(raw) as ThreadHeader;
        if (h && h.id === e.name && Array.isArray(h.files)) headers.push(h);
      } catch {
        // Unreadable thread: skipped (its folder is left for inspection).
      }
    }
    return headers;
  }

  /** The messages in one of a thread's files ([] when the file is missing). */
  readMessages(threadId: string, fileName: string): ChatMessage[] {
    const file = path.join(this._threadDir(threadId), path.basename(fileName));
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChatMessage);
  }

  /** Write a thread's header (creating its folder). */
  writeHeader(header: ThreadHeader): void {
    this._writeAtomic(header.id, HEADER_FILE, JSON.stringify(header, null, 2));
  }

  /** Write one of a thread's message files; returns its size in bytes. */
  writeMessages(threadId: string, fileName: string, messages: readonly ChatMessage[]): number {
    const body = messages.map((m) => JSON.stringify(m) + "\n").join("");
    this._writeAtomic(threadId, path.basename(fileName), body);
    return Buffer.byteLength(body, "utf-8");
  }

  /** Delete one of a thread's message files (no-op when missing). */
  removeMessages(threadId: string, fileName: string): void {
    fs.rmSync(path.join(this._threadDir(threadId), path.basename(fileName)), { force: true });
  }

  /** Delete a thread's folder. */
  deleteThread(threadId: string): void {
    fs.rmSync(this._threadDir(threadId), { recursive: true, force: true });
  }

  private _threadDir(threadId: string): string {
    if (!threadId || threadId !== path.basename(threadId) || threadId.startsWith(".")) {
      throw new Error(`invalid thread id: ${threadId}`);
    }
    return path.join(this._root, threadId);
  }

  private _writeAtomic(threadId: string, fileName: string, body: string): void {
    const dir = this._threadDir(threadId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, body, "utf-8");
    fs.renameSync(tmp, target);
  }
}
