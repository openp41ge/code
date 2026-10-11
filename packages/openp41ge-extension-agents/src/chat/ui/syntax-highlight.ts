/**
 * Lightweight, dependency-free syntax highlighter for chat code blocks.
 *
 * Renders code as HTML with `hl-*` span classes (same classes the platform's
 * editor uses). It is a best-effort, line-based tokenizer — good enough for the
 * short snippets an agent emits — covering the most common languages, with a
 * content-based language detector for fenced blocks that omit a language tag.
 *
 * All text is HTML-escaped; only a fixed set of spans is emitted.
 */

export type TokenType =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation"
  | "text"
  | "comment"
  | "escape"
  | "bracket"
  | "method"
  | "type";

export interface Token {
  type: TokenType;
  value: string;
}

const CSS_CLASS: Record<TokenType, string> = {
  key: "hl-key",
  string: "hl-string",
  number: "hl-number",
  boolean: "hl-bool",
  null: "hl-null",
  punctuation: "hl-punct",
  text: "hl-text",
  comment: "hl-comment",
  escape: "hl-escape",
  bracket: "hl-bracket",
  method: "hl-method",
  type: "hl-type",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTokens(tokens: Token[], line: string): string {
  if (tokens.length === 0) return escapeHtml(line);
  return tokens
    .map((t) => `<span class="${CSS_CLASS[t.type]}">${escapeHtml(t.value)}</span>`)
    .join("");
}

// ──────────────────────────────────────────────
// Language configs
// ──────────────────────────────────────────────

interface LangConfig {
  id: string;
  label: string;
  keywords?: Set<string>;
  types?: Set<string>;
  booleans?: Set<string>;
  nulls?: Set<string>;
  lineComments?: string[];
  blockComment?: [string, string];
  stringQuotes?: string[];
  /** Treat an identifier immediately followed by `:` as a key (CSS/yaml/json). */
  keyBeforeColon?: boolean;
}

const JS_KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "type",
  "interface",
  "enum",
  "implements",
  "abstract",
  "private",
  "protected",
  "public",
  "readonly",
  "as",
  "from",
  "declare",
  "namespace",
  "module",
]);

const JS_TYPES = new Set([
  "any",
  "never",
  "unknown",
  "string",
  "number",
  "boolean",
  "symbol",
  "void",
  "undefined",
  "null",
  "object",
  "bigint",
]);

const PY_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

const GO_KEYWORDS = new Set([
  "break",
  "case",
  "chan",
  "const",
  "continue",
  "default",
  "defer",
  "else",
  "fallthrough",
  "for",
  "func",
  "go",
  "goto",
  "if",
  "import",
  "interface",
  "map",
  "package",
  "range",
  "return",
  "select",
  "struct",
  "switch",
  "type",
  "var",
  "make",
  "new",
  "len",
  "cap",
  "append",
  "copy",
  "delete",
  "nil",
]);

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "delete",
  "create",
  "table",
  "drop",
  "alter",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "on",
  "group",
  "by",
  "order",
  "having",
  "limit",
  "offset",
  "and",
  "or",
  "not",
  "null",
  "as",
  "distinct",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "like",
  "between",
  "in",
  "exists",
  "case",
  "when",
  "then",
  "else",
  "end",
  "union",
  "all",
  "primary",
  "key",
  "foreign",
  "references",
  "index",
]);

const LANG_CONFIGS: Record<string, LangConfig> = {
  javascript: {
    id: "javascript",
    label: "JS",
    keywords: JS_KEYWORDS,
    types: JS_TYPES,
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null", "undefined"]),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ["'", '"', "`"],
  },
  typescript: {
    id: "typescript",
    label: "TS",
    keywords: JS_KEYWORDS,
    types: JS_TYPES,
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null", "undefined"]),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ["'", '"', "`"],
  },
  json: {
    id: "json",
    label: "JSON",
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null"]),
    stringQuotes: ['"'],
    keyBeforeColon: true,
  },
  python: {
    id: "python",
    label: "PY",
    keywords: PY_KEYWORDS,
    booleans: new Set(["True", "False"]),
    nulls: new Set(["None"]),
    lineComments: ["#"],
    stringQuotes: ["'", '"', "```"],
  },
  go: {
    id: "go",
    label: "Go",
    keywords: GO_KEYWORDS,
    booleans: new Set(["true", "false"]),
    nulls: new Set(["nil"]),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"', "`"],
  },
  rust: {
    id: "rust",
    label: "RS",
    keywords: RUST_KEYWORDS,
    booleans: new Set(["true", "false"]),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    stringQuotes: ['"'],
  },
  sql: {
    id: "sql",
    label: "SQL",
    keywords: SQL_KEYWORDS,
    nulls: new Set(["null"]),
    lineComments: ["--"],
    blockComment: ["/*", "*/"],
    stringQuotes: ["'"],
  },
  bash: {
    id: "bash",
    label: "sh",
    keywords: new Set([
      "if",
      "then",
      "else",
      "elif",
      "fi",
      "for",
      "while",
      "do",
      "done",
      "case",
      "esac",
      "function",
      "in",
      "echo",
      "exit",
      "return",
      "local",
      "export",
      "source",
      "echo",
      "cd",
      "ls",
      "mkdir",
      "rm",
      "cp",
      "mv",
    ]),
    lineComments: ["#"],
    stringQuotes: ["'", '"'],
  },
  yaml: {
    id: "yaml",
    label: "YAML",
    keywords: new Set(["true", "false", "null", "yes", "no", "on", "off"]),
    booleans: new Set(["true", "false", "yes", "no", "on", "off"]),
    nulls: new Set(["null", "~"]),
    lineComments: ["#"],
    stringQuotes: ["'", '"'],
    keyBeforeColon: true,
  },
  css: {
    id: "css",
    label: "CSS",
    booleans: new Set(["inherit", "initial", "unset", "auto", "none", "block"]),
    nulls: new Set(["none", "transparent"]),
    lineComments: [],
    blockComment: ["/*", "*/"],
    stringQuotes: ["'", '"'],
    keyBeforeColon: true,
  },
  markdown: {
    id: "markdown",
    label: "MD",
    lineComments: [],
    stringQuotes: [],
  },
  text: {
    id: "text",
    label: "text",
    lineComments: [],
    stringQuotes: [],
  },
};

/** Languages that need HTML/XML-specific tokenization. */
const HTML_LANGS = new Set(["html", "xml", "svg", "vue"]);

// ──────────────────────────────────────────────
// Generic line tokenizer
// ──────────────────────────────────────────────

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_-]/.test(c);
}

function tokenizeLine(line: string, cfg: LangConfig): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === " " || ch === "\t") {
      let ws = "";
      while (i < line.length && (line[i] === " " || line[i] === "\t")) {
        ws += line[i];
        i++;
      }
      tokens.push({ type: "text", value: ws });
      continue;
    }

    const lineComment = cfg.lineComments?.find((c) => line.startsWith(c, i));
    if (lineComment) {
      tokens.push({ type: "comment", value: line.slice(i) });
      break;
    }

    if (cfg.blockComment && line.startsWith(cfg.blockComment[0], i)) {
      let c = cfg.blockComment[0];
      i += cfg.blockComment[0].length;
      while (i < line.length && !line.startsWith(cfg.blockComment[1], i)) {
        c += line[i];
        i++;
      }
      if (line.startsWith(cfg.blockComment[1], i)) {
        c += cfg.blockComment[1];
        i += cfg.blockComment[1].length;
      }
      tokens.push({ type: "comment", value: c });
      continue;
    }

    if (cfg.stringQuotes?.includes(ch)) {
      const quote = ch;
      let s = quote;
      i++;
      while (i < line.length) {
        if (line[i] === "\\") {
          s += line[i] + (line[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          s += quote;
          i++;
          break;
        }
        s += line[i];
        i++;
      }
      // A quoted string immediately followed by `:` is a JSON/YAML key (quoted
      // keys), not a value — so give it the key colour like unquoted keys.
      let skip = i;
      while (skip < line.length && (line[skip] === " " || line[skip] === "\t")) skip++;
      tokens.push({
        type: cfg.keyBeforeColon === true && line[skip] === ":" ? "key" : "string",
        value: s,
      });
      continue;
    }

    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_-]/.test(line[i - 1] ?? "")) {
      let num = "";
      while (i < line.length && /[0-9A-Za-z._]/.test(line[i])) {
        num += line[i];
        i++;
      }
      tokens.push({ type: "number", value: num });
      continue;
    }

    if (isWordChar(ch)) {
      let w = "";
      while (i < line.length && isWordChar(line[i])) {
        w += line[i];
        i++;
      }
      let skip = i;
      while (skip < line.length && (line[skip] === " " || line[skip] === "\t")) skip++;
      const isKey = cfg.keyBeforeColon === true && line[skip] === ":";
      if (isKey) {
        tokens.push({ type: "key", value: w });
        continue;
      }
      if (cfg.booleans?.has(w)) {
        tokens.push({ type: "boolean", value: w });
        continue;
      }
      if (cfg.nulls?.has(w)) {
        tokens.push({ type: "null", value: w });
        continue;
      }
      if (cfg.keywords?.has(w)) {
        tokens.push({ type: "key", value: w });
        continue;
      }
      if (cfg.types?.has(w)) {
        tokens.push({ type: "type", value: w });
        continue;
      }
      tokens.push({ type: "text", value: w });
      continue;
    }

    const t: TokenType =
      ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "{" || ch === "}"
        ? "bracket"
        : "punctuation";
    tokens.push({ type: t, value: ch });
    i++;
  }

  for (let j = 1; j < tokens.length; j++) {
    if (tokens[j].type === "bracket" && tokens[j].value === "(" && tokens[j - 1].type === "text") {
      tokens[j - 1] = { type: "method", value: tokens[j - 1].value };
    }
  }

  return tokens;
}

// ──────────────────────────────────────────────
// HTML / XML tokenizer
// ──────────────────────────────────────────────

function tokenizeHtmlLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === "<") {
      tokens.push({ type: "bracket", value: "<" });
      i++;
      continue;
    }
    if (ch === ">") {
      tokens.push({ type: "bracket", value: ">" });
      i++;
      continue;
    }
    if (ch === "/" && line[i + 1] === ">") {
      tokens.push({ type: "punctuation", value: "/>" });
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let s = quote;
      i++;
      while (i < line.length && line[i] !== quote) {
        s += line[i];
        i++;
      }
      if (i < line.length) {
        s += quote;
        i++;
      }
      tokens.push({ type: "string", value: s });
      continue;
    }
    if (isWordChar(ch)) {
      let w = "";
      while (i < line.length && isWordChar(line[i])) {
        w += line[i];
        i++;
      }
      // A word immediately after `<` is a tag name; otherwise it's an attribute.
      const prev = tokens[tokens.length - 1];
      const prevValue = (prev?.type === "text" ? prev.value : prev?.value) ?? "";
      const isTag = prev?.type === "bracket" && prev.value === "<";
      tokens.push({ type: isTag ? "key" : "type", value: w });
      void prevValue;
      continue;
    }
    tokens.push({ type: "text", value: ch });
    i++;
  }

  return tokens;
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export interface SupportedLanguage {
  id: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "bash", label: "Bash" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "markdown", label: "Markdown" },
  { id: "text", label: "Plain text" },
];

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  jsx: "javascript",
  node: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  xml: "html",
  html: "html",
  svg: "html",
  vue: "html",
  scss: "css",
  less: "css",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  json: "json",
  jsonc: "json",
  golang: "go",
  go: "go",
  rs: "rust",
  rust: "rust",
  sql: "sql",
  psql: "sql",
  text: "text",
  txt: "text",
  plaintext: "text",
};

/** Normalise a user-supplied language tag to a canonical id, or null. */
export function normalizeLanguage(lang: string): string | null {
  const key = lang.trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] ?? null;
}

/** Human-friendly label for a language id. */
export function langLabel(id: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

function getLangConfig(id: string): LangConfig {
  return LANG_CONFIGS[id] ?? LANG_CONFIGS.text;
}

/** Highlight code as an HTML string of `hl-*` spans (lines joined by `\n`). */
export function highlight(code: string, langId: string): string {
  const id = ALIASES[langId.toLowerCase()] ?? langId.toLowerCase();
  if (HTML_LANGS.has(id)) {
    return code
      .split("\n")
      .map((line) => formatTokens(tokenizeHtmlLine(line), line))
      .join("\n");
  }
  const cfg = getLangConfig(id);
  return code
    .split("\n")
    .map((line) => formatTokens(tokenizeLine(line, cfg), line))
    .join("\n");
}

/** Ordered detection rules, most-specific language families first. */
const DETECTION_RULES: Array<{ id: string; test: (head: string) => boolean }> = [
  {
    id: "html",
    test: (h) =>
      /^\s*<!doctype\s+html/i.test(h) || (/<[a-z][\s\S]*>/i.test(h) && /<\/?[a-z]/.test(h)),
  },
  { id: "json", test: (h) => /^\s*\{[\s\n]*"[^"]+"\s*:/m.test(h) },
  {
    id: "yaml",
    test: (h) =>
      /^\s*-?\s*\w+\s*:\s/m.test(h) &&
      !/\b(function|const|let|var|import|export|def|class)\b/.test(h),
  },
  {
    id: "bash",
    test: (h) =>
      /^\s*(#!\/bin\/|.*\$\s*|export\s+\w+=|cd\s+\S+)/m.test(h) ||
      /^\s*\[[a-z0-9_]+\s*:\s*[^\]]+\]|\b(bind|script)\b/.test(h),
  },
  {
    id: "sql",
    test: (h) => /\b(select\s+[\s\S]+from|insert\s+into|update\s+\S+\s+set)\b/i.test(h),
  },
  { id: "rust", test: (h) => /\b(fn\s+\w+\s*\(|use\s+std::|^\s*pub\s+fn\b)/m.test(h) },
  { id: "go", test: (h) => /\b(package\s+main|func\s+\w+\s*\(|go\s+func)\b/m.test(h) },
  {
    id: "css",
    test: (h) => /\b(@media|^\s*[.#\w][^{}]*\{\s*$|^\s*[a-z-]+\s*:\s*[^;]+;\s*$)/m.test(h),
  },
];

/**
 * JavaScript, TypeScript and Python share a lot of surface syntax (`import`,
 * `export`, `for`, `if`, block-ish headers) and bare `import X` is valid in both
 * JS and Python, so a "first rule wins" detector mislists Python as JS/TS.
 * Instead we count language-specific signals and let the strongest family win.
 * JS/TS are kept together (TS is a superset of JS); which of the two leads is
 * decided by TypeScript-specific signals.
 */

interface Signal {
  re: RegExp;
  w: number;
}

function signalScore(text: string, signals: Signal[]): number {
  let score = 0;
  for (const { re, w } of signals) {
    if (re.test(text)) score += w;
  }
  return score;
}

/** Python-specific signals (no plain `if`/`return` — those are shared). */
const PY_SIGNALS: Signal[] = [
  { re: /\bdef\s+\w+\s*\(/, w: 4 },
  { re: /\bclass\s+\w+\s*:/, w: 4 },
  { re: /if\s+__name__/, w: 4 },
  { re: /^\s*from\s+\S+\s+import\b/m, w: 4 },
  { re: /^\s*import\s+\w+(?!\s+from\b)/m, w: 3 },
  { re: /\bprint\s*\(/, w: 3 },
  { re: /\belif\b/, w: 3 },
  { re: /\bexcept\b/, w: 3 },
  { re: /^\s*for\s+\w+\s+in\s+/m, w: 3 },
  { re: /:\s*\n\s{2,}\S/m, w: 3 },
  { re: /^\s*with\s+\w+/m, w: 2 },
  { re: /\blambda\b/, w: 2 },
  { re: /\bself\b/, w: 2 },
  { re: /\brange\s*\(/, w: 2 },
  { re: /\blen\s*\(/, w: 2 },
  { re: /\byield\b/, w: 2 },
  { re: /\braise\s/, w: 2 },
];

/** JavaScript signals — ESM import requires `from`, so a bare `import os` (Python) does not match. */
const JS_SIGNALS: Signal[] = [
  { re: /\bconst\s+\w+\s*=/, w: 4 },
  { re: /\blet\s+\w+\s*=/, w: 4 },
  { re: /\bvar\s+\w+\s*=/, w: 3 },
  { re: /\bfunction\s+\w*\s*\(/, w: 4 },
  { re: /=>/, w: 3 },
  { re: /\bconsole\.log/, w: 3 },
  { re: /\bexport\s+(default\s+)?(const|let|var|function|class)\b/, w: 3 },
  { re: /^\s*import\s+[{\w][^;]*?from\s+['"]/m, w: 3 },
  { re: /\brequire\s*\(/, w: 3 },
  { re: /\bmodule\.exports/, w: 3 },
  { re: /\bnew\s+\w+\s*\(/, w: 2 },
  { re: /\.forEach\s*\(/, w: 2 },
];

/** TypeScript-specific signals that promote TS above JS. */
const TS_SIGNALS: Signal[] = [
  { re: /\binterface\s+\w+/, w: 4 },
  { re: /\btype\s+\w+\s*=/, w: 4 },
  { re: /\b(enum|namespace|declare|abstract|implements)\s+\w+/, w: 3 },
  { re: /\w+\s*:\s*(string|number|boolean|any|void|unknown)\b/, w: 3 },
];

/** Families that are unambiguous on their own and short-circuit JS/TS/Python. */
const DEFINITIVE = new Set(["html", "json", "yaml", "bash", "sql", "rust", "go", "css"]);

/** Return the language ids whose detector matched, most-specific first. */
export function detectLanguageCandidates(code: string): string[] {
  const head = code.trim().slice(0, 2000);
  if (!head) return ["text"];
  const ids: string[] = [];
  for (const rule of DETECTION_RULES) {
    if (rule.test(head)) ids.push(rule.id);
  }
  // An unambiguous family (a shebang script, JSON, SQL, …) is definitive; don't
  // re-interpret it as JS/TS/Python (e.g. a bash heredoc containing Python).
  if (ids.some((id) => DEFINITIVE.has(id))) {
    const unique = [...new Set(ids)];
    return unique.length ? unique : ["text"];
  }

  const py = signalScore(head, PY_SIGNALS);
  const js = signalScore(head, JS_SIGNALS);
  const ts = signalScore(head, TS_SIGNALS);

  if (py > js && py > ts) {
    ids.unshift("python");
  } else if (js > 0 || ts > 0) {
    // JS/TS are reported together; TS leads when its own signals are strongest.
    if (ts > js) ids.unshift("typescript", "javascript");
    else ids.unshift("javascript", "typescript");
  }

  const unique = [...new Set(ids)];
  return unique.length ? unique : ["text"];
}

/** Best-effort detect the single most likely language of a code snippet. */
export function detectLanguage(code: string): string {
  return detectLanguageCandidates(code)[0] ?? "text";
}
