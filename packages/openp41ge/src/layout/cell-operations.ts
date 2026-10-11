/**
 * Cell-level tab operations — preview slot management, pinning, preview replacement.
 *
 * Owned by the Openp41ge platform. Preview tab logic lives here, not in individual
 * pane-type packages (openp41ge-file-editor, openp41ge-git-repository, etc.).
 *
 * Key concepts:
 *   - Each cell has at most one preview slot (a tab with isPreview=true)
 *   - Open with pinned=true → creates a regular tab, doesn't touch the preview slot
 *   - Open with pinned=false → interacts with the preview slot (fills or replaces)
 *   - Dragging a tab always pins it (drag = intentional)
 *   - A cell never holds the same file twice (pinned or preview): opening a file
 *     already in the target cell activates that tab (pinning it when opened
 *     pinned) instead of adding another
 */

import type { Workspace, Tab, TabId } from "./types.js";
import { makeTabId, mapGridInWindow } from "./common.js";
import {
  registerTab,
  addTabToCell,
  findFileTabInCell,
  focusFileTabInCell,
} from "./tab-operations.js";
import { resizeGrid } from "./grid-operations.js";
import { createTab } from "./types.js";
import { addChildToParentTab } from "./system-tab-operations.js";

/**
 * Open a tab in a cell, respecting the preview slot.
 *
 * @param pinned - If true, the tab is added as a regular tab (preview slot untouched).
 *                 If false, the tab replaces the existing preview slot occupant (if any),
 *                 or becomes the new preview slot occupant.
 * @param insertAt - Tab-bar index to place the tab at (a drop on the tab bar).
 *                 Omitted → appended (or the preview slot, for an unpinned open).
 * @returns The workspace with the tab opened.
 */
export function openTabInCell(
  workspace: Workspace,
  windowId: string,
  appType: string,
  title: string,
  filePath?: string,
  targetCol?: number,
  pinned: boolean = true,
  config?: Record<string, unknown>,
  insertAtArg?: number | null,
): Workspace {
  // Args arrive over a JSON IPC round-trip, where an omitted (undefined) arg
  // becomes null — only a real non-negative number is a tab-bar position.
  const insertAt = typeof insertAtArg === "number" && insertAtArg >= 0 ? insertAtArg : undefined;
  if (filePath) {
    const existing = findFileTabInCell(workspace, windowId, targetCol ?? 0, appType, filePath);
    if (existing) {
      return focusFileTabInCell(workspace, windowId, targetCol ?? 0, existing, pinned, insertAt);
    }
  }

  const tabId = makeTabId();
  const mergedConfig: Record<string, unknown> = { ...config };
  if (filePath) mergedConfig.filePath = filePath;
  const tab = createTab(tabId, appType, title, mergedConfig, !pinned);
  let result = registerTab(workspace, tab);

  // Determine target column
  const col = targetCol ?? 0;

  // Ensure grid has enough columns
  const win = result.windows.find((w) => w.id === windowId);
  if (win && col >= win.grid.cols) {
    result = resizeGrid(result, windowId, 1, col + 1);
  }

  let result2: Workspace;
  if (pinned || insertAt !== undefined) {
    // Pinned (or dropped at a tab-bar position): add as a regular tab at
    // `insertAt` (appended when omitted); don't touch the preview slot.
    result2 = addTabToCell(result, windowId, tab, 0, col, insertAt);
  } else {
    // Unpinned: interact with preview slot
    const existingPreviewTabId = findPreviewTabInCell(result, windowId, col);
    if (existingPreviewTabId) {
      // Replace existing preview tab
      result2 = replaceTabInCell(result, windowId, col, existingPreviewTabId, tab);
    } else {
      // No preview in this cell — create new tab and mark as preview
      result2 = addTabToCell(result, windowId, tab, 0, col);
    }
  }

  // Add to tab group if config specifies a host tab (parent tab ID)
  const hostTabId = config?.hostTabId as string | undefined;
  if (hostTabId) {
    result2 = addChildToParentTab(result2, hostTabId, tabId);
  }

  return result2;
}

/**
 * Pin a preview tab — remove its preview status so it becomes a regular tab.
 */
export function pinTabInCell(
  workspace: Workspace,
  windowId: string,
  cellCol: number,
  tabId: string,
): Workspace {
  return updateTabInCell(workspace, windowId, cellCol, tabId, { isPreview: false });
}

/**
 * Open a tab in the cell immediately to the RIGHT of the cell that holds
 * `sourceTabId`, creating a new column (a "next cell") when the source is
 * already the rightmost occupied cell.
 *
 * Used by an extension's `openTab` with `placement: "next-column"` (e.g. a
 * commit's file opening its diff beside it). The target row is row 0 (the app's
 * column-based split model), so a source in a lower row still opens in the
 * rightmost column.
 *
 * @param pinned - false → the tab opens as an unpinned preview (fills or
 *   replaces the cell's preview slot); true → a regular pinned tab.
 */
export function openTabInNextCell(
  workspace: Workspace,
  windowId: string,
  sourceTabId: string,
  appType: string,
  title: string,
  filePath?: string,
  pinned: boolean = false,
  config?: Record<string, unknown>,
): Workspace {
  const win = workspace.windows.find((w) => w.id === windowId);
  if (!win) return workspace;

  const source = win.grid.placements.find((p) => p.tabIds.includes(sourceTabId as TabId));
  if (!source) return workspace;

  const col = source.position.col;
  const targetCol = col + 1;

  let result = workspace;
  // If there's no column to the right yet, insert one AFTER the source so the
  // source stays put and the result opens beside it. `insertGridColumn(col)`
  // would instead insert at the SOURCE's index and shift the source into the
  // new column — leaving the first cell empty with both tabs in the second.
  if (targetCol >= win.grid.cols) {
    result = insertEmptyColumnAfter(result, windowId, col);
  }

  return openTabInCell(result, windowId, appType, title, filePath, targetCol, pinned, config);
}

/**
 * Insert a new EMPTY column immediately to the right of `col`, splitting that
 * column's width, WITHOUT shifting the source column (the source stays at
 * `col`, the new empty column lands at `col + 1`). Mirrors the divider math in
 * `splitFileOpen` so the new cell gets a real midpoint divider even when there
 * are no existing column dividers.
 */
function insertEmptyColumnAfter(workspace: Workspace, windowId: string, col: number): Workspace {
  const newCol = col + 1;
  return mapGridInWindow(workspace, windowId, (grid) => {
    const shifted = grid.placements.map((p) => {
      if (p.position.row !== 0) return p;
      if (p.position.col >= newCol) {
        return { ...p, position: { ...p.position, col: p.position.col + 1 } };
      }
      return p;
    });

    const oldColDividers = grid.dividers?.columns ?? [];
    const leftBound = oldColDividers[col - 1] ?? 0;
    const rightBound = oldColDividers[col] ?? 1;
    const midDivider = (leftBound + rightBound) / 2;
    const newColDividers = [...oldColDividers];
    newColDividers.splice(newCol, 0, midDivider);

    return {
      ...grid,
      cols: grid.cols + 1,
      placements: shifted,
      dividers: { columns: newColDividers, rows: grid.dividers?.rows ?? [] },
    };
  });
}

/**
 * Toggle the ephemeral pin state on an ephemeral tab.
 * When pinned, the ephemeral tab survives defocus (won't auto-close).
 * When unpinned, it closes on defocus.
 */
/**
 * Find the preview tab in a specific cell, or null if none.
 */
export function findPreviewTabInCell(
  workspace: Workspace,
  windowId: string,
  col: number,
): string | null {
  const win = workspace.windows.find((w) => w.id === windowId);
  if (!win) return null;

  const pl = win.grid.placements.find((p) => p.position.row === 0 && p.position.col === col);
  if (!pl) return null;

  for (const tabId of pl.tabIds) {
    const tab = workspace.editorTabs[tabId as TabId];
    if (tab && tab.isPreview) {
      return tabId as string;
    }
  }
  return null;
}

// ── Internal helpers ─────────────────────────────────────────────────────

/**
 * Replace a tab in a cell with a new tab. The old tab is removed from
 * the workspace, the new tab is registered and added at the same position.
 */
function replaceTabInCell(
  workspace: Workspace,
  windowId: string,
  col: number,
  oldTabId: string,
  newTab: Tab,
): Workspace {
  // Register the new tab
  let result = workspace;
  if (!result.editorTabs[newTab.id as TabId]) {
    result = registerTab(result, newTab);
  }

  // Replace in-place in the placement: swap oldTabId for newTab.id.
  // Do NOT use removeTabFromCell which would compact the grid and shift
  // other placements — we just swap the tab ID in the placement directly.
  result = mapGridInWindow(result, windowId, (grid) => ({
    ...grid,
    placements: grid.placements.map((pl) => {
      if ((pl.tabIds as string[]).includes(oldTabId)) {
        return {
          ...pl,
          tabIds: (pl.tabIds as TabId[]).map((id) => (id === oldTabId ? (newTab.id as TabId) : id)),
          activeTabId: newTab.id as TabId,
        };
      }
      return pl;
    }),
  }));

  // Remove the old tab from workspace registry
  const oldTid = oldTabId as TabId;
  if (result.editorTabs[oldTid]) {
    const { [oldTid]: _removed, ...remainingTabs } = result.editorTabs;
    result = { ...result, editorTabs: remainingTabs };
  }

  return result;
}

/**
 * Update a tab's fields in place in the workspace state.
 */
function updateTabInPlace(
  workspace: Workspace,
  tabId: string,
  updates: Partial<Pick<Tab, "isPreview" | "title" | "config">>,
): Workspace {
  const existing = workspace.editorTabs[tabId as TabId];
  if (!existing) return workspace;
  return {
    ...workspace,
    editorTabs: {
      ...workspace.editorTabs,
      [tabId as TabId]: { ...existing, ...updates },
    },
  };
}

/**
 * Update a tab that is in a specific cell.
 */
function updateTabInCell(
  workspace: Workspace,
  windowId: string,
  cellCol: number,
  tabId: string,
  updates: Partial<Pick<Tab, "isPreview" | "title" | "config">>,
): Workspace {
  return updateTabInPlace(workspace, tabId, updates);
}
