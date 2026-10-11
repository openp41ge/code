/**
 * Common helpers shared across layout operations.
 *
 * Generic workspace tree traversal and utility functions.
 */

import type { Workspace, Window, Grid, Tab, TabId } from "./types.js";

// ─── Tree traversal ───────────────────────────────────────────────────────

export function mapWindow(
  workspace: Workspace,
  windowId: string,
  fn: (win: Window) => Window | null,
): Workspace {
  return {
    ...workspace,
    windows: workspace.windows
      .map((w) => (w.id === windowId ? fn(w) : w))
      .filter((w): w is Window => w !== null),
  };
}

export function mapGridInWindow(
  workspace: Workspace,
  windowId: string,
  fn: (grid: Grid) => Grid,
): Workspace {
  return mapWindow(workspace, windowId, (win) => ({
    ...win,
    grid: fn(win.grid),
  }));
}

// ─── Lookup helpers ────────────────────────────────────────────────────────

export function findTabLocation(workspace: Workspace, tabId: string): { windowId: string } | null {
  for (const win of workspace.windows) {
    if (win.grid.placements.some((p) => p.tabIds.includes(tabId as TabId))) {
      return { windowId: win.id };
    }
    for (const overlay of win.overlays) {
      if (overlay.tab.id === tabId) {
        return { windowId: win.id };
      }
    }
  }
  return null;
}

export function getTabById(workspace: Workspace, tabId: string): Tab | null {
  const tab = (workspace.editorTabs as Record<string, Tab | undefined>)[tabId];
  if (tab) return tab;
  for (const win of workspace.windows) {
    for (const overlay of win.overlays) {
      if (overlay.tab.id === tabId) return overlay.tab;
    }
  }
  return null;
}

// ─── ID generation ────────────────────────────────────────────────────────

export function makeTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Drag helpers ─────────────────────────────────────────────────────────

export function findSrcColumn(workspace: Workspace, sourceWindowId: string, tabId: string): number {
  const srcWin = workspace.windows.find((w) => w.id === sourceWindowId);
  if (!srcWin) return -1;
  const srcPl = srcWin.grid.placements.find((p) => p.tabIds.includes(tabId as TabId));
  if (!srcPl) return -1;
  return srcPl.position.col;
}

export function computeNewActiveId(
  currentActiveId: TabId,
  tabId: TabId,
  remainingTabIds: TabId[],
): TabId {
  if (currentActiveId === tabId) {
    return remainingTabIds[0] ?? tabId;
  }
  return currentActiveId ?? tabId;
}
