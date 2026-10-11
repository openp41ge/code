/**
 * Serialization — convert workspace to/from JSON.
 */

import type { Workspace, SystemTabId } from "./types.js";
import { WorkspaceSchema } from "./types.js";
import { removeEmptyPlacements } from "./grid-operations.js";
import { migrateLegacyExtensionTabs } from "./legacy-extension-ids.js";
import { migrateLegacyGitTabs } from "./legacy-git-tabs.js";
import {
  migrateLegacyAgentsEditorTabs,
  migrateLegacyAgentsSystemTabs,
} from "./legacy-agents-tabs.js";
import { migrateLegacyExplorerSettingsTabs } from "./legacy-explorer-settings-tabs.js";

/**
 * Migrate a workspace JSON object from old formats to the current format.
 *
 * Old format (pre-2025-07):
 *   window: { id, bounds, monitor, worksets: [{ id, name, grid, sidebar, repoRefs }] }
 *
 * Legacy per-window `repoRefs` (per-window repo visibility) was removed in
 * 2026-08; leftover repoRefs fields in old files are stripped by the schema.
 *
 * Old field name (pre-2026-07):
 *   workspace.tabs → workspace.editorTabs
 */
function migrateWorkspace(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return obj;

  const migrated = { ...obj };

  // Backward compat: rename `tabs` to `editorTabs` if old format
  if ("tabs" in migrated && !("editorTabs" in migrated)) {
    migrated.editorTabs = migrated.tabs;
    delete migrated.tabs;
  }

  if (Array.isArray(migrated.windows)) {
    migrated.windows = migrated.windows.map((win: Record<string, unknown>) => {
      // Already in new format — has grid directly
      if (win.grid) return win;

      // Old format — migrate from worksets
      const worksets = win.worksets as Array<Record<string, unknown>> | undefined;
      if (worksets && worksets.length > 0) {
        const first = worksets[0];
        const { worksets: _ws, ...rest } = win;
        return {
          ...rest,
          grid: first.grid ?? {
            id: `grid-${win.id}`,
            rows: 1,
            cols: 1,
            placements: [],
            dividers: { columns: [], rows: [] },
          },
          sidebar: first.sidebar ?? { activeViewId: null, width: 280 },
        };
      }

      // No worksets and no grid — create empty grid
      const { worksets: _ws, ...rest } = win;
      return {
        ...rest,
        grid: {
          id: `grid-${win.id}`,
          rows: 1,
          cols: 1,
          placements: [],
          dividers: { columns: [], rows: [] },
        },
        sidebar: { activeViewId: null, width: 280 },
      };
    });
  }

  // Lift legacy per-window sidebar shared fields (set/side/open) to the
  // workspace-level sidebar. Before the sidebar split, these lived on each
  // Window.sidebar; now they live once on Workspace.sidebar.
  if (!("sidebar" in migrated) && Array.isArray(migrated.windows)) {
    const first = migrated.windows[0] as Record<string, unknown> | undefined;
    const s = first?.sidebar as Record<string, unknown> | undefined;
    if (s && (Array.isArray(s.leftSidebarTabs) || Array.isArray(s.rightSidebarTabs))) {
      migrated.sidebar = {
        leftSidebarTabs: s.leftSidebarTabs ?? [],
        rightSidebarTabs: s.rightSidebarTabs ?? [],
        leftSidebarOpen: s.leftSidebarOpen ?? false,
        rightSidebarOpen: s.rightSidebarOpen ?? false,
      };
      // Strip the lifted fields from every window's sidebar (keep active + width).
      migrated.windows = migrated.windows.map((win: Record<string, unknown>) => {
        if (win.sidebar) {
          const {
            leftSidebarTabs: _l,
            rightSidebarTabs: _r,
            leftSidebarOpen: _lo,
            rightSidebarOpen: _ro,
            ...restSidebar
          } = win.sidebar as Record<string, unknown>;
          win.sidebar = restSidebar;
        }
        return win;
      });
    }
  }

  // Rewrite app types saved under pre-rename extension ids, and the retired
  // platform git UI's and agents' tabs (now the extensions').
  if (migrated.editorTabs && typeof migrated.editorTabs === "object") {
    migrated.editorTabs = migrateLegacyExplorerSettingsTabs(
      migrateLegacyAgentsEditorTabs(
        migrateLegacyGitTabs(
          migrateLegacyExtensionTabs(migrated.editorTabs as Record<string, unknown>),
        ),
      ),
    );
  }
  if (migrated.systemTabs && typeof migrated.systemTabs === "object") {
    migrated.systemTabs = migrateLegacyAgentsSystemTabs(
      migrateLegacyGitTabs(
        migrateLegacyExtensionTabs(migrated.systemTabs as Record<string, unknown>),
      ),
    );
  }

  return migrated;
}

/**
 * Strip all preview, ephemeral tabs, and unpinned system tabs from the
 * workspace before serialization. Only pinned tabs (both editor and system)
 * should survive app restarts.
 *
 * Returns a new Workspace object (does not mutate the original).
 */
export function stripPreviewTabs(workspace: Workspace): Workspace {
  // Collect preview and ephemeral editor tab IDs to strip
  const idsToStrip = new Set<string>();
  const editorTabsRecord = workspace.editorTabs as Record<string, { isPreview?: boolean }>;
  for (const [tabId, tab] of Object.entries(editorTabsRecord)) {
    if (tab.isPreview) {
      idsToStrip.add(tabId);
    }
  }

  // Collect unpinned system tab IDs to strip
  const systemTabsToStrip = new Set<string>();
  const sysTabsRecord = workspace.systemTabs as Record<string, { pinned?: boolean }> | undefined;
  if (sysTabsRecord) {
    for (const [tabId, tab] of Object.entries(sysTabsRecord)) {
      if (!tab.pinned) {
        systemTabsToStrip.add(tabId);
      }
    }
  }

  // Clone the workspace structure
  let result: Workspace = { ...workspace };

  // Strip editor tabs and empty placements
  if (idsToStrip.size > 0) {
    result = {
      ...result,
      windows: result.windows.map((win) => {
        const grid = {
          ...win.grid,
          placements: win.grid.placements.map((pl) => {
            const remainingTabIds = pl.tabIds.filter((id) => !idsToStrip.has(id));

            if (remainingTabIds.length === 0) {
              return { ...pl, tabIds: [], activeTabId: undefined };
            }

            const newActiveTabId =
              pl.activeTabId && idsToStrip.has(pl.activeTabId)
                ? remainingTabIds[0]
                : pl.activeTabId;

            return { ...pl, tabIds: remainingTabIds, activeTabId: newActiveTabId };
          }),
        };
        return { ...win, grid: removeEmptyPlacements(grid) };
      }),
      editorTabs: Object.fromEntries(
        Object.entries(result.editorTabs).filter(([id]) => !idsToStrip.has(id)),
      ),
    };
  }

  // Strip unpinned system tabs
  if (systemTabsToStrip.size > 0) {
    // Rebuild the systemTabs record without unpinned tabs
    const remainingSysTabs: Record<string, unknown> = {};
    for (const id of Object.keys(result.systemTabs)) {
      if (!systemTabsToStrip.has(id)) {
        remainingSysTabs[id] = result.systemTabs[id as SystemTabId];
      }
    }

    // Also remove unpinned system tab IDs from the shared workspace sidebar lists
    const sharedSidebar = {
      ...result.sidebar,
      leftSidebarTabs: result.sidebar.leftSidebarTabs.filter(
        (id) => !systemTabsToStrip.has(id as string),
      ),
      rightSidebarTabs: result.sidebar.rightSidebarTabs.filter(
        (id) => !systemTabsToStrip.has(id as string),
      ),
    };

    // Clear per-window active tabs that point at now-stripped system tabs.
    const cleanedWindows = result.windows.map((win) => ({
      ...win,
      sidebar: {
        ...win.sidebar,
        activeLeftTab:
          win.sidebar?.activeLeftTab && systemTabsToStrip.has(win.sidebar.activeLeftTab as string)
            ? null
            : (win.sidebar?.activeLeftTab ?? null),
        activeRightTab:
          win.sidebar?.activeRightTab && systemTabsToStrip.has(win.sidebar.activeRightTab as string)
            ? null
            : (win.sidebar?.activeRightTab ?? null),
      },
    }));

    result = {
      ...result,
      systemTabs: remainingSysTabs,
      sidebar: sharedSidebar,
      windows: cleanedWindows,
    } as unknown as Workspace;
  }

  return result;
}

export function serialize(workspace: Workspace): string {
  const cleaned = stripPreviewTabs(workspace);
  return JSON.stringify(cleaned);
}

export function deserialize(json: string): Workspace {
  const parsed = JSON.parse(json);
  const migrated = migrateWorkspace(parsed);
  return WorkspaceSchema.parse(migrated);
}
