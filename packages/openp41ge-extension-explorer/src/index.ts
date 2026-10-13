/**
 * index.ts — the Explorer extension **backend** entry (main process).
 *
 * `api: "0.2"` renderer-driven. The module self-registers its command handlers
 * at load time via `registerProcesses`; the host wraps the import in an
 * extension scope so the registration is captured against this extension and
 * re-keyed to `<id>/<command>`.
 *
 * These are pure Node capabilities (node:fs) — listing a directory, gating
 * a file open (path confinement + size/binary checks), and keeping which rows
 * are open per workspace (`./expanded-store.ts`). The renderer entry
 * (`./renderer.ts`) owns the tree UI and drives these handlers over the
 * dispatch bus.
 */

import { registerProcesses, type HandlerPayload } from "openp41ge-sdk";
import { createDir, createFile, listDir, MAX_LIST_DEPTH, type TreeNode } from "./tree.js";
import { inspectFile, isWithinRoot, looksBinary, type OpenFileResult } from "./inspect.js";
import { loadExpanded, saveExpanded } from "./expanded-store.js";

/** Result envelope returned by the `read-dir` process. */
export interface ReadDirResult {
  readonly ok: boolean;
  readonly entries?: TreeNode[];
  readonly error?: string;
}

/**
 * `read-dir` handler: list a directory for the renderer's tree. `depth` bounds
 * how many nested levels are prefetched ahead (clamped to `MAX_LIST_DEPTH`) so
 * expanding the next level is instant instead of another round trip.
 */
export async function readDir(payload: HandlerPayload): Promise<ReadDirResult> {
  const dirPath = typeof payload.path === "string" ? payload.path : null;
  if (!dirPath) {
    return { ok: false, error: "read-dir requires a `path`" };
  }
  const rawDepth = typeof payload.depth === "number" ? payload.depth : 0;
  const depth = Number.isFinite(rawDepth)
    ? Math.min(MAX_LIST_DEPTH, Math.max(0, Math.round(rawDepth)))
    : 0;
  try {
    const entries = await listDir(dirPath, depth);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `open-file` handler: gate whether a file can be opened in the host's file
 * editor. Confines the path to the worktree root, and rejects oversize / binary
 * files before the host opens an editor tab.
 */
export async function openFile(payload: HandlerPayload): Promise<OpenFileResult> {
  const filePath = typeof payload.path === "string" ? payload.path : null;
  const root = typeof payload.root === "string" ? payload.root : null;
  if (!filePath || !root) {
    return { ok: false, error: "open-file requires `path` and `root`" };
  }
  return inspectFile(filePath, root);
}

/** Result envelope returned by the `create-dir` / `write-file` processes. */
export interface CreateEntryResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * `create-dir` handler: create a directory for the renderer's `+ add folder`
 * row. Confines the target to the worktree root and refuses an existing path.
 */
export async function createDirProcess(payload: HandlerPayload): Promise<CreateEntryResult> {
  const dirPath = typeof payload.path === "string" ? payload.path : null;
  const root = typeof payload.root === "string" ? payload.root : null;
  if (!dirPath || !root) {
    return { ok: false, error: "create-dir requires `path` and `root`" };
  }
  if (!isWithinRoot(dirPath, root)) {
    return { ok: false, error: "Path is outside the workspace root" };
  }
  try {
    await createDir(dirPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `write-file` handler: create an empty file for the renderer's `+ add file`
 * row. Confines the target to the worktree root and never clobbers an existing
 * file.
 */
export async function createFileProcess(payload: HandlerPayload): Promise<CreateEntryResult> {
  const filePath = typeof payload.path === "string" ? payload.path : null;
  const root = typeof payload.root === "string" ? payload.root : null;
  if (!filePath || !root) {
    return { ok: false, error: "write-file requires `path` and `root`" };
  }
  if (!isWithinRoot(filePath, root)) {
    return { ok: false, error: "Path is outside the workspace root" };
  }
  try {
    await createFile(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

registerProcesses({
  "read-dir": readDir,
  "open-file": openFile,
  "create-dir": createDirProcess,
  "write-file": createFileProcess,
  "load-expanded": loadExpanded,
  "save-expanded": saveExpanded,
});

export { createDir, createFile, listDir, inspectFile, isWithinRoot, looksBinary };
export type { TreeNode, OpenFileResult };
