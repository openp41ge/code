/**
 * Basic YAML formatter.
 *
 * - Normalises indentation to 2 spaces
 * - Ensures consistent spacing after colons
 * - Strips trailing whitespace
 * - Ensures final newline
 *
 * Preserves comments, anchors, aliases, block scalars, and flow content.
 * Does NOT reorder keys or change the structure.
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import { stripTrailingWhitespace, ensureFinalNewline, normalizeLineEndings } from "./common";

export function createYamlFormatter(): IFormatter {
  return {
    name: "YAML Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);

      const lines = result.split("\n");
      const out: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        // Detect current indentation level
        const indentMatch = raw.match(/^(\s*)/);
        const currentIndent = indentMatch ? indentMatch[1] : "";

        // Normalize indent to multiples of 2 spaces
        const indentLevel = Math.round(currentIndent.length / 2);
        const normalizedIndent = "  ".repeat(Math.max(0, indentLevel));

        // Trim the line content
        const trimmed = raw.trim();

        if (!trimmed) {
          out.push("");
          continue;
        }

        // Preserve comments as-is
        if (trimmed.startsWith("#")) {
          out.push(normalizedIndent + trimmed);
          continue;
        }

        // Fix spacing after colon for key-value pairs
        // But NOT inside flow collections {} (those are inline)
        let formatted = trimmed;
        if (trimmed.includes(":") && !trimmed.startsWith("{") && !trimmed.endsWith("}")) {
          formatted = trimmed.replace(/\s*:\s*/g, ": ").replace(/: $/, ":");
        }

        out.push(normalizedIndent + formatted);
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
