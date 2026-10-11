/**
 * Basic HCL / Terraform formatter.
 *
 * HCL (HashiCorp Configuration Language) is used by Terraform (.tf, .tfvars)
 * as well as Consul, Vault, and Nomad (.hcl).
 *
 * - Brace-depth indentation (2 spaces) for blocks
 * - Normalises `=` spacing in attribute assignments
 * - Preserves comments (hash, double-slash, and block-comment styles)
 * - Preserves heredoc (<<) content
 * - Strips trailing whitespace
 * - Ensures final newline
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import {
  stripTrailingWhitespace,
  ensureFinalNewline,
  normalizeLineEndings,
  usesTabs,
} from "./common";

const HCL_INDENT_SIZE = 2;

export function createHclFormatter(): IFormatter {
  return {
    name: "HCL Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);
      const tabIndent = usesTabs(result);
      const indent = tabIndent ? "\t" : " ".repeat(HCL_INDENT_SIZE);

      const lines = result.split("\n");
      const out: string[] = [];
      let depth = 0;
      let inHeredoc = false;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

        const trimmed = raw.trim();

        // Heredoc handling
        if (inHeredoc) {
          // Check for end-of-heredoc marker (any line that matches the delimiter)
          if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
            inHeredoc = false;
            out.push(raw);
            continue;
          }
          out.push(raw);
          continue;
        }

        // Detect heredoc start (<< or <<-)
        if (/<<-?\s*([a-zA-Z_]\w*)/.test(trimmed)) {
          inHeredoc = true;
          out.push(raw);
          continue;
        }

        if (!trimmed) {
          out.push("");
          continue;
        }

        // Preserve comment lines as-is
        if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
          out.push(raw);
          continue;
        }

        // Decrement depth for lines starting with closing brace
        const closesBefore = /^[}\]\)]/.test(trimmed);
        if (closesBefore && depth > 0) {
          depth--;
        }

        const lineDepth = Math.max(0, depth);
        const indented = indent.repeat(lineDepth);
        let formatted = trimmed;

        // Normalise spacing around `=` in attribute assignments
        // Matches: key = value → key = value (single space)
        // But NOT inside interpolation ${} or comparison operators
        formatted = formatted.replace(
          /([a-zA-Z_]\w*)\s*=\s*(.*)$/,
          (_match: string, key: string, value: string) => {
            // Don't touch heredoc-style assignments
            if (value.startsWith("<<")) return _match;
            return key + " = " + value;
          },
        );

        // Normalise block labels: ensure space after block type
        // e.g. `resource"aws_instance""web"{` → `resource "aws_instance" "web" {`
        formatted = formatted.replace(
          /^([a-zA-Z]\w*)"([^"]*)"\s*"([^"]*)"\s*\{/,
          (_match: string, blockType: string, label1: string, label2: string) => {
            return blockType + ' "' + label1 + '" "' + label2 + '" {';
          },
        );

        out.push(indented + formatted);

        // Increment depth for lines ending with opening brace
        if (/{$/m.test(formatted)) {
          depth++;
        }
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
