/**
 * json-tokenize — a lightweight JSON tokenizer that records source offsets.
 * The editor uses it to render syntax-highlighted line content itself (so it
 * can attach per-token click ranges for click-to-select) instead of relying on
 * an HTML string from the highlighter.
 *
 * Pure module — no DOM, no platform dependencies.
 */

export type JsonTokenKind = "ws" | "string" | "number" | "keyword" | "punct";

export interface JsonToken {
  kind: JsonTokenKind;
  /** Offset of the first character. */
  start: number;
  /** Offset after the last character. */
  end: number;
  value: string;
}

export function tokenizeJsonFull(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      let j = i + 1;
      while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r"))
        j++;
      tokens.push({ kind: "ws", start: i, end: j, value: text.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        const cc = text[j];
        if (cc === "\\") {
          j += 2;
          continue;
        }
        if (cc === '"') {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ kind: "string", start: i, end: j, value: text.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(text[j])) j++;
      tokens.push({ kind: "number", start: i, end: j, value: text.slice(i, j) });
      i = j;
      continue;
    }
    if ("{}[]:,".includes(c)) {
      tokens.push({ kind: "punct", start: i, end: i + 1, value: c });
      i++;
      continue;
    }
    if (text.startsWith("true", i) || text.startsWith("false", i) || text.startsWith("null", i)) {
      const word = text.startsWith("true", i)
        ? "true"
        : text.startsWith("false", i)
          ? "false"
          : "null";
      tokens.push({ kind: "keyword", start: i, end: i + word.length, value: word });
      i += word.length;
      continue;
    }
    // Unknown character (e.g. an unterminated/broken token) — render it as-is
    // so the caret stays aligned with what the user typed.
    tokens.push({ kind: "punct", start: i, end: i + 1, value: c });
    i++;
  }
  return tokens;
}

export interface SelectableRange {
  kind: "key" | "value";
  /** Selection start offset (excludes the surrounding quotes for strings). */
  start: number;
  end: number;
}

/** Determine which tokens are object keys / scalar values, and their
 *  click-to-select ranges. Keys and string values select their inner text
 *  (between the quotes) so typing immediately replaces the content and the
 *  quotes stay; numbers / literals select the whole token. */
export function selectableRanges(tokens: JsonToken[]): SelectableRange[] {
  const res: SelectableRange[] = [];
  const nonWs = tokens.filter((t) => t.kind !== "ws");
  for (let idx = 0; idx < nonWs.length; idx++) {
    const t = nonWs[idx];
    if (t.kind === "string") {
      const next = nonWs[idx + 1];
      const isKey = next && next.kind === "punct" && next.value === ":";
      res.push({
        kind: isKey ? "key" : "value",
        start: t.start + 1,
        end: Math.max(t.start + 1, t.end - 1),
      });
    } else if (t.kind === "number" || t.kind === "keyword") {
      res.push({ kind: "value", start: t.start, end: t.end });
    }
  }
  return res;
}
