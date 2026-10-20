/**
 * Tab operations — add, remove, reorder, move tabs within cells.
 *
 * All operations work at the window level — there are no worksets.
 * Each window has a single grid that holds all tab placements.
 */

import type { Workspace, Tab, TabId } from "./types.js";
import { createTab as makeTab, setActiveTabInCell } from "./types.js";
import {
  findEmptyCell,
  compactGrid,
  insertGridColumn,
  resizeGrid,
  equalizeColumns,
} from "./grid-operations.js";
import {
  mapGridInWindow,
  makeTabId,
  findTabLocation,
  getTabById,
  computeNewActiveId,
} from "./common.js";

export function registerTab(workspace: Workspace, tab: Tab): Workspace {
  return {
    ...workspace,
    editorTabs: { ...workspace.editorTabs, [tab.id]: tab },
  };
}

export function addTabToCell(
  workspace: Workspace,
  windowId: string,
  tab: Tab,
  row: number,
  col: number,
  insertAt?: number,
): Workspace {
  let result = workspace;
  if (!result.editorTabs[tab.id]) {
    result = registerTab(result, tab);
  }

  return mapGridInWindow(result, windowId, (grid) => {
    const existing = grid.placements.find((p) => p.position.row === row && p.position.col === col);
    if (existing) {
      const newTabIds =
        insertAt !== undefined && insertAt >= 0 && insertAt <= existing.tabIds.length
          ? ([
              ...existing.tabIds.slice(0, insertAt),
              tab.id as TabId,
              ...existing.tabIds.slice(insertAt),
            ] as TabId[])
          : ([...existing.tabIds, tab.id as TabId] as TabId[]);
      return {
        ...grid,
        placements: grid.placements.map((p) =>
          p.position.row === row && p.position.col === col
            ? {
                ...p,
                tabIds: newTabIds,
                activeTabId: tab.id as TabId,
              }
            : p,
        ),
      };
    }

    // Empty cell at requested position — create new placement there
    if (row < grid.rows && col < grid.cols) {
      return {
        ...grid,
        placements: [
          ...grid.placements,
          {
            tabIds: [tab.id as TabId],
            activeTabId: tab.id as TabId,
            position: { row, col },
            span: { rowSpan: 1, colSpan: 1 },
          },
        ],
      };
    }
    // Requested position out of bounds — find first empty cell
    const empty = findEmptyCell(grid);
    if (!empty) return grid;
    return {
      ...grid,
      placements: [
        ...grid.placements,
        {
          tabIds: [tab.id as TabId],
          activeTabId: tab.id as TabId,
          position: empty,
          span: { rowSpan: 1, colSpan: 1 },
        },
      ],
    };
  });
}

/** App types whose `config.filePath` is a real identity: a file, a log stream
 *  (`log:<system>`), a settings editor (`config:<id>`), a release
 *  (`release:<tag>`) — and every extension tab (`ext:…`), whose `filePath` is
 *  the key it was opened with (`OpenTabRequest.key`). Other apps reuse the
 *  slot for non-unique data (e.g. git tabs store the repo name for every
 *  worktree tab), so the no-duplicate rule applies to these only. */
const FILE_APP_TYPES: ReadonlySet<string> = new Set([
  "file-viewer",
  "log-viewer",
  "config-editor",
  "release",
]);

/**
 * The tab in cell (row 0, `col`) already showing `filePath` with `appType`,
 * if any — a cell never holds the same file twice (pinned or preview).
 * Always null for other app types.
 */
export function findFileTabInCell(
  workspace: Workspace,
  windowId: string,
  col: number,
  appType: string,
  filePath: string,
  excludeTabId?: string,
): TabId | null {
  if (!FILE_APP_TYPES.has(appType) && !appType.startsWith("ext:")) return null;
  const win = workspace.windows.find((w) => w.id === windowId);
  const placement = win?.grid.placements.find(
    (p) => p.position.row === 0 && p.position.col === col,
  );
  if (!placement) return null;
  for (const id of placement.tabIds) {
    if (id === excludeTabId) continue;
    const tab = workspace.editorTabs[id];
    if (tab?.appType === appType && tab.config?.filePath === filePath) return id;
  }
  return null;
}

/**
 * Focus an existing file tab instead of adding a duplicate: activate it, pin
 * it when `pin` (an intentional open/drag), and move it to `insertAt` when
 * given (a drop on the tab bar).
 */
export function focusFileTabInCell(
  workspace: Workspace,
  windowId: string,
  col: number,
  tabId: TabId,
  pin: boolean,
  insertAt?: number,
): Workspace {
  let result = workspace;
  const tab = result.editorTabs[tabId];
  if (pin && tab?.isPreview) {
    result = {
      ...result,
      editorTabs: { ...result.editorTabs, [tabId]: { ...tab, isPreview: false } },
    };
  }
  return mapGridInWindow(result, windowId, (grid) => ({
    ...grid,
    placements: grid.placements.map((p) => {
      if (p.position.row !== 0 || p.position.col !== col) return p;
      let tabIds = p.tabIds;
      if (insertAt !== undefined && insertAt >= 0) {
        const from = tabIds.indexOf(tabId);
        const rest = tabIds.filter((id) => id !== tabId);
        // An index past the tab's old slot shifts left by one once it is removed.
        const to = Math.min(insertAt > from ? insertAt - 1 : insertAt, rest.length);
        tabIds = [...rest.slice(0, to), tabId, ...rest.slice(to)];
      }
      return { ...p, tabIds, activeTabId: tabId };
    }),
  }));
}

export function removeTabFromCell(
  workspace: Workspace,
  windowId: string,
  tabId: string,
  focusTabId?: string,
): Workspace {
  const grid = workspace.windows.find((w) => w.id === windowId)?.grid;
  if (!grid) return workspace;

  const placement = grid.placements.find((p) => p.tabIds.includes(tabId as TabId));
  if (!placement) return workspace;

  if (placement.tabIds.length > 1) {
    const filtered = placement.tabIds.filter((id) => id !== tabId);
    let newActiveId: TabId;
    if (focusTabId && (filtered as TabId[]).includes(focusTabId as TabId)) {
      newActiveId = focusTabId as TabId;
    } else {
      newActiveId = filtered[0] as TabId;
    }

    return mapGridInWindow(workspace, windowId, (grid) => ({
      ...grid,
      placements: grid.placements.map((p) => {
        if (!p.tabIds.includes(tabId as TabId)) return p;
        return {
          ...p,
          tabIds: filtered,
          activeTabId: newActiveId as TabId,
        };
      }),
    }));
  }

  return mapGridInWindow(workspace, windowId, (grid) =>
    compactGrid({
      ...grid,
      placements: grid.placements.filter((p) => !p.tabIds.includes(tabId as TabId)),
    }),
  );
}

export function switchTabInCell(
  workspace: Workspace,
  windowId: string,
  tabId: string,
  row: number,
  col: number,
): Workspace {
  return mapGridInWindow(workspace, windowId, (grid) => ({
    ...grid,
    placements: grid.placements.map((pl) => {
      if (pl.position.row === row && pl.position.col === col) {
        return setActiveTabInCell(pl, tabId as TabId);
      }
      return pl;
    }),
  }));
}

export function reorderTabsInCell(
  workspace: Workspace,
  windowId: string,
  row: number,
  col: number,
  fromIdx: number,
  toIdx: number,
): Workspace {
  return mapGridInWindow(workspace, windowId, (grid) => ({
    ...grid,
    placements: grid.placements.map((p) => {
      if (p.position.row === row && p.position.col === col) {
        const tabs = [...p.tabIds];
        const [moved] = tabs.splice(fromIdx, 1);
        tabs.splice(toIdx, 0, moved);
        return { ...p, tabIds: tabs, activeTabId: moved };
      }
      return p;
    }),
  }));
}

export function renameTabOp(workspace: Workspace, tabId: string, newTitle: string): Workspace {
  const tab = getTabById(workspace, tabId);
  if (!tab) return workspace;
  return {
    ...workspace,
    editorTabs: {
      ...workspace.editorTabs,
      [tabId as TabId]: { ...tab, title: newTitle },
    },
  };
}

export function moveTabBetweenCells(
  workspace: Workspace,
  sourceWindowId: string,
  tabId: string,
  targetWindowId: string,
  targetRow: number,
  targetCol: number,
  insertAt?: number,
  focusTabId?: string,
): Workspace {
  let result = removeTabFromCell(workspace, sourceWindowId, tabId, focusTabId);
  const tab = result.editorTabs[tabId as TabId];
  if (!tab) return workspace;

  // If the source cell was the last tab in its column AND was removed,
  // compactGrid shifted all columns to the right of the source column
  // left by 1. Adjust targetCol if it was to the right of the source.
  const sourceGrid = workspace.windows.find((w) => w.id === sourceWindowId)?.grid;
  const sourcePlacement = sourceGrid?.placements.find((p) =>
    (p.tabIds as string[]).includes(tabId),
  );
  const sourceCol = sourcePlacement?.position.col;
  const resultGrid = result.windows.find((w) => w.id === targetWindowId)?.grid;
  if (
    sourceWindowId === targetWindowId &&
    sourceCol !== undefined &&
    resultGrid &&
    sourceGrid &&
    resultGrid.cols < sourceGrid.cols &&
    targetCol > sourceCol
  ) {
    targetCol -= 1;
  }

  // A cell never holds the same file twice: moving a file tab into a cell that
  // already shows that file merges into the existing tab (dropped at
  // `insertAt`), mirroring the grid's same-file drop (`isSameFilePathInCell`).
  const filePath = tab.config?.filePath;
  if (targetRow === 0 && typeof filePath === "string") {
    const existing = findFileTabInCell(
      result,
      targetWindowId,
      targetCol,
      tab.appType,
      filePath,
      tabId,
    );
    if (existing) {
      const at = typeof insertAt === "number" && insertAt >= 0 ? insertAt : undefined;
      return focusFileTabInCell(result, targetWindowId, targetCol, existing, true, at);
    }
  }

  return addTabToCell(result, targetWindowId, tab, targetRow, targetCol, insertAt);
}

export function splitTabFromCell(
  workspace: Workspace,
  windowId: string,
  tabId: string,
  sourceCol: number,
  splitLeft: boolean,
  focusTabId?: string,
): Workspace {
  const grid = workspace.windows.find((w) => w.id === windowId)?.grid;
  if (!grid) return workspace;

  let actualSourceCol = sourceCol;
  let sourcePl = grid.placements.find((p) => p.position.row === 0 && p.position.col === sourceCol);
  if (!sourcePl || !(sourcePl.tabIds as string[]).includes(tabId)) {
    sourcePl = grid.placements.find((p) => (p.tabIds as string[]).includes(tabId));
    if (!sourcePl) return workspace;
    actualSourceCol = sourcePl.position.col;
  }

  const tab = workspace.editorTabs[tabId as TabId];
  if (!tab) return workspace;

  const remainingTabIds = (sourcePl.tabIds as TabId[]).filter((id) => id !== tabId);
  if (remainingTabIds.length === 0) {
    const newCol = splitLeft ? sourceCol : sourceCol + 1;
    return mapGridInWindow(workspace, windowId, (grid) => {
      const compacted: typeof grid.placements = [];
      for (const p of grid.placements) {
        if (p.position.row !== 0) {
          compacted.push(p);
          continue;
        }
        if (p.position.col === actualSourceCol) continue;
        if (p.position.col > actualSourceCol) {
          compacted.push({ ...p, position: { ...p.position, col: p.position.col - 1 } });
        } else {
          compacted.push(p);
        }
      }
      const adjustedNewCol = newCol > actualSourceCol ? newCol - 1 : newCol;
      const shifted = compacted.map((p) => {
        if (p.position.row !== 0) return p;
        if (p.position.col >= adjustedNewCol) {
          return { ...p, position: { ...p.position, col: p.position.col + 1 } };
        }
        return p;
      });
      shifted.push({
        tabIds: [tabId as TabId],
        activeTabId: tabId as TabId,
        position: { row: 0, col: adjustedNewCol },
        span: { rowSpan: 1, colSpan: 1 },
      });
      const oldColDividers = grid.dividers.columns;
      const leftBound = oldColDividers[sourceCol - 1] ?? 0;
      const rightBound = oldColDividers[sourceCol] ?? 1;
      const midDivider = (leftBound + rightBound) / 2;
      const newColDividers = [...oldColDividers];
      newColDividers.splice(sourceCol, 0, midDivider);
      let removeAt = actualSourceCol + (actualSourceCol >= sourceCol ? 1 : 0);
      if (removeAt >= newColDividers.length) removeAt = newColDividers.length - 1;
      newColDividers.splice(removeAt, 1);
      return equalizeColumns({
        ...grid,
        // One column was removed (source cell emptied) and one column was
        // added — net change is 0, so cols stays the same
        cols: grid.cols,
        placements: shifted,
        dividers: {
          ...grid.dividers,
          columns: newColDividers,
        },
      });
    });
  }

  const newCol = splitLeft ? sourceCol : sourceCol + 1;

  return mapGridInWindow(workspace, windowId, (grid) => {
    const newPlacements: typeof grid.placements = [];
    for (const p of grid.placements) {
      if (p.position.row !== 0) {
        newPlacements.push(p);
        continue;
      }
      if (p.position.col === actualSourceCol) {
        let newActiveId: TabId;
        if (
          focusTabId &&
          (p.activeTabId as TabId) === (tabId as TabId) &&
          (remainingTabIds as TabId[]).includes(focusTabId as TabId)
        ) {
          newActiveId = focusTabId as TabId;
        } else {
          newActiveId = computeNewActiveId(
            p.activeTabId as TabId,
            tabId as TabId,
            remainingTabIds as TabId[],
          );
        }
        let shifted = { ...p, tabIds: remainingTabIds as TabId[], activeTabId: newActiveId };
        if (actualSourceCol >= newCol) {
          shifted.position = { ...shifted.position, col: shifted.position.col + 1 };
        }
        newPlacements.push(shifted);
      } else if (p.position.col >= newCol) {
        newPlacements.push({ ...p, position: { ...p.position, col: p.position.col + 1 } });
      } else {
        newPlacements.push(p);
      }
    }
    newPlacements.push({
      tabIds: [tabId as TabId],
      activeTabId: tabId as TabId,
      position: { row: 0, col: newCol },
      span: { rowSpan: 1, colSpan: 1 },
    });
    const oldColDividers = grid.dividers.columns;
    const leftBound = oldColDividers[sourceCol - 1] ?? 0;
    const rightBound = oldColDividers[sourceCol] ?? 1;
    const midDivider = (leftBound + rightBound) / 2;
    const newColDividers = [...oldColDividers];
    newColDividers.splice(sourceCol, 0, midDivider);
    return equalizeColumns({
      ...grid,
      cols: grid.cols + 1,
      placements: newPlacements,
      dividers: {
        ...grid.dividers,
        columns: newColDividers,
      },
    });
  });
}

export function moveTabToWindow(
  workspace: Workspace,
  tabId: string,
  targetWindowId: string,
  row: number,
  col: number,
  focusTabId?: string,
): Workspace {
  const source = findTabLocation(workspace, tabId);
  if (!source) return workspace;
  return moveTabBetweenCells(
    workspace,
    source.windowId,
    tabId,
    targetWindowId,
    row,
    col,
    undefined,
    focusTabId,
  );
}

export function activateTabInCell(
  workspace: Workspace,
  windowId: string,
  tabId: string,
): Workspace {
  return mapGridInWindow(workspace, windowId, (grid) => ({
    ...grid,
    placements: grid.placements.map((pl) => {
      if ((pl.tabIds as string[]).includes(tabId)) {
        return { ...pl, activeTabId: tabId as TabId };
      }
      return pl;
    }),
  }));
}

export function updateTabTitle(workspace: Workspace, tabId: string, title: string): Workspace {
  const tid = tabId as TabId;
  if (!workspace.editorTabs[tid]) return workspace;
  return {
    ...workspace,
    editorTabs: {
      ...workspace.editorTabs,
      [tid]: { ...workspace.editorTabs[tid], title },
    },
  };
}

export function updateTabConfig(
  workspace: Workspace,
  tabId: string,
  key: string,
  value: unknown,
): Workspace {
  const tid = tabId as TabId;
  const tab = workspace.editorTabs[tid];
  if (!tab) return workspace;
  return {
    ...workspace,
    editorTabs: {
      ...workspace.editorTabs,
      [tid]: { ...tab, config: { ...(tab.config || {}), [key]: value } },
    },
  };
}

export function addColumnTab(
  workspace: Workspace,
  windowId: string,
  appType?: string,
  title?: string,
  filePath?: string,
): Workspace {
  const win = workspace.windows.find((w) => w.id === windowId);
  if (!win) return workspace;

  const grid = win.grid;
  const occupiedCount = grid.placements.length;
  const totalCells = grid.rows * grid.cols;

  let result: Workspace = workspace;

  if (occupiedCount >= totalCells) {
    const splitCol = grid.cols - 1;
    result = insertGridColumn(result, windowId, splitCol);
  }

  const updatedGrid = result.windows.find((w) => w.id === windowId)!.grid;

  for (let col = 0; col < updatedGrid.cols; col++) {
    const occupied = updatedGrid.placements.some(
      (p) => p.position.row === 0 && p.position.col === col,
    );
    if (!occupied) {
      const tabId = makeTabId();
      const config: Record<string, unknown> = {};
      if (filePath) config.filePath = filePath;
      const tab = makeTab(
        tabId,
        appType ?? "blank",
        title || (appType?.replace("-", " ") ?? "Blank"),
        config,
      );
      result = registerTab(result, tab);
      return addTabToCell(result, windowId, tab, 0, col);
    }
  }

  return result;
}

export function addColumnTabAt(
  workspace: Workspace,
  windowId: string,
  appType?: string,
  title?: string,
  filePath?: string,
  targetCol?: number,
): Workspace {
  if (targetCol === undefined || targetCol < 0) {
    return addColumnTab(workspace, windowId, appType, title, filePath);
  }

  let result = workspace;
  const win = result.windows.find((w) => w.id === windowId);
  if (!win) return result;

  if (targetCol >= win.grid.cols) {
    result = resizeGrid(result, windowId, 1, targetCol + 1);
  }

  const tabId = makeTabId();
  const config: Record<string, unknown> = {};
  if (filePath) config.filePath = filePath;
  const tab = makeTab(
    tabId,
    appType ?? "blank",
    title || (appType?.replace("-", " ") ?? "Blank"),
    config,
    false,
  );
  result = registerTab(result, tab);
  return addTabToCell(result, windowId, tab, 0, targetCol);
}

export function removeColumnTab(workspace: Workspace, windowId: string, tabId: string): Workspace {
  return removeTabFromCell(workspace, windowId, tabId);
}

/**
 * Split a tab from its source window into a new column in the target window.
 *
 * Handles cross-window drag-to-split: splitsTabFromCell alone cannot be used
 * because the tab doesn't exist in the target window's grid. This operation:
 *   1. Moves the tab from source to target window via moveTabBetweenCells
 *   2. Splits the tab into a new column via splitTabFromCell
 */
export function splitCrossWindowTab(
  workspace: Workspace,
  sourceWindowId: string,
  tabId: string,
  targetWindowId: string,
  targetCol: number,
  splitLeft: boolean,
): Workspace {
  const moved = moveTabBetweenCells(
    workspace,
    sourceWindowId,
    tabId,
    targetWindowId,
    0,
    targetCol,
    -1,
  );
  return splitTabFromCell(moved, targetWindowId, tabId, targetCol, splitLeft);
}
