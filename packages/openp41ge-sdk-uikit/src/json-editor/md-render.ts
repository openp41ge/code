/**
 * md-render — render Markdown descriptions to HTML for the JSON editor's key
 * tooltip.
 *
 * Minimal, dependency-free renderer supporting the subset used by schema
 * descriptions: headings, paragraphs, bold/italic, inline code, links, bullet
 * and numbered lists, blockquotes, horizontal rules, and **fenced code blocks**
 * (```` ```lang ````). Fenced code is syntax-highlighted: `json` reuses the
 * editor's own JSON tokenizer so the colours match the file editor; other
 * languages are rendered as plain monospace text.
 *
 * The source text is trusted (it comes from the bundled schema / bundled
 * markdown files), but text outside recognised syntax is HTML-escaped so only
 * tags we emit can ever appear.
 */

import { highlightJsonToHtml } from "./json-highlight";

/** Escape `&`, `<`, `>` so source text can't inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markdown → HTML for a single (already HTML-escaped) line of text. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Highlight a fenced code block's body for a given language tag. Returns
 * HTML-escaped, span-wrapped code (already safe to inject).
 */
export function highlightCodeBlock(code: string, lang: string): string {
  switch (lang.trim().toLowerCase()) {
    case "json":
      return highlightJsonToHtml(code);
    default:
      return escapeHtml(code);
  }
}

/** Whether a description string is a local Markdown file reference (a relative
 *  `*.md` path like `descriptions/thinking.md` / `./x.md` / `../x.md`). Such a
 *  string is resolved through the editor's `resolveResource` hook instead of
 *  being rendered verbatim. */
export function isMarkdownFileRef(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  // A relative `*.md` path: no leading slash, optional `./` | `../` prefix,
  // then slash-separated name segments. Absolute paths are rejected.
  return /^(?!\/)(?:(?:\.{1,2})\/)?[\w\-]+(?:\/[\w\-]+)*\.md$/i.test(t);
}

/** Render a Markdown document to an HTML string for the tooltip. */
export function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBody: string[] = [];

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };
  const flushFence = (): void => {
    if (fenceBody.length) {
      const body = fenceBody.join("\n");
      const lang = fenceLang;
      out.push(
        `<pre class="je-md-code" data-lang="${escapeHtml(lang)}"><code>${highlightCodeBlock(body, lang)}</code></pre>`,
      );
    }
    fenceBody = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Fenced code block ──────────────────────────────────────────────
    const fenceOpen = trimmed.match(/^```(\S*)\s*$/);
    if (fenceOpen) {
      if (!inFence) {
        closeList();
        flushPara();
        inFence = true;
        fenceLang = fenceOpen[1];
        fenceBody = [];
      } else {
        flushFence();
        inFence = false;
        fenceLang = "";
      }
      continue;
    }
    if (inFence) {
      fenceBody.push(line);
      continue;
    }

    if (!trimmed) {
      closeList();
      flushPara();
      continue;
    }

    // ── Heading ────────────────────────────────────────────────────────
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      flushPara();
      const level = Math.min(heading[1].length, 4);
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    // ── Horizontal rule ────────────────────────────────────────────────
    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      closeList();
      flushPara();
      out.push(`<hr>`);
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────
    if (trimmed.startsWith(">")) {
      closeList();
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      out.push(`<blockquote>${inline(escapeHtml(quote.join(" ")))}</blockquote>`);
      continue;
    }

    // ── List ───────────────────────────────────────────────────────────
    const list = line.match(/^(?:(\d+)\.\s+|[-*]\s+)(.*)$/);
    if (list) {
      flushPara();
      const type: "ul" | "ol" = list[1] ? "ol" : "ul";
      if (listType !== type) {
        closeList();
        out.push(`<${type}>`);
        listType = type;
      }
      out.push(`<li>${inline(escapeHtml(list[2]))}</li>`);
      continue;
    }

    // ── Paragraph text ─────────────────────────────────────────────────
    para.push(trimmed);
  }

  if (inFence) flushFence();
  flushPara();
  closeList();
  return out.join("");
}
