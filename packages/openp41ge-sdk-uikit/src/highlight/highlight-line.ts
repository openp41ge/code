/**
 * highlightLine — lightweight synchronous syntax highlighting for a single
 * line of code, used by the Explorer's content-search match rows.
 *
 * It is intentionally NOT the full TextMate tokenizer (which is async and
 * depends on grammar loading). Instead it scans the line left-to-right and
 * wraps common constructs (comments, strings, keywords, numbers, function
 * calls, types) in the editor's `.s-*` scope class names, so the colours
 * match the file editor. It also wraps the matched search term in
 * `.cm-match-term` (respecting the regex / case-sensitivity flags).
 *
 * Pure module — no DOM, no platform dependencies.
 */

import { BUILTIN_LANGUAGES } from "openp41ge-core-syntax-highlighting/token-registry";

/** Extension (lowercase, no dot) → language id, plus a couple of specials. */
const EXT_TO_LANG: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const def of BUILTIN_LANGUAGES) {
    for (const ext of def.extensions) m.set(ext.toLowerCase(), def.id);
  }
  return m;
})();

/** Map a file path to a language id (based on its extension). */
export function languageFromPath(path: string): string | undefined {
  const base = (path.split("/").pop() ?? path).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXT_TO_LANG.get(base.slice(dot + 1));
}

/** Token class → scope class name (matches the editor's `.s-*` classes). */
const SCOPE_CLASS: Record<string, string> = {
  keyword: "s-kw",
  string: "s-str",
  comment: "s-cmt",
  number: "s-num",
  function: "s-fun",
  type: "s-type",
  operator: "s-op",
  punctuation: "s-pun",
  variable: "s-var",
  property: "s-var",
  entity: "s-ent",
  support: "s-sup",
  label: "s-lbl",
  "string.escape": "s-te",
  "string.regex": "s-rgx",
  tag: "s-tag",
  attr: "s-atr",
};

/** Typical keyword sets — merged and matched case-insensitively. */
const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  javascript: [
    "function",
    "const",
    "let",
    "var",
    "if",
    "else",
    "for",
    "while",
    "do",
    "return",
    "class",
    "extends",
    "new",
    "import",
    "export",
    "from",
    "try",
    "catch",
    "finally",
    "throw",
    "switch",
    "case",
    "break",
    "continue",
    "async",
    "await",
    "typeof",
    "instanceof",
    "in",
    "of",
    "this",
    "super",
    "null",
    "undefined",
    "true",
    "false",
    "void",
    "delete",
    "yield",
    "static",
  ],
  typescript: [
    "function",
    "const",
    "let",
    "var",
    "if",
    "else",
    "for",
    "while",
    "do",
    "return",
    "class",
    "extends",
    "new",
    "import",
    "export",
    "from",
    "try",
    "catch",
    "finally",
    "throw",
    "switch",
    "case",
    "break",
    "continue",
    "async",
    "await",
    "typeof",
    "instanceof",
    "in",
    "of",
    "this",
    "super",
    "null",
    "undefined",
    "true",
    "false",
    "void",
    "delete",
    "yield",
    "static",
    "interface",
    "type",
    "enum",
    "implements",
    "readonly",
    "public",
    "private",
    "protected",
    "as",
    "declare",
    "abstract",
    "namespace",
    "module",
    "keyof",
  ],
  python: [
    "def",
    "class",
    "import",
    "from",
    "as",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "return",
    "try",
    "except",
    "finally",
    "with",
    "raise",
    "pass",
    "lambda",
    "yield",
    "global",
    "nonlocal",
    "del",
    "assert",
    "break",
    "continue",
    "in",
    "is",
    "not",
    "and",
    "or",
    "None",
    "True",
    "False",
    "async",
    "await",
    "match",
    "case",
    "self",
  ],
};

/** A single highlighted segment. */
interface Segment {
  text: string;
  cls: string;
}

/** Languages where `<` starts a tag rather than a comparison operator. */
const MARKUP_LANGUAGES = new Set(["html", "xml", "svg", "vue", "svelte", "markup"]);

/** Characters treated as punctuation/operators (colourised via s-pun / s-op). */
const PUNCT_CHARS = ".,;:()[]{}!";

/** Characters treated as operators (colourised via s-op). */
const OP_CHARS = "+-*/%=&|^~<>?:";

function keywordSet(language?: string): Set<string> {
  const list = (language && LANGUAGE_KEYWORDS[language]) || LANGUAGE_KEYWORDS.javascript;
  return new Set((list ?? []).map((k) => k.toLowerCase()));
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Scan a line into segments (text + scope class). No term-highlighting here —
 * that's applied by `renderHighlighted` so it can overlay query matches.
 */
function scanLine(text: string, language?: string): Segment[] {
  const segs: Segment[] = [];
  const kw = keywordSet(language);
  let i = 0;
  const n = text.length;
  let buffer = "";
  let bufferCls = "";
  const flush = () => {
    if (buffer) segs.push({ text: buffer, cls: bufferCls });
    buffer = "";
    bufferCls = "";
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    // Line comment
    if (
      (ch === "/" && next === "/") ||
      (ch === "#" && (language === "python" || language === "shell")) ||
      (ch === "-" && next === "-" && language === "sql")
    ) {
      flush();
      segs.push({ text: text.slice(i), cls: SCOPE_CLASS.comment });
      return segs;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      flush();
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      segs.push({ text: text.slice(i, stop), cls: SCOPE_CLASS.comment });
      i = stop;
      continue;
    }
    if (ch === "<" && next === "!" && text[i + 2] === "-" && text[i + 3] === "-") {
      flush();
      const end = text.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      segs.push({ text: text.slice(i, stop), cls: SCOPE_CLASS.comment });
      i = stop;
      continue;
    }

    // String
    if (ch === '"' || ch === "'" || ch === "`") {
      flush();
      const quote = ch;
      let j = i + 1;
      while (j < n && text[j] !== quote) {
        if (text[j] === "\\") j += 2;
        else j += 1;
      }
      const stop = j < n ? j + 1 : j;
      segs.push({ text: text.slice(i, stop), cls: SCOPE_CLASS.string });
      i = stop;
      continue;
    }

    // Number
    if (/[0-9]/.test(ch) && !isIdentChar(text[i - 1] ?? "")) {
      flush();
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB_.]/.test(text[j])) j++;
      segs.push({ text: text.slice(i, j), cls: SCOPE_CLASS.number });
      i = j;
      continue;
    }

    // HTML tag — <name attr="value" ...> / closing tag / comment handled above.
    // Only in markup languages so JS/TS `<` comparisons (x < y) stay operators.
    if (
      ch === "<" &&
      MARKUP_LANGUAGES.has(language ?? "") &&
      (next === "/" || /[A-Za-z]/.test(next ?? ""))
    ) {
      flush();
      const { segs: tagSegs, next: tagNext } = scanHtmlTag(text, i);
      segs.push(...tagSegs);
      i = tagNext;
      continue;
    }

    // Identifier / keyword / function / type / member
    if (isIdentChar(ch)) {
      flush();
      let j = i;
      while (j < n && isIdentChar(text[j])) j++;
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      const nextCh = text[j];
      const prevCh = text[i - 1];
      if (kw.has(lower)) {
        segs.push({ text: word, cls: SCOPE_CLASS.keyword });
      } else if (nextCh === "(") {
        segs.push({ text: word, cls: SCOPE_CLASS.function });
      } else if (prevCh === ".") {
        // Member/property access (foo.bar) → variable colour.
        segs.push({ text: word, cls: SCOPE_CLASS.property });
      } else if (nextCh === ".") {
        // Object/namespace before a member access (console.log) → support colour.
        segs.push({ text: word, cls: SCOPE_CLASS.support });
      } else if (/^[A-Z]/.test(word)) {
        segs.push({ text: word, cls: SCOPE_CLASS.type });
      } else {
        // Standalone identifier (variable) — colour it so it doesn't read white.
        segs.push({ text: word, cls: SCOPE_CLASS.variable });
      }
      i = j;
      continue;
    }

    // Operator
    if (OP_CHARS.includes(ch)) {
      if (bufferCls !== SCOPE_CLASS.operator) {
        flush();
        bufferCls = SCOPE_CLASS.operator;
      }
      buffer += ch;
      i++;
      continue;
    }

    // Punctuation (., ; : ( ) [ ] { })
    if (PUNCT_CHARS.includes(ch)) {
      if (bufferCls !== SCOPE_CLASS.punctuation) {
        flush();
        bufferCls = SCOPE_CLASS.punctuation;
      }
      buffer += ch;
      i++;
      continue;
    }

    // Plain char
    if (bufferCls !== "") flush();
    buffer += ch;
    i++;
  }
  flush();
  return segs;
}

/**
 * Scan an HTML tag starting at `<`. Returns the segments for the tag (tag
 * name, attribute names, attribute values) and the index just past the `>`.
 */
function scanHtmlTag(text: string, start: number): { segs: Segment[]; next: number } {
  const segs: Segment[] = [];
  const n = text.length;
  let i = start;
  if (text[i] !== "<") return { segs: [{ text: "<", cls: "" }], next: i + 1 };
  i++;
  if (text[i] === "/") {
    // `</tag>` — colour the tag name.
    i++;
    const wordStart = i;
    while (i < n && isIdentChar(text[i])) i++;
    const name = text.slice(wordStart, i);
    if (name) segs.push({ text: `</`, cls: "" });
    if (name) segs.push({ text: name, cls: SCOPE_CLASS.tag });
    while (i < n && text[i] !== ">") i++;
    if (i < n && text[i] === ">") {
      segs.push({ text: ">", cls: "" });
      i++;
    }
    return { segs, next: i };
  }
  // Opening tag — tag name + attributes.
  const wordStart = i;
  while (i < n && isIdentChar(text[i])) i++;
  const tagName = text.slice(wordStart, i);
  if (tagName) segs.push({ text: text.slice(start, wordStart), cls: "" });
  if (tagName) segs.push({ text: tagName, cls: SCOPE_CLASS.tag });
  while (i < n && text[i] !== ">") {
    // Skip whitespace, emitting it as plain.
    while (i < n && /\s/.test(text[i])) {
      segs.push({ text: text[i], cls: "" });
      i++;
    }
    if (i < n && text[i] === ">") break;
    // Attribute name.
    const attrStart = i;
    while (i < n && /[A-Za-z0-9_:-]/.test(text[i])) i++;
    const attrName = text.slice(attrStart, i);
    if (attrName) segs.push({ text: attrName, cls: SCOPE_CLASS.attr });
    // Skip whitespace before `=`.
    while (i < n && /\s/.test(text[i])) {
      segs.push({ text: text[i], cls: "" });
      i++;
    }
    if (text[i] === "=") {
      segs.push({ text: "=", cls: "" });
      i++;
      while (i < n && /\s/.test(text[i])) i++;
      // Attribute value (quoted or bare).
      const q = text[i];
      if (q === '"' || q === "'") {
        const valueStart = i;
        i++;
        while (i < n && text[i] !== q) i++;
        if (i < n) i++;
        const raw = text.slice(valueStart, i);
        segs.push({ text: raw, cls: SCOPE_CLASS.string });
      } else {
        const valueStart = i;
        while (i < n && !/\s/.test(text[i]) && text[i] !== ">") i++;
        const raw = text.slice(valueStart, i);
        if (raw) segs.push({ text: raw, cls: SCOPE_CLASS.string });
      }
    }
  }
  if (i < n && text[i] === ">") {
    segs.push({ text: ">", cls: "" });
    i++;
  }
  return { segs, next: i };
}

export interface HighlightLineOptions {
  language?: string;
  /** The search term to highlight (empty = none). */
  query?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  /**
   * Highlight only this single range (0-based start/end offsets in `text`)
   * instead of every query occurrence. Used by the Explorer's content-match
   * rows so each row highlights only the specific match instance it represents
   * rather than every nearby occurrence of the same term.
   */
  matchStart?: number;
  matchEnd?: number;
}

/** Find all occurrences of a query in the raw text (start/end char offsets). */
function matchRanges(
  text: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): Array<[number, number]> {
  if (!query) return [];
  const ranges: Array<[number, number]> = [];
  try {
    let re: RegExp;
    if (regex) {
      re = new RegExp(query, caseSensitive ? "g" : "gi");
    } else {
      re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Guard against zero-width matches to avoid an infinite loop.
      if (m.index === re.lastIndex) re.lastIndex++;
      if (m[0].length > 0) ranges.push([m.index, m.index + m[0].length]);
    }
  } catch {
    // Invalid regex — ignore highlighting rather than breaking the row.
  }
  return ranges;
}

/** Escape HTML so user content can't inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

export interface CropLineOptions {
  /** Maximum characters of the cropped line (including ellipsis markers). */
  maxChars?: number;
  /** Context characters kept before the matched range. Default 24. */
  before?: number;
  /** Context characters kept after the matched range. Default 24. */
  after?: number;
  /** Marker used when content is cut (default "…"). */
  ellipsis?: string;
}

export interface CropLineResult {
  /** The cropped line text (may be prefixed/suffixed with an ellipsis). */
  text: string;
  /** 0-based index in `text` where the original matched range begins. */
  matchStart: number;
  /** 0-based index in `text` where the original matched range ends. */
  matchEnd: number;
}

/**
 * Crop a line to a window centred on the matched range so the match (and
 * surrounding context) is visible instead of only the line's beginning.
 *
 * If the line fits within `maxChars` the whole line is returned unchanged. A
 * leading/trailing ellipsis is added when content is cut off on either side.
 */
export function cropLine(
  line: string,
  start: number,
  end: number,
  opts: CropLineOptions = {},
): CropLineResult {
  const maxChars = opts.maxChars ?? 96;
  const before = opts.before ?? 24;
  const after = opts.after ?? 24;
  const ellipsis = opts.ellipsis ?? "…";
  const len = line.length;
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));

  // Short line (or empty match) → return as-is.
  if (len <= maxChars || e <= s) {
    return { text: line, matchStart: s, matchEnd: e };
  }

  // Desired window centred on the match.
  let winStart = Math.max(0, s - before);
  let winEnd = Math.min(len, e + after);
  if (winEnd - winStart > maxChars) {
    const fit = maxChars - (ellipsis.length > 0 ? ellipsis.length * 2 : 0);
    const center = Math.round((s + e) / 2);
    winStart = Math.max(0, center - Math.floor(fit / 2));
    winEnd = Math.min(len, winStart + fit);
    if (winEnd - winStart < fit) winStart = Math.max(0, winEnd - fit);
  }

  const prefix = winStart > 0;
  const suffix = winEnd < len;
  let text = line.slice(winStart, winEnd);
  const markerLen = ellipsis.length;
  const avail = maxChars - (prefix ? markerLen : 0) - (suffix ? markerLen : 0);
  if (text.length > avail) {
    text = text.slice(0, avail);
    winEnd = winStart + text.length;
  }
  if (prefix) text = ellipsis + text;
  if (suffix) text = text + ellipsis;

  // The match may be partially clipped; clamp the reported offsets.
  const rawStart = s - winStart;
  const rawEnd = e - winStart;
  const offset = prefix ? markerLen : 0;
  return {
    text,
    matchStart: Math.max(offset, offset + rawStart),
    matchEnd: Math.max(offset, offset + rawEnd),
  };
}

/**
 * Highlight a single line into an HTML string, wrapping the matched search
 * term in `.cm-match-term` and syntax tokens in `.s-*` spans.
 *
 * By default every occurrence of `query` in `text` is highlighted. When
 * `matchStart`/`matchEnd` are provided, only that single range is highlighted
 * (used by content-search rows to pin the highlight to one instance).
 */
export function highlightLine(text: string, opts: HighlightLineOptions = {}): string {
  const segments = scanLine(text, opts.language);
  let ranges: Array<[number, number]>;
  if (opts.matchStart !== undefined && opts.matchEnd !== undefined) {
    const s = Math.max(0, Math.min(opts.matchStart, text.length));
    const e = Math.max(s, Math.min(opts.matchEnd, text.length));
    ranges = e > s ? [[s, e]] : [];
  } else {
    ranges = matchRanges(text, opts.query ?? "", opts.regex ?? false, opts.caseSensitive ?? false);
  }
  return renderWithOffsets(segments, ranges);
}

/**
 * Render segments with correct absolute offsets so query-match overlays land
 * on the right characters.
 */
function renderWithOffsets(segments: Segment[], ranges: Array<[number, number]>): string {
  if (!ranges.length) {
    let out = "";
    for (const seg of segments) {
      out += seg.cls
        ? `<span class="${seg.cls}">${escapeHtml(seg.text)}</span>`
        : escapeHtml(seg.text);
    }
    return out;
  }
  let out = "";
  let offset = 0;
  for (const seg of segments) {
    const start = offset;
    const end = offset + seg.text.length;
    offset = end;
    // Chunk the segment into matched / unmatched pieces.
    const overlaps = ranges.filter(([rs, re]) => rs < end && re > start);
    if (overlaps.length === 0) {
      out += seg.cls
        ? `<span class="${seg.cls}">${escapeHtml(seg.text)}</span>`
        : escapeHtml(seg.text);
      continue;
    }
    // Build pieces.
    let pos = start;
    for (const [rs, re] of overlaps) {
      const s = Math.max(rs, start);
      const e = Math.min(re, end);
      if (s > pos) {
        const gap = seg.text.slice(pos - start, s - start);
        out += seg.cls ? `<span class="${seg.cls}">${escapeHtml(gap)}</span>` : escapeHtml(gap);
      }
      const matched = seg.text.slice(s - start, e - start);
      out += `<span class="cm-match-term${seg.cls ? ` ${seg.cls}` : ""}">${escapeHtml(matched)}</span>`;
      pos = e;
    }
    if (pos < end) {
      const tail = seg.text.slice(pos - start);
      out += seg.cls ? `<span class="${seg.cls}">${escapeHtml(tail)}</span>` : escapeHtml(tail);
    }
  }
  return out;
}
