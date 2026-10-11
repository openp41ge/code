/**
 * Basic HTML/XML tag-based indentation formatter.
 *
 * Indents based on opening/closing tags. Self-closing tags
 * (<br>, <img>, <hr>, <input>, <meta>, <link>) and void
 * elements do not affect indentation depth.
 *
 * Intentionally simple: no parser, just regex-based tag matching.
 * Works well for well-formed HTML. May mis-handle:
 * - Tags inside comments or strings
 * - Template expressions containing tags
 * - Pre-formatted elements (<pre>, <code>, <textarea>)
 * - Inline SVG or MathML
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import {
  stripTrailingWhitespace,
  ensureFinalNewline,
  normalizeLineEndings,
  usesTabs,
} from "./common";

const SELF_CLOSING = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

export function createHtmlFormatter(): IFormatter {
  return {
    name: "HTML Indent",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);
      const tabIndent = usesTabs(result);
      const indent = tabIndent ? "\t" : "  ";

      const lines = result.split("\n");
      const out: string[] = [];
      let depth = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) {
          out.push("");
          continue;
        }

        // Check if this line starts with a closing tag
        const closesBefore = /^<\//.test(trimmed);
        if (closesBefore && depth > 0) {
          depth--;
        }

        const lineDepth = Math.max(0, depth);
        const indented = indent.repeat(lineDepth) + trimmed;
        out.push(indented);

        // Count opening tags that aren't self-closing
        // Only increase depth if tag opens but doesn't close on same line
        const openMatch = trimmed.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*>/);
        if (openMatch) {
          const tagName = openMatch[1];
          if (!SELF_CLOSING.test(tagName)) {
            // Check if the closing tag is on the same line
            const closeTag = new RegExp(`</${tagName}\\s*>`, "i");
            if (!closeTag.test(trimmed)) {
              depth++;
            }
          }
        }
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
