/**
 * Basic Dockerfile formatter.
 *
 * - Uppercases Dockerfile instructions
 * - Normalises spacing after instructions
 * - Strips trailing whitespace
 */

import type { IFormatter } from "../../interfaces/formatter-registry";
import { stripTrailingWhitespace, ensureFinalNewline, normalizeLineEndings } from "./common";

const DOCKER_INSTRUCTIONS = new Set([
  "from",
  "as",
  "maintainer",
  "run",
  "cmd",
  "entrypoint",
  "label",
  "expose",
  "env",
  "add",
  "copy",
  "workdir",
  "user",
  "volume",
  "arg",
  "onbuild",
  "stopsignal",
  "healthcheck",
  "shell",
  "comment",
]);

export function createDockerfileFormatter(): IFormatter {
  return {
    name: "Dockerfile Format",
    format(content: string): string {
      let result = normalizeLineEndings(content);
      result = stripTrailingWhitespace(result);

      const lines = result.split("\n");
      const out: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) {
          out.push("");
          continue;
        }

        // Check if line starts with a Docker instruction
        const instrMatch = trimmed.match(/^([a-zA-Z]+)\s+(.*)/);
        if (instrMatch) {
          const instr = instrMatch[1];
          const rest = instrMatch[2];
          if (DOCKER_INSTRUCTIONS.has(instr.toLowerCase())) {
            out.push(instr.toUpperCase() + " " + rest);
          } else {
            out.push(trimmed);
          }
        } else {
          // Continuation line or comment
          out.push(trimmed);
        }
      }

      return ensureFinalNewline(out.join("\n"));
    },
  };
}
