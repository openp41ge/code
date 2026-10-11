/**
 * legacy-chats.ts — the `importLegacyChats` operation's writer: the chats of
 * an old `chats.json` written as chat-thread folders (the agents' on-disk
 * format, frozen here as it was when `chats.json` was retired):
 *
 *   <dir>/chat-threads/<id>/thread.json            the header
 *   <dir>/chat-threads/<id>/messages-000001.jsonl  one message per line, a new
 *                                                  file once one passes 512 KB
 *
 * A chat whose folder exists is left alone. Writes are atomic (temp + rename).
 */

import fs from "fs";
import path from "path";

/** A chat as `chats.json` kept it (the fields the import reads). */
export interface LegacyChat {
  readonly id: string;
  readonly title: string;
  readonly providerId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly description?: string;
  readonly archivedAt?: number;
  readonly messages?: ReadonlyArray<{
    readonly role?: string;
    readonly content?: string;
    readonly toolCalls?: readonly unknown[];
  }>;
}

const SOFT_LIMIT = 512 * 1024;

function writeAtomic(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, body, "utf-8");
  fs.renameSync(`${file}.tmp`, file);
}

/** Write each chat as a thread folder under `<dir>/chat-threads`; returns
 *  how many were written. */
export function importLegacyChats(chats: readonly LegacyChat[], dir: string): number {
  const root = path.join(dir, "chat-threads");
  let imported = 0;
  for (const chat of chats) {
    if (!chat?.id || chat.id !== path.basename(chat.id) || chat.id.startsWith(".")) continue;
    const threadDir = path.join(root, chat.id);
    if (fs.existsSync(threadDir)) continue;

    const files: Array<{ name: string; count: number; bytes: number; lines: string[] }> = [];
    let toolCallCount = 0;
    let lastMessagePreview: string | undefined;
    for (const m of chat.messages ?? []) {
      const line = JSON.stringify(m) + "\n";
      const bytes = Buffer.byteLength(line, "utf-8");
      let last = files[files.length - 1];
      if (!last || last.bytes >= SOFT_LIMIT) {
        last = {
          name: `messages-${String(files.length + 1).padStart(6, "0")}.jsonl`,
          count: 0,
          bytes: 0,
          lines: [],
        };
        files.push(last);
      }
      last.count += 1;
      last.bytes += bytes;
      last.lines.push(line);
      toolCallCount += m.toolCalls?.length ?? 0;
      if ((m.role === "user" || m.role === "assistant") && (m.content ?? "").trim()) {
        lastMessagePreview = m.content!.slice(0, 80);
      }
    }

    for (const f of files) writeAtomic(path.join(threadDir, f.name), f.lines.join(""));
    const header = {
      version: 1,
      id: chat.id,
      title: chat.title,
      providerId: chat.providerId,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      ...(chat.description ? { description: chat.description } : {}),
      ...(chat.archivedAt ? { archivedAt: chat.archivedAt } : {}),
      messageCount: files.reduce((n, f) => n + f.count, 0),
      toolCallCount,
      ...(lastMessagePreview !== undefined ? { lastMessagePreview } : {}),
      files: files.map(({ name, count, bytes }) => ({ name, count, bytes })),
    };
    writeAtomic(path.join(threadDir, "thread.json"), JSON.stringify(header, null, 2));
    imported++;
  }
  return imported;
}
