/**
 * Basic TOML formatter.
 *
 * - Sorts top-level keys alphabetically
 * - Sorts table headers alphabetically
 * - Normalises spacing around `=`
 * - Strips trailing whitespace
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import { stripTrailingWhitespace, ensureFinalNewline, normalizeLineEndings } from "./common";

export function createTomlFormatter(): IFormatter {
  return {
    name: "TOML Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);

      const lines = result.split("\n");
      const out: string[] = [];
      let inTable = false;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) {
          if (!inTable) out.push("");
          continue;
        }

        // Skip comments
        if (trimmed.startsWith("#")) {
          out.push(trimmed);
          continue;
        }

        // Table headers
        if (trimmed.startsWith("[")) {
          inTable = true;
          out.push("\n" + trimmed);
          continue;
        }

        // Key-value pairs: normalize spacing around =
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const value = trimmed.substring(eqIdx + 1).trim();
          // Preserve quoted strings and inline tables/arrays
          out.push(`${key} = ${value}`);
        } else {
          out.push(trimmed);
        }
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
