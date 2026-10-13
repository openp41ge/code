/**
 * expanded-store.ts — which repos, worktrees and folders are open in the
 * Explorer, kept per workspace so reopening a workspace opens them again.
 *
 * The paths are saved in `expanded.json` in the Explorer's folder inside the
 * calling window's workspace data folder (`ctx.workspace.dataDir()`).
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HandlerContext, HandlerPayload } from "openp41ge-sdk";

const FILE = "expanded.json";

/** `load-expanded` / `save-expanded` result. */
export interface ExpandedResult {
  readonly ok: boolean;
  readonly paths?: string[];
  readonly error?: string;
}

/** `load-expanded`: the saved paths (none saved yet, or no workspace: none). */
export async function loadExpanded(
  _payload: HandlerPayload,
  ctx?: HandlerContext,
): Promise<ExpandedResult> {
  const workspace = ctx?.workspace;
  if (!workspace) return { ok: true, paths: [] };
  try {
    const raw = JSON.parse(await readFile(join(await workspace.dataDir(), FILE), "utf-8")) as {
      paths?: unknown;
    };
    const paths = Array.isArray(raw.paths)
      ? raw.paths.filter((p): p is string => typeof p === "string")
      : [];
    return { ok: true, paths };
  } catch {
    return { ok: true, paths: [] };
  }
}

/** `save-expanded`: replace the saved paths with `payload.paths`. */
export async function saveExpanded(
  payload: HandlerPayload,
  ctx?: HandlerContext,
): Promise<ExpandedResult> {
  const workspace = ctx?.workspace;
  if (!workspace) return { ok: false, error: "No workspace to save into" };
  const paths = Array.isArray(payload.paths)
    ? payload.paths.filter((p): p is string => typeof p === "string")
    : [];
  try {
    await writeFile(
      join(await workspace.dataDir(), FILE),
      JSON.stringify({ paths }, null, 2) + "\n",
      "utf-8",
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
