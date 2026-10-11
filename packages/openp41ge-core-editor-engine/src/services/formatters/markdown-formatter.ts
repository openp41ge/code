/**
 * Basic Markdown formatter.
 *
 * Normalises common Markdown constructs without a full parser:
 * - Heading marker spacing: `#Title` → `# Title`
 * - List marker spacing: `*item` → `* item`, `-item` → `- item`
 * - Ordered list spacing: `1.item` → `1. item`
 * - Preserves fenced code blocks and inline code
 * - Preserves blockquotes, horizontal rules, tables
 * - Strips trailing whitespace
 * - Ensures final newline
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import { stripTrailingWhitespace, ensureFinalNewline, normalizeLineEndings } from "./common";

export function createMarkdownFormatter(): IFormatter {
  return {
    name: "Markdown Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);

      const lines = result.split("\n");
      const out: string[] = [];
      let inFence = false;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        // Preserve leading whitespace
        const indentMatch = raw.match(/^(\s*)/);
        const leading = indentMatch ? indentMatch[1] : "";
        const trimmed = raw.trim();

        // Detect fenced code blocks (``` or ~~~)
        const fenceMatch = trimmed.match(/^(```+|~~~+)/);
        if (fenceMatch) {
          inFence = !inFence;
          out.push(raw);
          continue;
        }

        // Inside code fences — preserve as-is
        if (inFence) {
          out.push(raw);
          continue;
        }

        if (!trimmed) {
          out.push("");
          continue;
        }

        let formatted = trimmed;

        // Preserve horizontal rules
        if (/^-{3,}$/.test(formatted) || /^\*{3,}$/.test(formatted) || /^_{3,}$/.test(formatted)) {
          out.push(formatted);
          continue;
        }

        // Preserve blockquote markers (don't re-indent)
        if (/^>/.test(formatted)) {
          out.push(formatted);
          continue;
        }

        // Normalise heading spacing: ensure exactly one space after # markers
        // Matches lines starting with one or more # followed by optional space then text
        formatted = formatted.replace(
          /^(#+)(\s*)(.*?)$/,
          (_, hashes: string, spacing: string, text: string) => {
            if (!text) return hashes; // `#` alone on a line
            return hashes + " " + text;
          },
        );

        // Normalise unordered list marker spacing: `*item` → `* item`, `-item` → `- item`, `+item` → `+ item`
        formatted = formatted.replace(
          /^(\s*)([*\-+])(\S.*)$/,
          (_, indent: string, marker: string, rest: string) => {
            return indent + marker + " " + rest;
          },
        );

        // Normalise ordered list marker spacing: `1.item` → `1. item`
        formatted = formatted.replace(
          /^(\s*)(\d+)\.(\S.*)$/,
          (_, indent: string, num: string, rest: string) => {
            return indent + num + ". " + rest;
          },
        );

        out.push(leading + formatted);
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
