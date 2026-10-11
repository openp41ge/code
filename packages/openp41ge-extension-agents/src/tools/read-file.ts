/**
 * tools/read-file.ts — the `read_file` agent tool.
 *
 * Reads a text file, reporting errors in-band via `error` rather than throwing
 * across the tool interface. Registers itself against an AgentToolRegistry.
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

/** Clamp content length so a huge file doesn't flood the model context. */
const MAX_READ_BYTES = 50_000;

const tool: AgentTool = {
  name: "read_file",
  description:
    "Read the contents of a text file from the connected worktrees. Provide an absolute or " +
    "cwd-relative path. Optionally limit the size read. Paths outside the connected worktrees " +
    "(including the bare repo) are rejected.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read." },
      offset: { type: "number", description: "Byte offset to start reading from." },
      maxLength: { type: "number", description: "Maximum number of bytes to read." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const p = resolvePath(args.path as string | undefined, ctx);
    if (!p) return { content: "read_file: missing 'path'", error: "missing 'path'" };
    const denied = scopeError(p, ctx);
    if (denied) return { content: "", error: denied };
    try {
      const offset = typeof args.offset === "number" ? args.offset : 0;
      const maxLength =
        typeof args.maxLength === "number"
          ? Math.min(args.maxLength, MAX_READ_BYTES)
          : MAX_READ_BYTES;
      const content = await fs.promises.readFile(p, "utf-8");
      const sliced = content.slice(offset, offset + maxLength);
      return { content: sliced || "(empty file)" };
    } catch (err) {
      return { content: "", error: `read_file: ${(err as Error).message}` };
    }
  },
};

/** Register this tool into a registry. */
export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
