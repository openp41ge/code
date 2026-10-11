/**
 * Shared, dependency-free in-chat search primitives.
 *
 * Shared by the backend (which runs the real search over the persisted chats)
 * and the chat UI, so both use the exact same flattening + matching logic. The
 * chat element receives the hit list from the backend and only re-locates the
 * active occurrence in its own DOM.
 */

import type {
  Chat,
  ChatMessage,
  ChatSearchOptions,
  ChatTranscriptHit,
  ChatTranscriptSearch,
  ToolCall,
} from "./types.js";

function stringifyArgs(args: ToolCall["arguments"]): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function stringifyToolCall(tc: ToolCall): string {
  return `${tc.name ?? ""} ${stringifyArgs(tc.arguments)}`;
}

/** The flattened, searchable text of one message, mirroring its render order
 *  (reasoning first, then content/segments, then tool calls). Tool calls are
 *  included as `name` + serialized arguments so commands stay findable. */
export function flattenMessageText(msg: ChatMessage): string {
  let out = msg.reasoning ?? "";
  if (msg.segments && msg.segments.length > 0) {
    for (const seg of msg.segments) {
      if (seg.type === "text") out += seg.text ?? "";
      else if (seg.toolCall) out += stringifyToolCall(seg.toolCall);
    }
  } else {
    out += msg.content ?? "";
    for (const tc of msg.toolCalls ?? []) out += stringifyToolCall(tc);
  }
  return out;
}

/**
 * Find every occurrence of `query` in `chat`, returning an ordered hit list
 * plus the running total. Runs entirely on the data (no DOM), so it is safe
 * to execute on the Node side regardless of transcript size.
 */
export function searchTranscript(
  chat: Chat | undefined,
  query: string,
  opts: ChatSearchOptions = {},
): ChatTranscriptSearch {
  const q = query.trim();
  const meta = { query: q, regex: !!opts.regex, caseSensitive: !!opts.caseSensitive };
  if (!q || !chat) return { ...meta, total: 0, hits: [] };

  let re: RegExp | null = null;
  if (opts.regex) {
    try {
      re = new RegExp(q, opts.caseSensitive ? "g" : "gi");
    } catch {
      return { ...meta, total: 0, hits: [] };
    }
  }
  const needle = opts.caseSensitive ? q : q.toLowerCase();

  const hits: ChatTranscriptHit[] = [];
  const msgOrdinal = new Map<string, number>();
  const hitFor = (messageId: string, messageIndex: number, text: string): ChatTranscriptHit => {
    const order = msgOrdinal.get(messageId) ?? 0;
    msgOrdinal.set(messageId, order + 1);
    return { messageId, text, order, messageIndex };
  };

  chat.messages.forEach((msg, messageIndex) => {
    const flat = flattenMessageText(msg);
    if (!flat) return;
    if (re) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) {
        hits.push(hitFor(msg.id, messageIndex, m[0]));
        if (m[0].length === 0) re.lastIndex++;
      }
    } else {
      const hay = opts.caseSensitive ? flat : flat.toLowerCase();
      let idx = 0;
      for (;;) {
        const at = hay.indexOf(needle, idx);
        if (at === -1) break;
        hits.push(hitFor(msg.id, messageIndex, flat.slice(at, at + needle.length)));
        idx = at + needle.length;
      }
    }
  });
  return { ...meta, total: hits.length, hits };
}
