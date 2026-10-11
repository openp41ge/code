/**
 * index.ts — the Workspaces extension **backend** entry (main process).
 *
 * `api: "0.2"` renderer-driven. The module self-registers its command handlers
 * at load time via `registerProcesses`; the host wraps the import in an
 * extension scope so each registration is re-keyed to `openp41ge-extension-workspaces/<command>`.
 *
 * These are pure Node capabilities (`node:fs`) — listing / reading / writing /
 * creating / deleting `.openp41ge-workspace` files under the workspaces
 * directory. The renderer entry (`./renderer.ts`) owns the management UI and
 * drives these handlers over the dispatch bus. The paths come from the
 * platform-injected `workspacesDir` context, so the backend never guesses the
 * app-data location.
 *
 * All file access is confined to the provided workspaces directory: every
 * read/write/delete path is resolved and validated against `dir` before any fs
 * call, so a stray `../` from the renderer cannot escape the workspace store.
 */

import { registerProcesses, type HandlerPayload } from "openp41ge-sdk";
import {
  migrateWorkspaceFileData,
  serializeWorkspaceFile,
  withSessionOf,
  type WorkspaceFileData,
  type WorkspaceEntry,
} from "./workspace-file.js";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKSPACE_EXT = "openp41ge-workspace";

/** Resolve a path starting with `~/`. */
function resolveTilde(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Result envelope returned by the workspace-file processes. */
export interface WorkspaceResult {
  readonly ok: boolean;
  readonly entries?: WorkspaceEntry[];
  readonly entry?: WorkspaceEntry;
  readonly error?: string;
}

/**
 * Confine a candidate path under `dir` (already tilde-resolved). Returns the
 * resolved path, or null when the path escapes the workspaces directory.
 */
function confineToDir(dir: string, candidate: string): string | null {
  const resolved = path.resolve(dir);
  const target = path.resolve(candidate);
  if (target !== resolved && !target.startsWith(resolved + path.sep)) return null;
  return target;
}

/** Number of milliseconds since epoch for a workspace's last activation. */
function sortKey(entry: WorkspaceEntry): number {
  const at = entry.data.lastActivatedAt;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** List every `.openp41ge-workspace` file in the directory, migrated + sorted. */
export async function listWorkspaces(dir: string): Promise<WorkspaceEntry[]> {
  const resolved = resolveTilde(dir);
  const handle = await fs.readdir(resolved, { withFileTypes: true });
  const entries: WorkspaceEntry[] = [];
  for (const dirent of handle) {
    if (!dirent.isFile() || !dirent.name.endsWith(`.${WORKSPACE_EXT}`)) continue;
    const filePath = path.join(resolved, dirent.name);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      entries.push({ filePath, data: migrateWorkspaceFileData(JSON.parse(raw)) });
    } catch {
      // Skip unparseable files rather than failing the whole listing.
    }
  }
  // Sort by last-activated (epoch fallback), tie-break alphabetically by name.
  entries.sort((a, b) => {
    const byTime = sortKey(b) - sortKey(a);
    if (byTime !== 0) return byTime;
    return (a.data.name ?? "").localeCompare(b.data.name ?? "");
  });
  return entries;
}

/** `list` handler: list workspace files under `dir`. */
export async function listWorkspacesProcess(payload: HandlerPayload): Promise<WorkspaceResult> {
  const dir = typeof payload.dir === "string" ? payload.dir : null;
  if (!dir) return { ok: false, error: "list requires a `dir`" };
  try {
    const entries = await listWorkspaces(dir);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `read` handler: read a single workspace file (confined to `dir`). */
export async function readWorkspaceProcess(payload: HandlerPayload): Promise<WorkspaceResult> {
  const dir = typeof payload.dir === "string" ? payload.dir : null;
  const filePath = typeof payload.path === "string" ? payload.path : null;
  if (!dir || !filePath) return { ok: false, error: "read requires `dir` and `path`" };
  const target = confineToDir(resolveTilde(dir), resolveTilde(filePath));
  if (!target) return { ok: false, error: "Path is outside the workspaces directory" };
  try {
    const raw = await fs.readFile(target, "utf-8");
    return {
      ok: true,
      entry: { filePath: target, data: migrateWorkspaceFileData(JSON.parse(raw)) },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `write` handler: persist a workspace file (confined to `dir`). */
export async function writeWorkspaceProcess(payload: HandlerPayload): Promise<WorkspaceResult> {
  const dir = typeof payload.dir === "string" ? payload.dir : null;
  const filePath = typeof payload.path === "string" ? payload.path : null;
  const raw = payload.data as WorkspaceFileData | undefined;
  if (!dir || !filePath || !raw || typeof raw !== "object") {
    return { ok: false, error: "write requires `dir`, `path` and `data`" };
  }
  const target = confineToDir(resolveTilde(dir), resolveTilde(filePath));
  if (!target) return { ok: false, error: "Path is outside the workspaces directory" };
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // The layout session is the workspace window's: keep what is on disk.
    let data = raw;
    try {
      const onDisk = migrateWorkspaceFileData(JSON.parse(await fs.readFile(target, "utf-8")));
      data = withSessionOf(raw, onDisk);
    } catch {
      // a new or unreadable file: write it as given
    }
    await fs.writeFile(target, serializeWorkspaceFile(data), "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `create` handler: create a new workspace file in `dir` from a partial manifest. */
export async function createWorkspaceProcess(payload: HandlerPayload): Promise<WorkspaceResult> {
  const dir = typeof payload.dir === "string" ? payload.dir : null;
  const name = typeof payload.name === "string" ? payload.name : "";
  if (!dir) return { ok: false, error: "create requires a `dir`" };
  const resolved = resolveTilde(dir);
  const id = (payload.id as string | undefined) || cryptoId();
  const fileName = `${sanitizeFileName(name) || id}.${WORKSPACE_EXT}`;
  const filePath = path.join(resolved, fileName);
  try {
    await fs.mkdir(resolved, { recursive: true });
    // Never clobber an existing file with the same id.
    if (!(await pathExists(filePath))) {
      const data = migrateWorkspaceFileData({
        id,
        name,
        version: 2,
        createdAt: new Date().toISOString(),
        dataDir: "",
        repos: [],
      });
      await fs.writeFile(filePath, serializeWorkspaceFile(data), "utf-8");
      return { ok: true, entry: { filePath, data } };
    }
    return { ok: false, error: "A workspace with that name already exists" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `delete` handler: remove a workspace file (confined to `dir`). */
export async function deleteWorkspaceProcess(payload: HandlerPayload): Promise<WorkspaceResult> {
  const dir = typeof payload.dir === "string" ? payload.dir : null;
  const filePath = typeof payload.path === "string" ? payload.path : null;
  if (!dir || !filePath) return { ok: false, error: "delete requires `dir` and `path`" };
  const target = confineToDir(resolveTilde(dir), resolveTilde(filePath));
  if (!target) return { ok: false, error: "Path is outside the workspaces directory" };
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return { ok: false, error: "Refusing to delete a directory" };
    await fs.rm(target, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Simple crypto-random id (falls back to a timestamp). */
function cryptoId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? fallbackId();
  } catch {
    return fallbackId();
  }
}

function fallbackId(): string {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A filename-safe version of a workspace name (or "" when empty). */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** True when a path exists (file or dir). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

registerProcesses({
  list: listWorkspacesProcess,
  read: readWorkspaceProcess,
  write: writeWorkspaceProcess,
  create: createWorkspaceProcess,
  delete: deleteWorkspaceProcess,
});

export { confineToDir };
export type { WorkspaceEntry, WorkspaceFileData, WorkspaceRepo } from "./workspace-file.js";
export { WORKSPACE_FILE_SCHEMA } from "./workspace-schema.js";
