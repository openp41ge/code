/**
 * command-process.ts — runs a scoped terminal's binary (`CommandProcess`):
 * `spawn` with the argument list (no shell), stdin closed, stdout and stderr
 * read in the order they come, output past the cap dropped, and a timeout
 * that stops the process (SIGTERM, then SIGKILL).
 */

import { spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import type {
  CommandProcess,
  CommandProcessOptions,
  CommandProcessResult,
} from "./command-service.js";

/** How long a stopped process gets before it is killed. */
const KILL_AFTER_MS = 2000;

export class NodeCommandProcess implements CommandProcess {
  run(
    file: string,
    args: readonly string[],
    opts: CommandProcessOptions,
  ): Promise<CommandProcessResult> {
    return new Promise((resolve) => {
      let output = "";
      let kept = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;
      const decoder = new StringDecoder("utf8");
      const finish = (result: Omit<CommandProcessResult, "output" | "truncated">): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const rest = decoder.end();
        if (rest) {
          output += rest;
          opts.onOutput(rest);
        }
        resolve({ ...result, output, truncated });
      };

      const child = spawn(file, [...args], {
        cwd: opts.cwd,
        env: opts.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const take = (data: Buffer): void => {
        if (truncated) return;
        const room = opts.maxOutputBytes - kept;
        const piece = data.length > room ? data.subarray(0, room) : data;
        if (data.length > room) truncated = true;
        kept += piece.length;
        const text = decoder.write(piece);
        if (text) {
          output += text;
          opts.onOutput(text);
        }
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS).unref();
      }, opts.timeoutMs);

      child.on("error", (err: NodeJS.ErrnoException) => {
        finish({ exitCode: null, timedOut: false, notFound: err.code === "ENOENT" });
      });
      child.on("close", (code) => {
        finish({ exitCode: timedOut ? null : code, timedOut, notFound: false });
      });
    });
  }
}
