/**
 * tools/run-command.ts — `run_command`: run a binary an extension defines
 * (the platform's scoped terminal, `ctx.commands`) with an argument list, in
 * the worktree of a branch of a connected repository. There is no shell: the
 * arguments are passed as they are. What may run is the binary's allow /
 * deny rules (named in the system prompt); anything else is refused in-band.
 * The answer is what the command printed and how it ended; the run is named
 * so its tool call opens it in a terminal.
 */

import type { AgentTool, AgentToolRegistry } from "./types.js";

export const RUN_COMMAND_TOOL_NAME = "run_command";

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((a) => typeof a === "string");

export const RUN_COMMAND_TOOL: AgentTool = {
  name: RUN_COMMAND_TOOL_NAME,
  description:
    "Run a command-line binary (one the system prompt lists) with an argument list in a worktree of a connected repository, and get what it printed. There is no shell: no pipes, redirects, globs or variables — each argument is passed as it is. Nothing can be typed in and editors are off, so give what a command would ask for on the command line (e.g. `git commit -m <message>`, or `--no-edit` to keep git's message). Only command lines the binary's rules allow run; others are refused.",
  parameters: {
    type: "object",
    properties: {
      binary: { type: "string", description: "The binary, e.g. `git`." },
      args: {
        type: "array",
        items: { type: "string" },
        description: 'Its arguments, one per item, e.g. ["log", "--oneline", "-5"].',
      },
      repo: { type: "string", description: "The repository's name, e.g. `github.com/org/repo`." },
      branch: { type: "string", description: "The branch whose worktree it runs in." },
    },
    required: ["binary", "args", "repo", "branch"],
  },
  async execute(args, ctx) {
    const { binary, repo, branch } = args;
    if (typeof binary !== "string" || binary === "") {
      return { content: "", error: "binary is required" };
    }
    if (!isStrings(args.args)) return { content: "", error: "args must be an array of strings" };
    if (typeof repo !== "string" || repo === "") return { content: "", error: "repo is required" };
    if (typeof branch !== "string" || branch === "") {
      return { content: "", error: "branch is required" };
    }
    if (!ctx.commands) {
      return { content: "", error: "the chat has no workspace to run commands in" };
    }
    const result = await ctx.commands.run({ binary, args: args.args, repo, worktree: branch });
    const run = result.runId
      ? { binary, args: [...args.args], repo, worktree: branch, runId: result.runId }
      : undefined;
    if (!result.ok) {
      const error = result.error ?? "it failed";
      return {
        content: "",
        error: result.output ? `${error}\n${result.output}` : error,
        ...(run ? { run } : {}),
      };
    }
    const cut = result.truncated
      ? "\n[the output was cut; narrow the command: a path, fewer results (e.g. `-n 20`), or a summary option (e.g. `--stat`)]"
      : "";
    const output = result.output === "" ? "(no output)\n" : `${result.output}\n`;
    return { content: `${output}[exit ${result.exitCode}]${cut}`, ...(run ? { run } : {}) };
  },
};

export function register(registry: AgentToolRegistry): void {
  registry.register(RUN_COMMAND_TOOL);
}
