/**
 * workspace-file.ts — the `.openp41ge-workspace` file model for the
 * openp41ge-extension-workspaces extension.
 *
 * This is the extension's own (dependency-light) copy of the workspace file
 * contract. The platform (`openp41ge`) owns the authoritative type + migration
 * in `layout/types.ts` / `layout/workspace-file.ts`; the extension reads and
 * writes the SAME files over `node:fs`, so it must understand the shape and
 * preserve fields it does not manage (session, agent config, custom fields) on
 * round-trip.
 *
 * Fields that the extension's UI manages are typed; everything else is kept as
 * `Record<string, unknown>` so an edit never silently drops data.
 */

import { deriveRepoName } from "openp41ge-sdk";

/** Current workspace-file format version. */
export const WORKSPACE_FILE_VERSION = 2;

/** A repository entry inside a workspace file. */
export interface WorkspaceRepo {
  readonly url: string;
  readonly worktrees?: string[];
}

/**
 * Index of the repo in `repos` with the same workspace name as `url` (its
 * SSH and HTTPS URLs count as one repo), skipping `except`; -1 when none.
 */
export function findRepoByName(repos: readonly WorkspaceRepo[], url: string, except = -1): number {
  const name = deriveRepoName(url);
  return repos.findIndex((r, i) => i !== except && deriveRepoName(r.url) === name);
}

/**
 * The `.openp41ge-workspace` file contents. The manifest fields are typed;
 * session / platform fields that the management UI does not own are preserved
 * verbatim via `[key: string]: unknown`.
 */
export interface WorkspaceFileData {
  id: string;
  name?: string;
  version: number;
  createdAt: string;
  dataDir: string;
  repos: WorkspaceRepo[];
  /** ISO-8601 timestamp of the last time this workspace was opened. */
  lastActivatedAt?: string;

  // ── v2 session fields (preserved, not edited by the management UI) ────
  systemTabs?: Record<string, unknown>;
  editorTabs?: Record<string, unknown>;
  tabGroups?: Record<string, unknown>;
  scopedFolders?: string[];
  sharedSidebars?: {
    leftSidebarTabs: string[];
    rightSidebarTabs: string[];
    leftSidebarOpen: boolean;
    rightSidebarOpen: boolean;
  };
  windows?: unknown[];

  /** Any future / unknown fields are preserved verbatim on round-trip. */
  [key: string]: unknown;
}

/** An empty shared-sidebar block. */
export function emptySharedSidebars(): NonNullable<WorkspaceFileData["sharedSidebars"]> {
  return {
    leftSidebarTabs: [],
    rightSidebarTabs: [],
    leftSidebarOpen: false,
    rightSidebarOpen: false,
  };
}

/**
 * Migrate any raw workspace-file JSON to the current shape, filling defaults
 * for manifest-only (v1) and partial inputs. Never throws. Unknown fields are
 * preserved.
 */
export function migrateWorkspaceFileData(raw: unknown): WorkspaceFileData {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<WorkspaceFileData>;
  const data: WorkspaceFileData = {
    ...obj,
    id: obj.id ?? "",
    version: WORKSPACE_FILE_VERSION,
    createdAt: obj.createdAt ?? new Date().toISOString(),
    dataDir: obj.dataDir ?? "",
    repos: Array.isArray(obj.repos) ? obj.repos : [],
    systemTabs: (obj.systemTabs as Record<string, unknown> | undefined) ?? {},
    editorTabs: (obj.editorTabs as Record<string, unknown> | undefined) ?? {},
    tabGroups: (obj.tabGroups as Record<string, unknown> | undefined) ?? {},
    scopedFolders: Array.isArray(obj.scopedFolders) ? obj.scopedFolders : [],
    sharedSidebars: obj.sharedSidebars ?? emptySharedSidebars(),
    windows: Array.isArray(obj.windows) ? obj.windows : [],
  };
  return data;
}

/** Serialize a workspace-file object to pretty-printed JSON. */
export function serializeWorkspaceFile(data: WorkspaceFileData): string {
  return JSON.stringify(migrateWorkspaceFileData(data), null, 2) + "\n";
}

/** Parse a workspace-file JSON string, migrating to the current version. */
export function deserializeWorkspaceFile(json: string): WorkspaceFileData {
  return migrateWorkspaceFileData(JSON.parse(json));
}

/** A workspace entry as listed/read from disk: its file path + migrated data. */
export interface WorkspaceEntry {
  readonly filePath: string;
  readonly data: WorkspaceFileData;
}

/** The display name of a workspace, derived from its file name. */
export function workspaceDisplayName(data: WorkspaceFileData, filePath: string): string {
  const name = data.name?.trim();
  if (name) return name;
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.openp41ge-workspace$/i, "").trim() || "Unnamed";
}

/** The layout session's fields (saved by the workspace's windows, never edited here). */
const SESSION_FIELDS: readonly string[] = [
  "systemTabs",
  "editorTabs",
  "tabGroups",
  "scopedFolders",
  "sharedSidebars",
  "windows",
];

/**
 * `data` with the layout session of `onDisk` (the file as it is now): the
 * editor writes the manifest, never the session the workspace's windows saved.
 */
export function withSessionOf(
  data: WorkspaceFileData,
  onDisk: WorkspaceFileData,
): WorkspaceFileData {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!SESSION_FIELDS.includes(k)) next[k] = v;
  }
  for (const k of SESSION_FIELDS) {
    const v = k in onDisk ? onDisk[k] : data[k];
    if (v !== undefined) next[k] = v;
  }
  return next as WorkspaceFileData;
}

/** Structural equality of two JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge the repos of `mine` (unsaved edits of `base`) with `theirs` (the file
 * on disk now), by repo name: an entry I left alone takes theirs; one I
 * edited keeps mine; one either side removed is gone unless the other edited
 * it; additions from both sides stay (theirs in their order, then mine).
 */
function mergeRepos(
  base: readonly WorkspaceRepo[],
  mine: readonly WorkspaceRepo[],
  theirs: readonly WorkspaceRepo[],
): WorkspaceRepo[] {
  const byName = (repos: readonly WorkspaceRepo[]) =>
    new Map(repos.map((r) => [deriveRepoName(r.url), r]));
  const b = byName(base);
  const m = byName(mine);
  const t = byName(theirs);
  const merged: WorkspaceRepo[] = [];
  for (const [name, their] of t) {
    const my = m.get(name);
    const was = b.get(name);
    if (my) merged.push(was && sameJson(my, was) ? their : my);
    else if (!was || !sameJson(their, was)) merged.push(their); // new, or they edited what I removed
  }
  for (const [name, my] of m) {
    if (t.has(name)) continue;
    const was = b.get(name);
    if (!was || !sameJson(my, was)) merged.push(my); // my addition, or my edit of what they removed
  }
  return merged;
}

/**
 * The workspace editor's unsaved edits (`mine`, made on `base`) merged with
 * the file as it is on disk now (`theirs`): every manifest field I left alone
 * takes the disk's value, one I edited keeps mine, repos merge by name
 * (`mergeRepos`), and the layout session is always the disk's.
 */
export function mergeWorkspaceEdits(
  base: WorkspaceFileData,
  mine: WorkspaceFileData,
  theirs: WorkspaceFileData,
): WorkspaceFileData {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    let value: unknown;
    if (SESSION_FIELDS.includes(k)) value = theirs[k];
    else if (k === "repos")
      value = mergeRepos(base.repos ?? [], mine.repos ?? [], theirs.repos ?? []);
    else value = sameJson(mine[k], base[k]) ? theirs[k] : mine[k];
    if (value !== undefined) merged[k] = value;
  }
  return merged as WorkspaceFileData;
}
