/**
 * tools/write-file.ts — the `create_or_replace_file` agent tool.
 *
 * Creates a file (when absent) or replaces an existing file's contents (when
 * present), within a connected worktree. Uses the same scope model as
 * `read_file`/`edit_file`. The write goes through git (a generated patch applied
 * with `git apply`), producing an unstaged working-tree change — never an
 * implicit stage/commit.
 */

import fs from "fs";
import path from "path";
import type { AgentTool, AgentToolRegistry, ToolExecutionContext } from "./types.js";
import {
  applyPatch,
  blobHash,
  buildCreatePatch,
  buildDiffPatch,
  containingRoots,
  guardFile,
  resolvePath,
  resolveRelPath,
  scopeError,
  topLevelFor,
} from "./shared.js";

type WriteMode = "create" | "replace" | "create_or_replace";

const tool: AgentTool = {
  name: "create_or_replace_file",
  description:
    "Create a new file, or replace an existing file's contents, inside a connected " +
    "worktree. Provide a path (absolute or cwd-relative) and the full content. mode: " +
    "'create' fails if the file exists, 'replace' fails if it does not, and " +
    "'create_or_replace' (default) does whichever applies. The write is applied through " +
    "git as an unstaged working-tree change; it is never committed implicitly. Paths " +
    "outside the connected worktrees are rejected.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to create/replace (absolute or cwd-relative).",
      },
      content: {
        type: "string",
        description: "The full contents to write to the file.",
      },
      mode: {
        type: "string",
        enum: ["create", "replace", "create_or_replace"],
        description: "Set defaults to 'create_or_replace'.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const p = resolvePath(args.path as string | undefined, ctx);
    if (!p) return { content: "create_or_replace_file: missing 'path'", error: "missing 'path'" };
    const denied = scopeError(p, ctx);
    if (denied) return { content: "", error: `create_or_replace_file: ${denied}` };
    if (ctx.roots !== undefined) {
      const roots = containingRoots(p, ctx.roots);
      if (roots.length === 0) {
        return {
          content: "",
          error: `create_or_replace_file: path is outside the connected worktrees`,
        };
      }
      if (roots.length > 1) {
        return {
          content: "",
          error: `create_or_replace_file: path is ambiguous (in ${roots.length} worktrees): '${p}'`,
        };
      }
    }

    const mode = (args.mode as WriteMode) ?? "create_or_replace";
    const content = typeof args.content === "string" ? args.content : "";

    const exists = fs.existsSync(p);
    if (mode === "create" && exists) {
      return { content: "", error: `create_or_replace_file: file already exists ('${p}')` };
    }
    if (mode === "replace" && !exists) {
      return { content: "", error: `create_or_replace_file: file does not exist ('${p}')` };
    }

    // Guard an existing file before overwriting (reject binary/oversized).
    if (exists) {
      const guard = await guardFile(p);
      if (guard) return { content: "", error: `create_or_replace_file: ${guard}` };
    }

    const top = await topLevelFor(exists ? path.dirname(p) : nearestExistingDir(p));
    if (!top) {
      return { content: "", error: `create_or_replace_file: '${p}' is not inside a git worktree` };
    }
    const rel = await resolveRelPath(top, p);

    try {
      if (!exists) {
        // Ensure parent directories exist so `git apply` can create the file.
        await fs.promises.mkdir(path.dirname(path.resolve(top, rel)), { recursive: true });
        const createPatch = await buildCreatePatch(rel, content);
        if (!createPatch.trim()) {
          return { content: "", error: "create_or_replace_file: empty create patch" };
        }
        await applyPatch(top, createPatch);
      } else {
        const current = await fs.promises.readFile(p, "utf-8");
        if (current === content) {
          return {
            content: `create_or_replace_file: no change needed (${rel} already matches)`,
          };
        }
        const diffPatch = await buildDiffPatch(rel, current, content);
        if (!diffPatch.trim()) {
          return {
            content: `create_or_replace_file: no change needed (${rel} already matches)`,
          };
        }
        await applyPatch(top, diffPatch);
      }
    } catch (err) {
      return { content: "", error: `create_or_replace_file: ${(err as Error).message}` };
    }

    const hash = await blobHash(p);
    return {
      content: `create_or_replace_file: ${exists ? "replaced" : "created"} ${rel} (new blob ${hash ?? "unknown"})`,
    };
  },
};

/** Nearest existing ancestor directory (for git worktree detection on create). */
function nearestExistingDir(p: string): string {
  let dir = path.dirname(p);
  while (dir && dir !== path.dirname(dir) && !fs.existsSync(dir)) {
    dir = path.dirname(dir);
  }
  return dir;
}

/** Register this tool into a registry. */
export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
