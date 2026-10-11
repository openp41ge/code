/**
 * System tab operations — open, close, pin, reorder system tabs in sidebars.
 *
 * System tabs are sidebar-based app panels (e.g. the extensions' Explorer, History, Agents).
 * They live in `workspace.systemTabs` and each window has ordered lists of
 * system tab IDs for left and right sidebars.
 *
 * Pinned system tabs are project-wide (visible in all windows).
 * Unpinned system tabs are per-window (only exist in the originating window).
 */

import type { Workspace, SystemTab, SystemTabId, TabId, TabGroupId } from "./types.js";
import { createSystemTab as makeSystemTab } from "./types.js";
import { mapWindow } from "./common.js";
import { removeTabFromCell } from "./tab-operations.js";

// ─── System Tab Registry ─────────────────────────────────────────────────

export function registerSystemTab(workspace: Workspace, tab: SystemTab): Workspace {
  return {
    ...workspace,
    systemTabs: { ...workspace.systemTabs, [tab.id]: tab },
  };
}

// ─── Shared-sidebar helpers ───────────────────────────────────────────────

/** Which sidebar a tab is docked on, or null if it isn't open in any sidebar. */
function findTabSide(workspace: Workspace, tabId: string): "left" | "right" | null {
  if (workspace.sidebar.leftSidebarTabs.includes(tabId as SystemTabId)) return "left";
  if (workspace.sidebar.rightSidebarTabs.includes(tabId as SystemTabId)) return "right";
  return null;
}

function tabListKey(side: "left" | "right"): "leftSidebarTabs" | "rightSidebarTabs" {
  return side === "left" ? "leftSidebarTabs" : "rightSidebarTabs";
}

function openKey(side: "left" | "right"): "leftSidebarOpen" | "rightSidebarOpen" {
  return side === "left" ? "leftSidebarOpen" : "rightSidebarOpen";
}

function activeKey(side: "left" | "right"): "activeLeftTab" | "activeRightTab" {
  return side === "left" ? "activeLeftTab" : "activeRightTab";
}

/** Set a sidebar's shared open/closed state. */
function setSidebarOpen(workspace: Workspace, side: "left" | "right", open: boolean): Workspace {
  return { ...workspace, sidebar: { ...workspace.sidebar, [openKey(side)]: open } };
}

/** Append a tab to a shared sidebar's tab list (idempotent). */
function addTabToSidebar(workspace: Workspace, side: "left" | "right", tabId: string): Workspace {
  const list = workspace.sidebar[tabListKey(side)] as SystemTabId[];
  if (list.includes(tabId as SystemTabId)) return workspace;
  return {
    ...workspace,
    sidebar: { ...workspace.sidebar, [tabListKey(side)]: [...list, tabId as SystemTabId] },
  };
}

/** Remove a tab from a shared sidebar's tab list. */
function removeTabFromSharedSidebar(
  workspace: Workspace,
  side: "left" | "right",
  tabId: string,
): Workspace {
  return {
    ...workspace,
    sidebar: {
      ...workspace.sidebar,
      [tabListKey(side)]: workspace.sidebar[tabListKey(side)].filter(
        (id) => id !== tabId,
      ) as SystemTabId[],
    },
  };
}

// ─── Default sidebar for system tab types ───────────────────────────────

/**
 * Map of system tab appType → default sidebar side.
 * Used when `openSystemTab` is called without an explicit side.
 */
const DEFAULT_SYSTEM_TAB_SIDES: Record<string, "left" | "right"> = {
  explorer: "right",
  git: "right",
  projects: "left",
  search: "left",
};

// ─── Open ─────────────────────────────────────────────────────────────────

/**
 * Open a system tab. If `side` is not provided, the default side for the
 * appType is used. If a tab with the same `appType` already exists in ANY
 * sidebar (left or right) of the current window, it activates the existing
 * tab and opens that sidebar instead of creating a duplicate.
 *
 * The tab is always added to ALL windows (sidebar layout is shared across
 * all windows in a project).
 */
export function openSystemTab(
  workspace: Workspace,
  winId: string,
  side: "left" | "right" | null = null,
  appType?: string,
  title?: string,
  pinned: boolean = false,
): Workspace {
  // Support both old (5-arg) and new (optional-side) calling conventions.
  const actualSide = side === "left" || side === "right" ? side : null;
  const actualAppType = actualSide ? (appType ?? "") : (side ?? "");
  const actualTitle = actualSide ? (title ?? "") : (appType ?? "");
  const actualPinned = actualSide ? pinned : typeof appType === "boolean" ? appType : false;

  const resolvedSide = actualSide ?? DEFAULT_SYSTEM_TAB_SIDES[actualAppType] ?? "right";

  if (!workspace.windows.some((w) => w.id === winId)) return workspace;

  const leftSidebarTabs = workspace.sidebar.leftSidebarTabs;
  const rightSidebarTabs = workspace.sidebar.rightSidebarTabs;
  const allTabIds = [...leftSidebarTabs, ...rightSidebarTabs];

  // If the appType is already open in a sidebar, activate it (and open the
  // shared sidebar, then select it in this window).
  for (const tabId of allTabIds) {
    const existingTab = workspace.systemTabs[tabId as SystemTabId];
    if (existingTab && existingTab.appType === actualAppType) {
      const existingSide = leftSidebarTabs.includes(tabId) ? "left" : "right";
      let result = mapWindow(workspace, winId, (w) => ({
        ...w,
        sidebar: { ...w.sidebar!, [activeKey(existingSide)]: tabId as SystemTabId },
      }));
      result = setSidebarOpen(result, existingSide, true);
      if (!_getTabGroupIdByParent(result, tabId)) {
        const { workspace: r } = createTabGroup(result, tabId);
        result = r;
      }
      return touchSystemTab(result, tabId);
    }
  }

  // Create a new system tab, add it to the shared sidebar, open the sidebar,
  // and make it the active tab in this window.
  const tabId = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` as SystemTabId;
  const tab = makeSystemTab(tabId, actualAppType, actualTitle, actualPinned);
  let result = registerSystemTab(workspace, tab);
  result = addTabToSidebar(result, resolvedSide, tabId);
  result = setSidebarOpen(result, resolvedSide, true);
  result = mapWindow(result, winId, (w) => ({
    ...w,
    sidebar: { ...w.sidebar!, [activeKey(resolvedSide)]: tabId },
  }));
  const { workspace: w } = createTabGroup(result, tabId);
  result = w;

  return touchSystemTab(result, tabId);
}

/**
 * Create a TabGroup for a parent tab and add it to the workspace.
 * The group starts with no children.
 */
export function createTabGroup(
  workspace: Workspace,
  parentTabId: string,
): { workspace: Workspace; groupId: TabGroupId } {
  const groupId = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` as TabGroupId;
  return {
    workspace: {
      ...workspace,
      tabGroups: {
        ...workspace.tabGroups,
        [groupId]: { id: groupId, parentTabId, childTabIds: [] },
      },
    },
    groupId,
  };
}

/**
 * Add a child tab ID to an existing tab group.
 */
export function addToTabGroup(
  workspace: Workspace,
  groupId: string,
  childTabId: string,
): Workspace {
  const gid = groupId as TabGroupId;
  const group = workspace.tabGroups[gid];
  if (!group) return workspace;
  if (group.childTabIds.includes(childTabId)) return workspace;
  return {
    ...workspace,
    tabGroups: {
      ...workspace.tabGroups,
      [gid]: { ...group, childTabIds: [...group.childTabIds, childTabId] },
    },
  };
}

/**
 * Find the TabGroup ID that contains the given tab (either as parent or child).
 */
/**
 * Add a child tab to the group whose parent tab matches hostTabId.
 * If no group exists, creates one. Returns the updated workspace.
 */
export function addChildToParentTab(
  workspace: Workspace,
  hostTabId: string,
  childTabId: string,
): Workspace {
  let result = workspace;
  const gid = _getTabGroupIdByParent(result, hostTabId);
  if (gid) {
    result = addToTabGroup(result, gid, childTabId);
  } else {
    // No group yet — create one (e.g. if openSystemTab wasn't the path used)
    const { workspace: w } = createTabGroup(result, hostTabId);
    result = w;
    const newGid = _getTabGroupIdByParent(result, hostTabId);
    if (newGid) {
      result = addToTabGroup(result, newGid, childTabId);
    }
  }
  return result;
}

/**
 * Find the TabGroup ID that contains the given tab (either as parent or child).
 */
export function getTabGroupIdByTab(workspace: Workspace, tabId: string): TabGroupId | null {
  for (const group of Object.values(workspace.tabGroups)) {
    if (!group) continue;
    if (group.parentTabId === tabId || group.childTabIds.includes(tabId)) {
      return group.id;
    }
  }
  return null;
}

/**
 * Find the TabGroup ID whose parent tab matches the given ID.
 */
function _getTabGroupIdByParent(workspace: Workspace, parentTabId: string): TabGroupId | null {
  for (const group of Object.values(workspace.tabGroups)) {
    if (!group) continue;
    if (group.parentTabId === parentTabId) {
      return group.id;
    }
  }
  return null;
}

/**
 * Check if a tab's group has any open children (children that still exist
 * in editorTabs). Used to prevent closing an unpinned parent tab on defocus.
 */
export function _hasOpenChildren(workspace: Workspace, tabId: string): boolean {
  for (const group of Object.values(workspace.tabGroups)) {
    if (!group) continue;
    if (group.parentTabId === tabId || group.childTabIds.includes(tabId)) {
      // Check if any children still exist in editorTabs
      for (const childId of group.childTabIds) {
        if (workspace.editorTabs[childId as unknown as TabId]) {
          return true;
        }
      }
      return false;
    }
  }
  return false;
}

/**
 * Close a tab group: remove all child tabs from their grid cells and delete
 * the group from the workspace.
 */
export function closeTabGroup(workspace: Workspace, groupId: string): Workspace {
  const gid = groupId as TabGroupId;
  const group = workspace.tabGroups[gid];
  if (!group) return workspace;

  let result = workspace;

  // Remove each child tab from its cell
  for (const childId of group.childTabIds) {
    for (const win of result.windows) {
      const branded = childId as unknown as TabId;
      const placement = win.grid.placements.find((p) => p.tabIds.includes(branded));
      if (placement) {
        result = removeTabFromCell(result, win.id, branded);
      }
    }
  }

  // Delete the group
  const { [gid]: _removed, ...remainingGroups } = result.tabGroups;
  result = { ...result, tabGroups: remainingGroups };

  return result;
}

// ─── Close ────────────────────────────────────────────────────────────────

/**
 * Close a system tab. Removes it from the shared sidebar (the sidebar layout is
 * shared across all windows of a workspace). Deletes the system tab from the
 * registry, and if the tab was active in any window, activate the most recently
 * accessed remaining tab. Also closes any associated editor tabs.
 */
export function closeSystemTab(
  workspace: Workspace,
  winId: string,
  side: "left" | "right",
  tabId: string,
  force: boolean = false,
): Workspace {
  const sid = tabId as SystemTabId;
  const systemTab = workspace.systemTabs[sid];
  if (!systemTab) return workspace;

  let result: Workspace = removeTabFromSharedSidebar(workspace, side, tabId);

  // For each window where the tab was active, activate the next-most-recent tab.
  for (const win of result.windows) {
    const wasActive = win.sidebar?.[activeKey(side)] === sid;
    if (!wasActive) continue;
    const remaining = result.sidebar[tabListKey(side)] as Array<SystemTabId | string>;
    const nextActive = mostRecentlyAccessedSystemTab(result, remaining);
    result = mapWindow(result, win.id, (w) => ({
      ...w,
      sidebar: { ...w.sidebar!, [activeKey(side)]: nextActive },
    }));
  }

  // If no remaining window references the tab, delete it from the registry.
  const stillReferenced =
    (result.sidebar.leftSidebarTabs as SystemTabId[]).includes(sid) ||
    (result.sidebar.rightSidebarTabs as SystemTabId[]).includes(sid);
  if (!stillReferenced) {
    const { [sid]: _removed, ...remainingSysTabs } = result.systemTabs;
    result = { ...result, systemTabs: remainingSysTabs };
  }

  // Guard: refuse to close an unpinned system tab if it has open children,
  // unless force=true (explicit X button close).
  if (!force && !systemTab.pinned) {
    const gid = _getTabGroupIdByParent(result, tabId);
    if (gid) {
      const group = result.tabGroups[gid];
      const hasChildren =
        group && group.childTabIds.some((cid) => result.editorTabs[cid as unknown as TabId]);
      if (hasChildren) {
        return workspace;
      }
    }
  }

  // Close any child tabs in this system tab's group.
  const groupId = _getTabGroupIdByParent(result, tabId);
  if (groupId) {
    result = closeTabGroup(result, groupId);
  }

  return result;
}

// ─── Pin / Unpin ──────────────────────────────────────────────────────────

/**
 * Toggle the pinned state of a system tab. Because the sidebar layout is
 * shared across all windows of a workspace, only the pinned flag changes
 * (pinned tabs survive app restarts; unpinned ones are stripped on save).
 */
export function pinSystemTab(workspace: Workspace, tabId: string, pinned: boolean): Workspace {
  const sid = tabId as SystemTabId;
  const tab = workspace.systemTabs[sid];
  if (!tab) return workspace;
  if (tab.pinned === pinned) return workspace;
  return {
    ...workspace,
    systemTabs: { ...workspace.systemTabs, [sid]: { ...tab, pinned } },
  };
}

// ─── Reorder ──────────────────────────────────────────────────────────────

/**
 * Reorder a system tab within a sidebar's tab list.
 */
export function reorderSystemTab(
  workspace: Workspace,
  _winId: string,
  side: "left" | "right",
  tabId: string,
  newIndex: number,
): Workspace {
  const listKey = tabListKey(side);
  const sidebarTabs = [...workspace.sidebar[listKey]];
  const oldIndex = sidebarTabs.indexOf(tabId as SystemTabId);
  if (oldIndex === -1) return workspace;

  const [moved] = sidebarTabs.splice(oldIndex, 1);
  const clampedIndex = Math.max(0, Math.min(newIndex, sidebarTabs.length));
  sidebarTabs.splice(clampedIndex, 0, moved);

  return { ...workspace, sidebar: { ...workspace.sidebar, [listKey]: sidebarTabs } };
}

// ─── Activate ─────────────────────────────────────────────────────────────

/**
 * Record that a system tab was just made active (last-accessed timestamp).
 * Used by the activation fallback when the active tab leaves a sidebar.
 */
function touchSystemTab(
  workspace: Workspace,
  tabId: string,
  at: string = new Date().toISOString(),
): Workspace {
  const sid = tabId as SystemTabId;
  const tab = workspace.systemTabs[sid];
  if (!tab) return workspace;
  return {
    ...workspace,
    systemTabs: { ...workspace.systemTabs, [sid]: { ...tab, lastAccessedAt: at } },
  };
}

/**
 * Pick the tab to activate next from `tabIds` after the current active tab
 * leaves a sidebar: the remaining tab with the most recent `lastAccessedAt`.
 * Tabs without a timestamp (legacy data) score lowest; if none have one, the
 * first tab in the list is used. Returns null when `tabIds` is empty.
 */
function mostRecentlyAccessedSystemTab(
  workspace: Workspace,
  tabIds: Array<SystemTabId | string>,
): SystemTabId | null {
  if (tabIds.length === 0) return null;

  const parsed = (tabId: SystemTabId | string): number => {
    const last = workspace.systemTabs[tabId as SystemTabId]?.lastAccessedAt;
    if (!last) return -1;
    const n = Date.parse(last);
    return Number.isNaN(n) ? -1 : n;
  };

  let best = tabIds[0] as SystemTabId;
  let bestTime = -1;
  for (const tabId of tabIds) {
    const time = parsed(tabId);
    if (time > bestTime) {
      bestTime = time;
      best = tabId as SystemTabId;
    }
  }
  return best;
}

/**
 * Activate a system tab in a sidebar (set it as the active tab).
 */
export function activateSystemTab(
  workspace: Workspace,
  winId: string,
  side: "left" | "right",
  tabId: string,
): Workspace {
  const activeKey = side === "left" ? ("activeLeftTab" as const) : ("activeRightTab" as const);

  const result = mapWindow(workspace, winId, (w) => ({
    ...w,
    sidebar: {
      ...w.sidebar!,
      [activeKey]: tabId as SystemTabId,
    },
  }));

  return touchSystemTab(result, tabId);
}

// ─── Toggle Sidebar ───────────────────────────────────────────────────────

/**
 * Toggle a sidebar open/closed. If toggling open and there is no active tab,
 * activates the first tab in the sidebar's tab list (if any).
 */
export function toggleSidebar(
  workspace: Workspace,
  winId: string,
  side: "left" | "right",
): Workspace {
  const appWin = workspace.windows.find((w) => w.id === winId);
  if (!appWin) return workspace;

  const isOpen = workspace.sidebar[openKey(side)];
  const newIsOpen = !isOpen;
  const sidebarTabs = workspace.sidebar[tabListKey(side)];
  let newActiveTab = appWin.sidebar?.[activeKey(side)] ?? null;

  // If opening and no active tab, activate the first tab in the list.
  if (newIsOpen && !newActiveTab && sidebarTabs.length > 0) {
    newActiveTab = sidebarTabs[0] as SystemTabId;
  }

  const result = setSidebarOpen(workspace, side, newIsOpen);
  return mapWindow(result, winId, (w) => ({
    ...w,
    sidebar: { ...w.sidebar!, [activeKey(side)]: newActiveTab },
  }));
}

/**
 * Open a sidebar and set the active tab. If no tabId is given and the sidebar
 * has tabs, activates the first one.
 */
export function openSidebar(
  workspace: Workspace,
  winId: string,
  side: "left" | "right",
  tabId?: string,
): Workspace {
  if (!workspace.windows.some((w) => w.id === winId)) return workspace;

  const sidebarTabs = workspace.sidebar[tabListKey(side)];
  let activeTab: SystemTabId | null = tabId ? (tabId as SystemTabId) : null;
  if (!activeTab && sidebarTabs.length > 0) {
    activeTab = sidebarTabs[0] as SystemTabId;
  }

  const result = setSidebarOpen(workspace, side, true);
  return mapWindow(result, winId, (w) => ({
    ...w,
    sidebar: { ...w.sidebar!, [activeKey(side)]: activeTab },
  }));
}

/**
 * Close a sidebar.
 */
export function closeSidebar(
  workspace: Workspace,
  winId: string,
  side: "left" | "right",
): Workspace {
  if (!workspace.windows.some((w) => w.id === winId)) return workspace;
  return setSidebarOpen(workspace, side, false);
}

// ─── Move system tab between sidebars ────────────────────────────────────

/**
 * Move a system tab from one sidebar to the other (or reorder within the same
 * sidebar). Sidebar layout is shared across ALL windows, so the change is
 * applied to every window. Removes the tab from the source sidebar's tab list,
 * inserts it at `dropIndex` in the target sidebar's tab list, activates it,
 * and ensures the target sidebar is open.
 */
export function moveSystemTabToSidebar(
  workspace: Workspace,
  _winId: string,
  tabId: string,
  targetSide: "left" | "right",
  dropIndex: number,
): Workspace {
  const sid = tabId as SystemTabId;
  if (!workspace.systemTabs[sid]) return workspace;

  const sourceSide = findTabSide(workspace, tabId);
  if (!sourceSide) return workspace;

  // The sidebar layout is shared across all windows, so mutate the workspace
  // level sidebar lists once, then adjust per-window active tabs.
  const newLeftTabs = [...workspace.sidebar.leftSidebarTabs];
  const newRightTabs = [...workspace.sidebar.rightSidebarTabs];

  if (sourceSide === "left") {
    const idx = newLeftTabs.indexOf(sid);
    if (idx !== -1) newLeftTabs.splice(idx, 1);
  } else {
    const idx = newRightTabs.indexOf(sid);
    if (idx !== -1) newRightTabs.splice(idx, 1);
  }

  const targetList = targetSide === "left" ? newLeftTabs : newRightTabs;
  const clampedIndex = Math.max(0, Math.min(dropIndex, targetList.length));
  targetList.splice(clampedIndex, 0, sid);

  let result: Workspace = {
    ...workspace,
    sidebar: {
      ...workspace.sidebar,
      leftSidebarTabs: newLeftTabs,
      rightSidebarTabs: newRightTabs,
      [openKey(targetSide)]: true,
    },
  };

  // For each window where the moved tab was the active tab on the source side,
  // activate the most recently accessed remaining tab on that side instead of
  // leaving the source sidebar blank. Always activate the tab on the target side.
  for (const win of workspace.windows) {
    const wSidebar = win.sidebar;
    const movedWasActive =
      (sourceSide === "left" && wSidebar?.activeLeftTab === sid) ||
      (sourceSide === "right" && wSidebar?.activeRightTab === sid);
    const sourceTabsAfter = (sourceSide === "left" ? newLeftTabs : newRightTabs) as Array<
      SystemTabId | string
    >;
    const nextActive = movedWasActive
      ? mostRecentlyAccessedSystemTab(result, sourceTabsAfter)
      : null;

    result = mapWindow(result, win.id, (w) => ({
      ...w,
      sidebar: {
        ...w.sidebar!,
        [activeKey(targetSide)]: sid,
        ...(movedWasActive ? { [activeKey(sourceSide)]: nextActive } : {}),
      },
    }));
  }

  return touchSystemTab(result, sid);
}
