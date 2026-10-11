/**
 * tools/edit-file.ts — the `edit_file` agent tool.
 *
 * Applies targeted textual edits to an existing file in a connected worktree.
 * Mirrors the `read_file`/`search_files` scope model (in-band errors, never
 * thrown). The change is computed against the file's current working-tree
 * content and applied VIA GIT (`git diff -> rewrite -> git apply`), so the
 * result is a real, reviewable/unstaged working-tree diff. It never stages or
 * commits implicitly.
 */

import path from "path";
import fs from "fs";
import type { AgentTool, AgentToolRegistry, ToolExecutionContext } from "./types.js";
import {
  applyPatch,
  blobHash,
  buildDiffPatch,
  containingRoots,
  guardFile,
  resolvePath,
  resolveRelPath,
  scopeError,
  topLevelFor,
} from "./shared.js";

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

const tool: AgentTool = {
  name: "edit_file",
  description:
    "Apply targeted text substitutions to an existing file in a connected worktree. " +
    "Provide a path (absolute or cwd-relative) and a list of {old, new} edits. Each " +
    "'old' must appear exactly once in the file ('new' may be empty to delete). The " +
    "change is applied through git (an unstaged working-tree diff) and the worktree is " +
    "left un-committed. Paths outside the connected worktrees are rejected.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit (absolute or cwd-relative).",
      },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            old: { type: "string", description: "Exact text to replace (must appear once)." },
            new: { type: "string", description: "Replacement text (empty string deletes)." },
          },
          required: ["old", "new"],
          additionalProperties: false,
        },
        description: "Text substitutions to apply, in order.",
      },
    },
    required: ["path", "edits"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const p = resolvePath(args.path as string | undefined, ctx);
    if (!p) return { content: "edit_file: missing 'path'", error: "missing 'path'" };
    const denied = scopeError(p, ctx);
    if (denied) return { content: "", error: `edit_file: ${denied}` };
    if (ctx.roots !== undefined) {
      const roots = containingRoots(p, ctx.roots);
      if (roots.length === 0) {
        return { content: "", error: `edit_file: path is outside the connected worktrees` };
      }
      if (roots.length > 1) {
        return {
          content: "",
          error: `edit_file: path is ambiguous (in ${roots.length} worktrees): '${p}'`,
        };
      }
    }

    const guard = await guardFile(p);
    if (guard) return { content: "", error: `edit_file: ${guard}` };

    const edits = Array.isArray(args.edits) ? (args.edits as Array<Record<string, unknown>>) : [];
    if (edits.length === 0) {
      return { content: "edit_file: no edits provided", error: "no edits provided" };
    }

    let current: string;
    try {
      current = await fs.promises.readFile(p, "utf-8");
    } catch (err) {
      return { content: "", error: `edit_file: ${(err as Error).message}` };
    }

    // Apply each edit to the running content, requiring exactly one match.
    for (const [i, edit] of edits.entries()) {
      const oldText = typeof edit.old === "string" ? edit.old : "";
      const newText = typeof edit.new === "string" ? edit.new : "";
      if (!oldText) {
        return { content: "", error: `edit_file: edits[${i}].old is empty` };
      }
      const count = occurrences(current, oldText);
      if (count === 0) {
        return {
          content: "",
          error: `edit_file: edits[${i}].old not found ('${oldText}')`,
        };
      }
      if (count > 1) {
        return {
          content: "",
          error: `edit_file: edits[${i}].old is ambiguous (matches ${count} times)`,
        };
      }
      current = current.replace(oldText, newText);
    }

    // Resolve the worktree top-level and apply via git.
    const top = await topLevelFor(path.dirname(p));
    if (!top) {
      return { content: "", error: `edit_file: '${p}' is not inside a git worktree` };
    }
    const rel = await resolveRelPath(top, p);

    let patch: string;
    try {
      patch = await buildDiffPatch(rel, await fs.promises.readFile(p, "utf-8"), current);
    } catch (err) {
      return { content: "", error: `edit_file: ${(err as Error).message}` };
    }
    try {
      await applyPatch(top, patch);
    } catch (err) {
      return { content: "", error: `edit_file: ${(err as Error).message}` };
    }

    const hash = await blobHash(p);
    return {
      content: `edit_file: applied ${edits.length} edit(s) to ${rel} (new blob ${hash ?? "unknown"})`,
    };
  },
};

/** Register this tool into a registry. */
export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
