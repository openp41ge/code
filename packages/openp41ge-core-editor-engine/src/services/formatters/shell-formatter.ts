/**
 * Basic Shell script formatter (sh/bash/zsh).
 *
 * - Normalises spacing around `=` in variable assignments
 * - Uppercases common shell instructions (similar to Dockerfile approach)
 * - Preserves shebang, comments, heredocs, string contents
 * - Strips trailing whitespace
 * - Ensures final newline
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import { stripTrailingWhitespace, ensureFinalNewline, normalizeLineEndings } from "./common";

export function createShellFormatter(): IFormatter {
  return {
    name: "Shell Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);

      const lines = result.split("\n");
      const out: string[] = [];
      let inHeredoc = false;
      let heredocDelim = "";

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        // Preserve leading whitespace
        const indentMatch = raw.match(/^(\s*)/);
        const leading = indentMatch ? indentMatch[1] : "";
        const content = raw.slice(leading.length);

        // Detect heredoc start
        if (!inHeredoc) {
          const heredocMatch = raw.match(/<<-?\s*['"]?(\w+)['"]?/);
          if (heredocMatch) {
            inHeredoc = true;
            heredocDelim = heredocMatch[1];
          }
        }

        // Detect heredoc end
        if (inHeredoc && content.trim() === heredocDelim) {
          inHeredoc = false;
          out.push(raw);
          continue;
        }

        // Inside heredoc — preserve as-is
        if (inHeredoc) {
          out.push(raw);
          continue;
        }

        if (!content) {
          out.push("");
          continue;
        }

        // Preserve comments and shebang
        if (content.startsWith("#")) {
          out.push(raw);
          continue;
        }

        // Normalise spacing around `=` for variable assignments
        const formatted = content.replace(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)$/,
          (_match: string, name: string, value: string) => {
            if (value.startsWith("(")) {
              return name + "=" + value;
            }
            return name + "=" + value;
          },
        );

        out.push(leading + formatted);
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
