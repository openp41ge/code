/**
 * tools/search-files.ts — the `search_files` agent tool.
 *
 * Walks a set of roots looking for files whose path/name contains a query
 * substring, reporting errors in-band via `error`. Registers itself against an
 * AgentToolRegistry.
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
 * Whether `p` lies at or under `root`. Compared lexically after resolving
 * `.`/`..`, so `/root`-adjacent siblings like `/root-evil` are excluded.
 */
function isWithin(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Filter a requested root against the connected-worktree scope.
 *
 * - `roots` undefined → no scope restriction (legacy / direct usage).
 * - `roots` empty → nothing connected → deny the search.
 * - a requested root outside `roots` → caller is trying to escape the scope.
 */
function scopeError(candidates: string[], ctx: ToolExecutionContext): string | null {
  if (ctx.roots === undefined) return null;
  if (ctx.roots.length === 0) {
    return "search_files: no connected worktrees in scope";
  }
  const out = candidates.filter((r) => !ctx.roots!.some((root) => isWithin(r, root)));
  if (out.length) {
    return `search_files: roots outside the connected worktrees (${out.join(", ")})`;
  }
  return null;
}

async function walk(dir: string, query: string, out: string[], max: number): Promise<void> {
  if (out.length >= max) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= max) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p, query, out, max);
    } else if (p.toLowerCase().includes(query)) {
      out.push(p);
    }
  }
}

const tool: AgentTool = {
  name: "search_files",
  description:
    "Search for files whose path/name matches a substring within the connected worktrees. " +
    "Pass one or more worktree root paths to search a specific repo/worktree or group of them; " +
    "when omitted, searches all connected worktrees. Roots outside the connected worktrees are " +
    "rejected. Returns up to 200 matching paths.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring to match against file paths." },
      roots: {
        type: "array",
        items: { type: "string" },
        description:
          "Worktree root paths to search. Use paths from the connected-worktrees list. " +
          "Defaults to all connected worktrees.",
      },
      maxResults: { type: "number", description: "Maximum number of results (default 200)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const query = String(args.query ?? "").toLowerCase();
    if (!query) return { content: "search_files: empty query", error: "empty query" };
    const maxResults = typeof args.maxResults === "number" ? args.maxResults : 200;
    const requested = Array.isArray(args.roots)
      ? (args.roots as string[]).map((r) => resolvePath(r, ctx) ?? r)
      : undefined;

    // Apply the connected-worktree scope.
    let roots: string[];
    if (ctx.roots !== undefined) {
      // No roots argument → search every connected worktree; otherwise search
      // the requested subset (specific worktree(s) / a group of them).
      const candidates = requested && requested.length ? requested : ctx.roots;
      const denied = scopeError(candidates, ctx);
      if (denied) return { content: "", error: denied };
      roots = candidates;
    } else {
      roots = requested && requested.length ? requested : [ctx.cwd ?? process.cwd()];
    }

    const results: string[] = [];
    try {
      for (const root of roots) {
        await walk(root, query, results, maxResults);
        if (results.length >= maxResults) break;
      }
      return {
        content: results.length ? results.slice(0, maxResults).join("\n") : "(no matching files)",
      };
    } catch (err) {
      return { content: "", error: `search_files: ${(err as Error).message}` };
    }
  },
};

/** Register this tool into a registry. */
export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
