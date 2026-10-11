/**
 * Workspace file (v2) — manifest + session conversion.
 *
 * The `.openp41ge-workspace` file is the single source of truth for a workspace:
 * it carries the manifest (name, repos, dataDir) AND the session that used to be
 * the global `workspace.json` (the workspace's windows, grid layouts, and shared
 * sidebar state).
 *
 * This module is pure (no I/O, no Electron) and holds:
 *   - `WORKSPACE_FILE_VERSION`
 *   - v1 → v2 migration (`migrateWorkspaceFileData`)
 *   - conversion between the in-memory layout `Workspace` and the file's session
 *     (`workspaceToFileData` / `fileDataToWorkspace`)
 *   - JSON serialize/deserialize helpers
 *
 * Kept separate from `layout/serialization.ts` (which is the legacy global
 * workspace.json serialization, being retired).
 */

import { deriveRepoName } from "openp41ge-sdk";
import type { Workspace, WorkspaceFileData, Window } from "./types.js";
import { WorkspaceSchema } from "./types.js";
import { migrateLegacyExtensionTabs } from "./legacy-extension-ids.js";
import { migrateLegacyGitTabs } from "./legacy-git-tabs.js";
import {
  migrateLegacyAgentsEditorTabs,
  migrateLegacyAgentsSystemTabs,
} from "./legacy-agents-tabs.js";
import { migrateLegacyExplorerSettingsTabs } from "./legacy-explorer-settings-tabs.js";

/** Current workspace-file format version. */
export const WORKSPACE_FILE_VERSION = 2;

/** The shared sidebar section of a workspace file. */
export type SharedSidebars = NonNullable<WorkspaceFileData["sharedSidebars"]>;

/** The session portion of a workspace file, as a plain object. */
export interface WorkspaceSession {
  systemTabs: Workspace["systemTabs"];
  editorTabs: Workspace["editorTabs"];
  tabGroups: Workspace["tabGroups"];
  scopedFolders: Workspace["scopedFolders"];
  sharedSidebars: SharedSidebars;
  windows: Window[];
}

/** An empty shared-sidebar block (no tabs, both sidebars closed). */
export function emptySharedSidebars(): SharedSidebars {
  return {
    leftSidebarTabs: [],
    rightSidebarTabs: [],
    leftSidebarOpen: false,
    rightSidebarOpen: false,
  };
}

/** Build an empty session for a freshly created workspace. */
export function emptyWorkspaceSession(): WorkspaceSession {
  return {
    systemTabs: {},
    editorTabs: {},
    tabGroups: {},
    scopedFolders: [],
    sharedSidebars: emptySharedSidebars(),
    windows: [],
  };
}

/** System-tab appTypes that have been removed from the product. */
const OBSOLETE_SYSTEM_TAB_APPTYPES = new Set(["search", "logs"]);

/**
 * Strip system tabs whose appType is no longer a registered sidebar panel
 * (e.g. the retired "Search" tab). Removes each dead tab from `systemTabs`,
 * from the shared sidebar tab lists, and as a window's active sidebar tab.
 * Idempotent — a clean file is returned unchanged.
 */
function stripObsoleteSystemTabs(data: WorkspaceFileData): WorkspaceFileData {
  const systemTabs = { ...(data.systemTabs ?? {}) };
  const removed = new Set<string>();
  for (const [id, raw] of Object.entries(systemTabs)) {
    const tab = raw as { appType?: string } | undefined;
    if (tab?.appType && OBSOLETE_SYSTEM_TAB_APPTYPES.has(tab.appType)) {
      removed.add(id);
      delete systemTabs[id];
    }
  }
  if (removed.size === 0) return data;

  const shared = data.sharedSidebars ?? emptySharedSidebars();
  const filterIds = (ids?: string[]): string[] => (ids ?? []).filter((id) => !removed.has(id));
  const windows = (data.windows ?? []).map((w) => {
    const sidebar = w.sidebar;
    if (!sidebar) return w;
    return {
      ...w,
      sidebar: {
        ...sidebar,
        activeLeftTab:
          sidebar.activeLeftTab && removed.has(sidebar.activeLeftTab)
            ? null
            : sidebar.activeLeftTab,
        activeRightTab:
          sidebar.activeRightTab && removed.has(sidebar.activeRightTab)
            ? null
            : sidebar.activeRightTab,
      },
    };
  });

  return {
    ...data,
    systemTabs,
    sharedSidebars: {
      ...shared,
      leftSidebarTabs: filterIds(shared.leftSidebarTabs),
      rightSidebarTabs: filterIds(shared.rightSidebarTabs),
    },
    windows,
  };
}

/**
 * Migrate any raw workspace-file JSON to the current v2 shape, filling defaults
 * for the manifest-only (v1) and partial inputs. Never throws.
 */
export function migrateWorkspaceFileData(raw: unknown): WorkspaceFileData {
  // `agentTools` (the per-workspace agent tool list) is retired: the agents
  // extension's config lists the enabled tools now.
  const { agentTools: _retired, ...obj } = (
    raw && typeof raw === "object" ? raw : {}
  ) as Partial<WorkspaceFileData> & { agentTools?: unknown };
  return stripObsoleteSystemTabs({
    ...obj,
    id: obj.id ?? "",
    version: WORKSPACE_FILE_VERSION,
    createdAt: obj.createdAt ?? new Date().toISOString(),
    dataDir: obj.dataDir ?? "",
    repos: obj.repos ?? [],
    // Rewrite app types saved under pre-rename extension ids, and the retired
    // platform git UI's and agents' tabs, BEFORE the obsolete-tab strip, so
    // they are kept.
    systemTabs: migrateLegacyAgentsSystemTabs(
      migrateLegacyGitTabs(migrateLegacyExtensionTabs(obj.systemTabs ?? {})),
    ),
    editorTabs: migrateLegacyExplorerSettingsTabs(
      migrateLegacyAgentsEditorTabs(
        migrateLegacyGitTabs(migrateLegacyExtensionTabs(obj.editorTabs ?? {})),
      ),
    ),
    tabGroups: obj.tabGroups ?? {},
    scopedFolders: obj.scopedFolders ?? [],
    sharedSidebars: obj.sharedSidebars ?? emptySharedSidebars(),
    windows: obj.windows ?? [],
  } as WorkspaceFileData);
}

/** Extract the session (shared + per-window state) from a layout Workspace. */
export function extractWorkspaceSession(ws: Workspace): WorkspaceSession {
  return {
    systemTabs: { ...(ws.systemTabs ?? {}) },
    editorTabs: { ...(ws.editorTabs ?? {}) },
    tabGroups: { ...(ws.tabGroups ?? {}) },
    scopedFolders: [...(ws.scopedFolders ?? [])],
    sharedSidebars: deriveSharedSidebars(ws),
    windows: ws.windows.map((w) => structuredClone(w)),
  };
}

/**
 * Derive the shared sidebar block from a layout workspace. Sidebars now hold
 * their shared set/side/open state directly on `Workspace.sidebar`.
 */
function deriveSharedSidebars(ws: Workspace): SharedSidebars {
  const shared = ws.sidebar;
  return {
    leftSidebarTabs: [...shared.leftSidebarTabs],
    rightSidebarTabs: [...shared.rightSidebarTabs],
    leftSidebarOpen: shared.leftSidebarOpen,
    rightSidebarOpen: shared.rightSidebarOpen,
  };
}

/**
 * A workspace file's layout session fields (saved by its workspace windows).
 * Every other field is its manifest (identity, name, repos, data folder, …).
 */
export const WORKSPACE_SESSION_FIELDS: readonly string[] = [
  "systemTabs",
  "editorTabs",
  "tabGroups",
  "scopedFolders",
  "sharedSidebars",
  "windows",
];

/** `current` with its manifest replaced by `manifest`'s (its session kept). */
export function withManifestOf(
  current: WorkspaceFileData,
  manifest: WorkspaceFileData,
): WorkspaceFileData {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(manifest)) {
    if (!WORKSPACE_SESSION_FIELDS.includes(k)) next[k] = v;
  }
  for (const k of WORKSPACE_SESSION_FIELDS) {
    const v = (current as unknown as Record<string, unknown>)[k];
    if (v !== undefined) next[k] = v;
  }
  return next as unknown as WorkspaceFileData;
}

/** Structural equality of two JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type Repo = WorkspaceFileData["repos"][number];

/**
 * Merge repos by name: an entry I left alone takes theirs; one I edited keeps
 * mine; one either side removed is gone unless the other edited it; both
 * sides' additions stay (theirs in their order, then mine).
 */
function mergeRepos(base: readonly Repo[], mine: readonly Repo[], theirs: readonly Repo[]): Repo[] {
  const byName = (repos: readonly Repo[]) => new Map(repos.map((r) => [deriveRepoName(r.url), r]));
  const b = byName(base);
  const m = byName(mine);
  const t = byName(theirs);
  const merged: Repo[] = [];
  for (const [name, their] of t) {
    const my = m.get(name);
    const was = b.get(name);
    if (my) merged.push(was && sameJson(my, was) ? their : my);
    else if (!was || !sameJson(their, was)) merged.push(their);
  }
  for (const [name, my] of m) {
    if (t.has(name)) continue;
    const was = b.get(name);
    if (!was || !sameJson(my, was)) merged.push(my);
  }
  return merged;
}

/**
 * This window's manifest edits (`mine`, made on `base`, the file as last
 * read) merged with the file on disk now (`theirs`), so a save never erases
 * another writer's changes: a field I left alone takes the disk's value, one
 * I edited keeps mine, repos merge by name, and the layout session is always
 * the disk's (the main process saves it).
 */
export function mergeManifestEdits(
  base: WorkspaceFileData,
  mine: WorkspaceFileData,
  theirs: WorkspaceFileData,
): WorkspaceFileData {
  const get = (d: WorkspaceFileData, k: string) => (d as unknown as Record<string, unknown>)[k];
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    let value: unknown;
    if (WORKSPACE_SESSION_FIELDS.includes(k)) value = get(theirs, k);
    else if (k === "repos")
      value = mergeRepos(base.repos ?? [], mine.repos ?? [], theirs.repos ?? []);
    else value = sameJson(get(mine, k), get(base, k)) ? get(theirs, k) : get(mine, k);
    if (value !== undefined) merged[k] = value;
  }
  return merged as unknown as WorkspaceFileData;
}

/**
 * Produce a full v2 workspace-file object by merging a manifest (the existing
 * `.openp41ge-workspace` content) with the session extracted from a layout
 * `Workspace`. The manifest wins for identity/name/repos; session fields are
 * replaced by the workspace's current state.
 */
export function workspaceToFileData(
  workspace: Workspace,
  manifest: WorkspaceFileData,
): WorkspaceFileData {
  const base = migrateWorkspaceFileData(manifest);
  const session = extractWorkspaceSession(workspace);
  return {
    ...base,
    version: WORKSPACE_FILE_VERSION,
    systemTabs: session.systemTabs,
    editorTabs: session.editorTabs,
    tabGroups: session.tabGroups,
    scopedFolders: session.scopedFolders,
    sharedSidebars: session.sharedSidebars,
    windows: session.windows,
  };
}

/**
 * Rebuild a layout `Workspace` from a workspace-file's session. The manifest
 * fields (repos/name/dataDir) are ignored — the returned Workspace carries only
 * layout state (windows, tabs, sidebars).
 */
export function fileDataToWorkspace(data: WorkspaceFileData): Workspace {
  const migrated = migrateWorkspaceFileData(data);
  const shared = migrated.sharedSidebars ?? emptySharedSidebars();
  return WorkspaceSchema.parse({
    id: data.id,
    windows: migrated.windows ?? [],
    editorTabs: (migrated.editorTabs ?? {}) as Workspace["editorTabs"],
    systemTabs: (migrated.systemTabs ?? {}) as Workspace["systemTabs"],
    tabGroups: (migrated.tabGroups ?? {}) as Workspace["tabGroups"],
    scopedFolders: migrated.scopedFolders ?? [],
    sidebar: {
      leftSidebarTabs: [...(shared.leftSidebarTabs ?? [])],
      rightSidebarTabs: [...(shared.rightSidebarTabs ?? [])],
      leftSidebarOpen: shared.leftSidebarOpen ?? false,
      rightSidebarOpen: shared.rightSidebarOpen ?? false,
    },
  }) as Workspace;
}

/** Serialize a workspace-file object to JSON. */
export function serializeWorkspaceFile(data: WorkspaceFileData): string {
  return JSON.stringify(migrateWorkspaceFileData(data));
}

/** Parse a workspace-file JSON string, migrating to the current version. */
export function deserializeWorkspaceFile(json: string): WorkspaceFileData {
  return migrateWorkspaceFileData(JSON.parse(json));
}
