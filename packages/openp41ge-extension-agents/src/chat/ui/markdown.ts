/**
 * Lightweight markdown → HTML renderer for chat responses.
 *
 * Covers the common constructs a coding agent emits: headings, fenced + inline
 * code, paragraphs, unordered/ordered lists, blockquotes, GFM pipe tables,
 * horizontal rules, bold/italic/strikethrough, links and images.
 *
 * All text is HTML-escaped and only a fixed set of tags is emitted, so the
 * LLM's output cannot inject arbitrary HTML (no raw `<script>` etc.).
 */

import { detectLanguage, highlight, normalizeLanguage } from "./syntax-highlight.js";

/** Escape text for embedding as HTML text content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape text for embedding inside a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Inline markdown → HTML for a single line/paragraph. Code spans, links and
 *  images are carved out as placeholders first so their contents are not
 *  re-processed, then emphasis is applied to the (escaped) remaining text. */
function renderInline(text: string): string {
  const codeSpans: string[] = [];
  const links: Array<{ label: string; url: string }> = [];
  const images: Array<{ alt: string; url: string }> = [];

  let s = text
    // Carve out inline code so emphasis markers inside it are ignored.
    .replace(/`([^`]+)`/g, (_m, code: string) => {
      codeSpans.push(code);
      return `\u0000${codeSpans.length - 1}\u0000`;
    })
    // Carve out images first so their `[...](...)` isn't treated as a link.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt: string, url: string) => {
      images.push({ alt, url });
      return `\u0002${images.length - 1}\u0002`;
    })
    // Carve out links.
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, label: string, url: string) => {
      links.push({ label, url });
      return `\u0001${links.length - 1}\u0001`;
    });

  // Escape everything that remains so the LLM's output cannot inject HTML.
  s = escapeHtml(s);

  // Bold / italic / strikethrough.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^a-zA-Z0-9_])_([^_]+)_(?![a-zA-Z0-9_])/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Restore images, links, then code (so code placeholders inside link labels
  // are resolved last). img/URL goes through escapeAttr once, from the raw url.
  s = s.replace(/\u0002(\d+)\u0002/g, (_m, i) => {
    const { alt, url } = images[Number(i)];
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />`;
  });
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => {
    const { label, url } = links[Number(i)];
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  });
  s = s.replace(
    /\u0000(\d+)\u0000/g,
    (_m, i) => `<code>${escapeHtml(codeSpans[Number(i)])}</code>`,
  );
  return s;
}

/** A parsed block: either a raw HTML string or a code block to be wrapped. */
type Block = { kind: "html"; value: string } | { kind: "code"; value: string; language: string };

/** Options for rendering markdown (in particular per-code-block language overrides). */
export interface MarkdownRenderOptions {
  /** Language override keyed by code-block index (0-based, in order of appearance). */
  codeLanguages?: Record<number, string>;
  /** Message id stamped on each code block so the UI can route language clicks. */
  msgId?: string;
}

/** A code block segment, rendered interactively by the UI. */
export interface CodeBlockSegment {
  type: "code";
  code: string;
  language: string;
  inferred: boolean;
  /** 0-based index of the block within its message. */
  index: number;
  msgId?: string;
}

/** A plain HTML segment (headings, paragraphs, lists, tables, …). */
export interface HtmlSegment {
  type: "html";
  html: string;
}

export type MarkdownSegment = HtmlSegment | CodeBlockSegment;

/** True when a line is a GFM table delimiter row (e.g. `| --- | :--: | ---: |`). */
function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

/** Split a pipe-table row into its trimmed cell values (strips outer pipes). */
function parseTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Try to render a table starting at `start` (header + delimiter + body rows).
 *  Returns the HTML and the index of the first line after the table, or null
 *  if the lines at `start` are not a table. */
function tryRenderTable(lines: string[], start: number): { html: string; next: number } | null {
  const headerLine = lines[start];
  if (!headerLine.includes("|")) return null;
  const delimLine = lines[start + 1];
  if (start + 1 >= lines.length || !isDelimiterRow(delimLine)) return null;

  const header = parseTableRow(headerLine);
  const aligns = parseTableRow(delimLine).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    if (cell.startsWith(":")) return "left";
    return "left";
  });

  const body: string[][] = [];
  let j = start + 2;
  while (j < lines.length) {
    const line = lines[j];
    if (line.trim() === "" || !line.includes("|")) break;
    body.push(parseTableRow(line));
    j++;
  }

  const cell = (row: string[], idx: number, tag: "th" | "td"): string => {
    const text = renderInline(row[idx] ?? "");
    const align = aligns[idx];
    const style = align && align !== "left" ? ` style="text-align:${align}"` : "";
    return `<${tag}${style}>${text}</${tag}>`;
  };

  // Wrap the table in a relative container so its internal dividers can be
  // themed by the host (the shared hover/selection styling).
  let html = '<div class="msg-table-wrap">';
  html += "<table><thead><tr>";
  html += header.map((_, idx) => cell(header, idx, "th")).join("");
  html += "</tr></thead><tbody>";
  html += body
    .map((row) => `<tr>${header.map((_, idx) => cell(row, idx, "td")).join("")}</tr>`)
    .join("");
  html += "</tbody></table>";
  html += "</div>";

  return { html, next: j };
}

/** Split markdown into top-level blocks and render them. */
function renderBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ kind: "code", value: buf.join("\n"), language });
      continue;
    }

    // Blank line → paragraph break.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "html", value: "<hr />" });
      i++;
      continue;
    }

    // Table (a header row immediately followed by a delimiter row).
    if (i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const table = tryRenderTable(lines, i);
      if (table) {
        blocks.push({ kind: "html", value: table.html });
        i = table.next;
        continue;
      }
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push({ kind: "html", value: `<h${level}>${renderInline(heading[2])}</h${level}>` });
      i++;
      continue;
    }

    // Blockquote (consecutive `>` lines).
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({
        kind: "html",
        value: `<blockquote>${renderInline(buf.join(" "))}</blockquote>`,
      });
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`);
        i++;
      }
      blocks.push({ kind: "html", value: `<ul>${items.join("")}</ul>` });
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      blocks.push({ kind: "html", value: `<ol>${items.join("")}</ol>` });
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines.
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) {
      blocks.push({ kind: "html", value: `<p>${renderInline(buf.join(" "))}</p>` });
    }
  }

  return blocks;
}

/** Resolve the effective language for a fenced block, honoring any override. */
function resolveCodeLanguage(
  code: string,
  explicitLang: string,
  overrideLang: string | undefined,
): { language: string; inferred: boolean } {
  if (overrideLang) return { language: overrideLang, inferred: false };
  if (explicitLang.trim()) {
    const normalized = normalizeLanguage(explicitLang);
    if (normalized) return { language: normalized, inferred: false };
  }
  return { language: detectLanguage(code), inferred: true };
}

/** Split markdown into renderable segments (plain HTML + interactive code blocks). */
export function renderMarkdownSegments(
  md: string,
  options?: MarkdownRenderOptions,
): MarkdownSegment[] {
  if (!md) return [];
  const codeLanguages = options?.codeLanguages ?? {};
  let codeIndex = 0;
  return renderBlocks(md).map((b): MarkdownSegment => {
    if (b.kind === "html") return { type: "html", html: b.value };
    const index = codeIndex++;
    const { language, inferred } = resolveCodeLanguage(b.value, b.language, codeLanguages[index]);
    return { type: "code", code: b.value, language, inferred, index, msgId: options?.msgId };
  });
}

/** Render markdown into a static HTML string (code blocks render as plain pre). */
export function renderMarkdown(md: string, options?: MarkdownRenderOptions): string {
  return renderMarkdownSegments(md, options)
    .map((s) =>
      s.type === "html" ? s.html : `<pre><code>${highlight(s.code, s.language)}</code></pre>`,
    )
    .join("");
}
