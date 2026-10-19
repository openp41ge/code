/**
 * tools/read-file.ts — the `read_file` agent tool.
 *
 * Reads a range of a text file's lines, numbered, under a header naming the
 * range and the file's length, so a line a search found can be read and the
 * model always knows where it is in the file. Errors are reported in-band via
 * `error` rather than thrown across the tool interface. Registers itself
 * against an AgentToolRegistry.
 */

import fs from "fs";
import path from "path";
import type { AgentTool, AgentToolRegistry, ToolExecutionContext } from "./types.js";

/** Resolve a possibly-relative path against the tool context cwd. */
function resolvePath(p: string | undefined, ctx: ToolExecutionContext): string | undefined {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.resolve(ctx.cwd ?? process.cwd(), p);
}

/**
 * Whether `p` lies at or under `root`. Paths are compared lexically (after
 * resolving `.`/`..`) so `root` itself counts, but a sibling like
 * `/root-evil` under `/root` does not.
 */
function isWithin(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Enforce the connected-worktree scope. Returns an in-band error string when
 * the path is not inside one of `ctx.roots`; `null` when it is allowed.
 *
 * - `roots` undefined → no scope restriction (legacy / direct tool usage).
 * - `roots` empty → nothing connected → deny every read.
 * - `roots` non-empty → path must be within a root.
 */
function scopeError(p: string, ctx: ToolExecutionContext): string | null {
  if (ctx.roots === undefined) return null;
  if (ctx.roots.length === 0) {
    return `read_file: no connected worktrees in scope`;
  }
  if (!ctx.roots.some((root) => isWithin(p, root))) {
    return `read_file: path is outside the connected worktrees ('${p}')`;
  }
  return null;
}

/** Lines a read returns unless it asks for a number. */
const DEFAULT_LINE_COUNT = 400;
/** The most lines one read returns. */
const MAX_LINE_COUNT = 2000;
/** The most text one read returns, so a file of long lines doesn't flood the
 *  model's context: the read stops at the line that would pass it. */
const MAX_READ_CHARS = 50_000;
/** A longer line is cut (a minified file is one huge line). */
const MAX_LINE_CHARS = 1000;
/** How much of the start of a file is checked for a NUL byte (binary). */
const BINARY_SNIFF_BYTES = 8000;

const positive = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;

/** The file's lines (a trailing newline ends the last line, it doesn't add
 *  an empty one; `\r\n` is a line end). */
function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function cutLine(line: string): string {
  return line.length > MAX_LINE_CHARS
    ? `${line.slice(0, MAX_LINE_CHARS)}… (line cut: ${line.length} characters)`
    : line;
}

const tool: AgentTool = {
  name: "read_file",
  description:
    "Read lines of a text file in the connected worktrees. Each line comes back numbered, under a " +
    "header naming the range and the file's length (`<path>: lines 120-519 of 4180`); a read that " +
    "stops early says the startLine to continue from. To read a search_files match, join its " +
    "heading's worktree folder and its path, and pass its line as startLine. Provide an absolute or cwd-relative path; paths outside the connected " +
    "worktrees (including the bare repo) are rejected.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read." },
      startLine: {
        type: "number",
        description: "The first line to read, from 1 (default 1).",
      },
      lineCount: {
        type: "number",
        description: `How many lines to read (default ${DEFAULT_LINE_COUNT}, at most ${MAX_LINE_COUNT}).`,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const p = resolvePath(args.path as string | undefined, ctx);
    if (!p) return { content: "read_file: missing 'path'", error: "missing 'path'" };
    const denied = scopeError(p, ctx);
    if (denied) return { content: "", error: denied };
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(p);
    } catch (err) {
      return { content: "", error: `read_file: ${(err as Error).message}` };
    }
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { content: "", error: `read_file: '${p}' is a binary file` };
    }
    const lines = splitLines(buf.toString("utf-8"));
    if (lines.length === 0) return { content: `${p}: empty file` };
    const start = positive(args.startLine) ?? 1;
    if (start > lines.length) {
      return {
        content: "",
        error: `read_file: startLine ${start} is past the end ('${p}' has ${lines.length} lines)`,
      };
    }
    const count = Math.min(positive(args.lineCount) ?? DEFAULT_LINE_COUNT, MAX_LINE_COUNT);
    const shown: string[] = [];
    let chars = 0;
    for (let n = start; n < start + count && n <= lines.length; n++) {
      const line = `${n}\t${cutLine(lines[n - 1])}`;
      if (shown.length > 0 && chars + line.length > MAX_READ_CHARS) break;
      shown.push(line);
      chars += line.length + 1;
    }
    const end = start + shown.length - 1;
    const out = [`${p}: lines ${start}-${end} of ${lines.length}`, ...shown];
    if (end < lines.length) out.push(`(continue with startLine ${end + 1})`);
    return { content: out.join("\n") };
  },
};

/** Register this tool into a registry. */
export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
