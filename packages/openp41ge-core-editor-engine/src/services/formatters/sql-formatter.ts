/**
 * Basic SQL formatter.
 *
 * - Uppercases SQL keywords (skipping quoted strings)
 * - Strips trailing whitespace
 * - Ensures final newline
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import { stripTrailingWhitespace, ensureFinalNewline, normalizeLineEndings } from "./common";

const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "in",
  "is",
  "null",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "delete",
  "create",
  "table",
  "alter",
  "drop",
  "index",
  "view",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "on",
  "order",
  "by",
  "group",
  "having",
  "limit",
  "offset",
  "as",
  "distinct",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "between",
  "like",
  "exists",
  "union",
  "all",
  "any",
  "case",
  "when",
  "then",
  "else",
  "end",
  "begin",
  "commit",
  "rollback",
  "transaction",
  "primary",
  "key",
  "foreign",
  "references",
  "constraint",
  "default",
  "check",
  "unique",
  "auto_increment",
  "serial",
  "if",
  "while",
  "for",
  "declare",
  "return",
  "function",
  "procedure",
  "trigger",
  "event",
  "database",
  "schema",
  "use",
  "show",
  "describe",
  "explain",
]);

/** Uppercase SQL keywords outside quoted strings. */
function uppercaseKeywordsOutsideQuotes(line: string): string {
  const result: string[] = [];
  const chars = [...line];
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < chars.length) {
    const ch = chars[i];

    // Toggle string state
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result.push(ch);
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      result.push(ch);
      i++;
      continue;
    }

    if (inSingle || inDouble) {
      // Inside string — emit as-is
      result.push(ch);
      i++;
      continue;
    }

    // Outside string — check for keyword
    const wordMatch = line.slice(i).match(/^([a-zA-Z_]\w*)/);
    if (wordMatch) {
      const word = wordMatch[1];
      if (SQL_KEYWORDS.has(word.toLowerCase())) {
        result.push(word.toUpperCase());
      } else {
        result.push(word);
      }
      i += word.length;
    } else {
      result.push(ch);
      i++;
    }
  }

  return result.join("");
}

export function createSqlFormatter(): IFormatter {
  return {
    name: "SQL Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);

      const lines = result.split("\n");
      const out: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) {
          out.push("");
          continue;
        }
        out.push(uppercaseKeywordsOutsideQuotes(trimmed));
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
