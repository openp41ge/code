/**
 * Basic CSS formatter.
 *
 * - Places opening brace on the same line as selector
 * - One property per line
 * - Consistent indentation
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import {
  stripTrailingWhitespace,
  ensureFinalNewline,
  normalizeLineEndings,
  usesTabs,
} from "./common";

export function createCssFormatter(): IFormatter {
  return {
    name: "CSS Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);
      const tabIndent = usesTabs(result);
      const indent = tabIndent ? "\t" : "  ";

      // Normalise braces: space before opening, newline after
      result = result.replace(/\s*\{\s*/g, " {\n");
      result = result.replace(/\s*\}\s*/g, "\n}\n");

      const lines = result.split("\n");
      const out: string[] = [];
      let depth = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) continue;

        if (trimmed === "}") {
          depth = Math.max(0, depth - 1);
        }

        const lineDepth = Math.max(0, depth);
        const indented = indent.repeat(lineDepth) + trimmed;
        out.push(indented);

        if (trimmed.endsWith("{")) {
          depth++;
        }
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
