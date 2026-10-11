/**
 * File operations — actionOpenFile, actionAddTab.
 *
 * Works at the window level. Preview logic lives in cell-operations.ts.
 */

import type { Workspace } from "./types.js";
import { createTab, createWindow, type TabId } from "./types.js";
import { registerTab, addTabToCell, addColumnTab } from "./tab-operations.js";
import { makeTabId, mapGridInWindow } from "./common.js";
import { resizeGrid, findEmptyCell } from "./grid-operations.js";
import { openTabInCell } from "./cell-operations.js";

export function actionAddTab(
  workspace: Workspace,
  windowId: string,
  tabId: string,
  appType: string,
): Workspace {
  const tab = createTab(tabId, appType, appType.replace("-", " "));
  let result = registerTab(workspace, tab);

  const win = result.windows.find((w) => w.id === windowId);
  if (!win) return result;

  const grid = win.grid;
  const occupiedCells = grid.placements.length;
  const totalCells = grid.rows * grid.cols;

  if (occupiedCells >= totalCells) {
    result = resizeGrid(result, windowId, grid.rows + 1, grid.cols);
  }

  const updatedGrid = result.windows.find((w) => w.id === windowId)!.grid;
  const cell = findEmptyCell(updatedGrid);
  if (cell) {
    return addTabToCell(result, windowId, tab, cell.row, cell.col);
  }
  return result;
}

/**
 * Open a file in the workspace.
 *
 * @param pinned - true for permanent (edit) tab, false for preview tab.
 *   Preview tabs are managed by the per-cell preview slot system.
 */
export function actionOpenFile(
  workspace: Workspace,
  windowId: string,
  appType: string,
  fileName?: string,
  filePath?: string,
  targetCol?: number,
  pinned: boolean = true,
  extraConfig?: Record<string, unknown>,
  insertAt?: number | null,
): Workspace {
  let result = workspace;

  // If no target column, find an existing cell with the same app type
  if (targetCol === undefined) {
    const win = result.windows.find((w) => w.id === windowId);
    if (win) {
      for (const pl of win.grid.placements) {
        const hasFileViewer = pl.tabIds.some(
          (tid) => result.editorTabs[tid]?.appType === "file-viewer",
        );
        if (hasFileViewer) {
          targetCol = pl.position.col;
          break;
        }
      }
    }
  }

  if (targetCol !== undefined) {
    return openTabInCell(
      result,
      windowId,
      appType,
      fileName || appType.replace("-", " "),
      filePath,
      targetCol,
      pinned,
      extraConfig,
      insertAt,
    );
  }

  return addColumnTab(result, windowId, appType, fileName, filePath);
}

/**
 * Open a file by splitting the grid at a column boundary.
 *
 * Inserts a new column at the split position and opens the file there.
 *
 * @param splitCol - The column to split relative to.
 * @param splitLeft - If true, the new column goes to the left of splitCol;
 *   if false, to the right.
 */
export function splitFileOpen(
  workspace: Workspace,
  windowId: string,
  appType: string,
  fileName?: string,
  filePath?: string,
  splitCol?: number,
  splitLeft?: boolean,
  extraConfig?: Record<string, unknown>,
): Workspace {
  const win = workspace.windows.find((w) => w.id === windowId);
  if (!win) return workspace;

  // An empty grid has nothing to split against — a boundary drop must simply
  // fill the single full-width column at col 0, not create an empty adjacent
  // cell (e.g. the file landing in a new right column beside a blank left one).
  const hasTabs = win.grid.placements.some((p) => p.tabIds.length > 0);
  if (!hasTabs) {
    return actionOpenFile(workspace, windowId, appType, fileName, filePath, 0, true, extraConfig);
  }

  const col = splitCol ?? 0;
  const left = splitLeft ?? true;
  const newCol = left ? col : col + 1;

  const tabId = makeTabId();
  const config: Record<string, unknown> = { ...extraConfig };
  if (filePath) config.filePath = filePath;
  const tab = createTab(tabId, appType, fileName || appType.replace("-", " "), config);

  let result = registerTab(workspace, tab);

  // Shift placements at or after newCol to the right
  result = mapGridInWindow(result, windowId, (grid) => {
    const shifted = grid.placements.map((p) => {
      if (p.position.row !== 0) return p;
      if (p.position.col >= newCol) {
        return { ...p, position: { ...p.position, col: p.position.col + 1 } };
      }
      return p;
    });

    // Insert the new placement at newCol
    const newPlacement = {
      tabIds: [tabId as TabId],
      activeTabId: tabId as TabId,
      position: { row: 0, col: newCol },
      span: { rowSpan: 1, colSpan: 1 },
    };
    shifted.splice(newCol, 0, newPlacement);

    // Update column dividers: insert a midpoint divider
    const oldColDividers = grid.dividers?.columns ?? [];
    const leftBound = oldColDividers[col - 1] ?? 0;
    const rightBound = oldColDividers[col] ?? 1;
    const midDivider = (leftBound + rightBound) / 2;
    const newColDividers = [...oldColDividers];
    newColDividers.splice(newCol, 0, midDivider);

    return {
      id: grid.id,
      rows: grid.rows,
      cols: grid.cols + 1,
      placements: shifted,
      dividers: { columns: newColDividers, rows: grid.dividers?.rows ?? [] },
    };
  });

  return result;
}

/**
 * Open a file in a new window.
 *
 * Creates a new window, creates a file-viewer tab, and opens the file.
 * Used by cross-window file drag-and-drop when the file is dropped
 * outside any existing window.
 */
export function actionOpenFileInNewWindow(
  workspace: Workspace,
  filePath: string,
  fileName?: string,
  sourceWinId?: string,
): Workspace {
  const tabId = makeTabId();
  const name = fileName || filePath.split("/").filter(Boolean).pop() || "file";
  const config: Record<string, unknown> = { filePath };
  const tab = createTab(tabId, "file-viewer", name, config);

  let result = registerTab(workspace, tab);

  // Create a new window
  const newWinId = `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Copy the source window's non-editor chrome — its sidebar tabs (Explorer,
  // Git, …) and repo list — so the new window feels like the original window.
  // Only the central grid is per-window: it starts with just the dropped file.
  const source = sourceWinId ? workspace.windows.find((w) => w.id === sourceWinId) : undefined;
  const base = createWindow(newWinId);
  // Copy the source window's per-window sidebar state (active tab + width). The
  // sidebar *set/side/open* is shared at the workspace level, so the new window
  // picks that up automatically.
  const win = {
    ...base,
    ...(source
      ? {
          sidebar: {
            ...base.sidebar,
            ...source.sidebar,
          },
        }
      : {}),
  };
  result = { ...result, windows: [...result.windows, win] };

  // Add the tab to the new window's grid
  return addTabToCell(result, newWinId, tab, 0, 0);
}
