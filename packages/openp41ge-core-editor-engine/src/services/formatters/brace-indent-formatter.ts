/**
 * Brace-based indentation formatter for C-family languages.
 *
 * Normalises indentation for languages with brace-delimited blocks:
 * JavaScript, TypeScript, Java, C, C++, Rust, Go, PHP, Ruby, etc.
 *
 * Does NOT understand syntax — it operates purely on brace depth.
 * This is intentionally simple: it fixes indentation without needing
 * a parser, which means it will never be perfect, but it works for
 * well-formed code and is fast.
 *
 * Limitations:
 * - Strings containing braces will throw off indentation
 * - Comments containing braces will throw off indentation
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import {
  stripTrailingWhitespace,
  ensureFinalNewline,
  normalizeLineEndings,
  usesTabs,
} from "./common";

export function createBraceIndentFormatter(name: string, indentSize = 2): IFormatter {
  return {
    name,
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);
      const tabIndent = usesTabs(result);
      const indent = tabIndent ? "\t" : " ".repeat(indentSize);

      const lines = result.split("\n");
      const out: string[] = [];
      let depth = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        // Decrement depth for lines starting with closing brace
        if (/^[}\]\)]/.test(trimmed) && depth > 0) {
          depth--;
        }

        const indented = indent.repeat(depth) + trimmed;
        out.push(indented);

        // Increment depth for lines ending with opening brace
        if (/[{[(]\s*$/.test(trimmed)) {
          depth++;
        }
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
