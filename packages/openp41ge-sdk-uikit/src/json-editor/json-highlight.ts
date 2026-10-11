/**
 * json-highlight — lightweight JSON syntax highlighting.
 *
 * Splits a snippet of JSON text into tokens and maps each token onto an
 * editor scope class (`.s-*`) so the colours match the file editor's
 * TextMate theme output (plain JSON, as opposed to a special json viewer).
 *
 * Pure module — no DOM, no platform dependencies.
 */

export type JsonScope =
  | "key" // JSON object key (before a colon)
  | "string" // JSON string value
  | "number" // numeric literal
  | "literal" // true / false / null
  | "punct" // { } [ ] : ,
  | "plain"; // whitespace / anything else

export interface JsonToken {
  text: string;
  scope: JsonScope;
}

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/** Scope class names matching the file editor's `.s-*` classes. */
export const JSON_SCOPE_CLASS: Record<JsonScope, string> = {
  key: "s-var",
  string: "s-str",
  number: "s-num",
  literal: "s-kw",
  punct: "s-pun",
  plain: "",
};

/** Tokenize a string of JSON source into editor scope tokens. */
export function tokenizeJsonText(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      let j = i + 1;
      while (j < n && /[ \t\n\r]/.test(text[j])) j++;
      tokens.push({ text: text.slice(i, j), scope: "plain" });
      i = j;
      continue;
    }
    // Punctuation
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === ":" || ch === ",") {
      tokens.push({ text: ch, scope: "punct" });
      i++;
      continue;
    }
    // String
    if (ch === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < n) {
        const c = text[j];
        if (escaped) {
          escaped = false;
        } else if (c === "\\") {
          escaped = true;
        } else if (c === '"') {
          j++;
          break;
        }
        j++;
      }
      const str = text.slice(i, j);
      const k = skipWhitespace(text, j);
      // A string followed by a colon is an object key.
      tokens.push({ text: str, scope: text[k] === ":" ? "key" : "string" });
      i = j;
      continue;
    }
    // Number
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const match = NUMBER_RE.exec(text.slice(i));
      if (match) {
        tokens.push({ text: match[0], scope: "number" });
        i += match[0].length;
        continue;
      }
    }
    // Literals
    if (text.startsWith("true", i)) {
      tokens.push({ text: "true", scope: "literal" });
      i += 4;
      continue;
    }
    if (text.startsWith("false", i)) {
      tokens.push({ text: "false", scope: "literal" });
      i += 5;
      continue;
    }
    if (text.startsWith("null", i)) {
      tokens.push({ text: "null", scope: "literal" });
      i += 4;
      continue;
    }
    // Anything else — consume a char as plain.
    tokens.push({ text: ch, scope: "plain" });
    i++;
  }

  return tokens;
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /[ \t\n\r]/.test(text[i])) i++;
  return i;
}

/** Render a text snippet to an HTML string of `.s-*` spans (escape-safe). */
export function highlightJsonToHtml(text: string): string {
  let out = "";
  for (const tok of tokenizeJsonText(text)) {
    const cls = JSON_SCOPE_CLASS[tok.scope];
    const escaped = tok.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    out += cls ? `<span class="${cls}">${escaped}</span>` : escaped;
  }
  return out;
}
