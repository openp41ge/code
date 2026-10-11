/**
 * Grid operations — resize, insert columns, compact.
 */

import type { Workspace, Grid } from "./types.js";
import { mapGridInWindow } from "./common.js";

function equalizeColumns(grid: Grid): Grid {
  const newCols = grid.cols;
  if (newCols <= 1) return grid;
  return {
    ...grid,
    dividers: {
      ...grid.dividers,
      columns: Array.from({ length: newCols - 1 }, (_, i) => (i + 1) / newCols),
    },
  };
}

function insertGridColumn(
  workspace: Workspace,
  windowId: string,
  splitColIndex: number,
): Workspace {
  return mapGridInWindow(workspace, windowId, (grid) => {
    const oldDividers = grid.dividers.columns;
    const oldCols = grid.cols;
    const newCols = oldCols + 1;

    const newDividers: number[] = [];
    for (let i = 0; i < newCols - 1; i++) {
      if (i < splitColIndex && i < oldDividers.length) {
        newDividers.push(oldDividers[i]);
      } else if (i === splitColIndex) {
        const left = i === 0 ? 0 : oldDividers[i - 1];
        const right = i < oldDividers.length ? oldDividers[i] : 1;
        newDividers.push((left + right) / 2);
      } else if (i >= oldDividers.length + 1) {
        const left = oldDividers.length > 0 ? oldDividers[oldDividers.length - 1] : 0;
        newDividers.push((left + 1) / 2);
      } else {
        newDividers.push(oldDividers[i - 1]);
      }
    }

    const newPlacements = grid.placements.map((p) => {
      if (p.position.row === 0 && p.position.col >= splitColIndex) {
        return { ...p, position: { ...p.position, col: p.position.col + 1 } };
      }
      return p;
    });

    return equalizeColumns({
      ...grid,
      cols: newCols,
      placements: newPlacements,
      dividers: { ...grid.dividers, columns: newDividers },
    });
  });
}

export function findEmptyCell(grid: Grid): { row: number; col: number } | null {
  const occupied = new Set(grid.placements.map((p) => `${p.position.row},${p.position.col}`));
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (!occupied.has(`${r},${c}`)) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

/**
 * Strip placements with empty tabIds from the grid and compact columns.
 */
export function removeEmptyPlacements(grid: Grid): Grid {
  const nonEmpty = grid.placements.filter((p) => p.tabIds.length > 0);
  if (nonEmpty.length === grid.placements.length) return grid;
  return compactGrid({
    ...grid,
    placements: nonEmpty,
  });
}

export function compactGrid(grid: Grid): Grid {
  const occupiedCols = new Set<number>();
  for (const p of grid.placements) {
    occupiedCols.add(p.position.col);
  }

  if (grid.cols <= 1) {
    return {
      ...grid,
      placements: grid.placements.filter((p) => occupiedCols.has(p.position.col)),
    };
  }

  let emptyCol = -1;
  for (let c = 0; c < grid.cols; c++) {
    if (!occupiedCols.has(c)) {
      emptyCol = c;
      break;
    }
  }

  if (emptyCol < 0) return grid;

  const shifted = grid.placements.map((p) => {
    if (p.position.col > emptyCol) {
      return { ...p, position: { row: p.position.row, col: p.position.col - 1 } };
    }
    return p;
  });

  const newCols = grid.cols - 1;
  let newDividersList: number[] = [];
  if (newCols > 1) {
    const oldDivs = grid.dividers.columns;
    const oldWidths: number[] = [];
    for (let i = 0; i < grid.cols; i++) {
      const left = i === 0 ? 0 : oldDivs[i - 1];
      const right = i === grid.cols - 1 ? 1 : oldDivs[i];
      oldWidths.push(right - left);
    }

    let remainingTotal = 0;
    for (let i = 0; i < oldWidths.length; i++) {
      if (i !== emptyCol) remainingTotal += oldWidths[i];
    }

    if (remainingTotal > 0) {
      let cum = 0;
      for (let i = 0; i < grid.cols; i++) {
        if (i === emptyCol) continue;
        const share = oldWidths[i] / remainingTotal;
        cum += share;
        if (newDividersList.length < newCols - 1) {
          newDividersList.push(cum);
        }
      }
    }
  }

  return {
    ...grid,
    cols: newCols,
    placements: shifted,
    dividers: { columns: newDividersList, rows: grid.dividers.rows },
  };
}

/**
 * Strip placements with empty tabIds from all windows in the workspace.
 */
export function cleanupWorkspace(workspace: Workspace): Workspace {
  let result = workspace;
  for (const win of workspace.windows) {
    const grid = result.windows.find((w) => w.id === win.id)?.grid;
    if (!grid) continue;
    const cleaned = removeEmptyPlacements(grid);
    // Use mapGridInWindow to update just this window
    result = mapGridInWindow(result, win.id, () => cleaned);
  }
  return result;
}

export function resizeGrid(
  workspace: Workspace,
  windowId: string,
  rows: number,
  cols: number,
): Workspace {
  return mapGridInWindow(workspace, windowId, (grid) => ({
    ...grid,
    rows,
    cols,
    placements: grid.placements.filter((p) => p.position.row < rows && p.position.col < cols),
    dividers: {
      columns: Array.from(
        { length: Math.max(cols - 1, 0) },
        (_, i) => grid.dividers.columns[i] ?? 0.5,
      ),
      rows: Array.from({ length: Math.max(rows - 1, 0) }, (_, i) => grid.dividers.rows[i] ?? 0.5),
    },
  }));
}

export function resizeCell(
  workspace: Workspace,
  windowId: string,
  dividerIndex: number,
  ratio: number,
  isRow: boolean,
): Workspace {
  return mapGridInWindow(workspace, windowId, (grid) => {
    const clamped = Math.max(0.1, Math.min(0.9, ratio));
    if (isRow) {
      const rows = [...grid.dividers.rows];
      rows[dividerIndex] = clamped;
      return { ...grid, dividers: { ...grid.dividers, rows } };
    } else {
      const cols = [...grid.dividers.columns];
      cols[dividerIndex] = clamped;
      return { ...grid, dividers: { ...grid.dividers, columns: cols } };
    }
  });
}

export { insertGridColumn, equalizeColumns };
