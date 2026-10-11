/**
 * Boundary detection — single source of truth for column divider
 * computation and drop-target classification.
 *
 * Separates DOM reading from pure computation so the core logic is
 * testable without a DOM (pure functions) or in a real browser (E2E).
 */

export const INSERT_BOUNDARY_THRESHOLD = 0.15;

// ─── Pure classification ──────────────────────────────────────────────────

export interface GridPosition {
  col: number;
  isBoundary: boolean;
  boundaryIndex: number;
}

/** Compute the width of each cell from divider positions. */
function getCellWidths(dividerFractions: number[], cols: number): number[] {
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    const left = i === 0 ? 0 : dividerFractions[i - 1];
    const right = i === cols - 1 ? 1 : dividerFractions[i];
    widths.push(right - left);
  }
  return widths;
}

/**
 * Compute the per-boundary threshold, capped at the narrower adjacent
 * cell's half-width so boundary zones never overlap for thin cells.
 */
function boundaryThreshold(boundaryIndex: number, cellWidths: number[], cols: number): number {
  if (boundaryIndex === 0) {
    // Left edge — threshold is at most 1/3 of the first cell
    return Math.min(INSERT_BOUNDARY_THRESHOLD, cellWidths[0] / 3);
  }
  if (boundaryIndex >= cols) {
    // Right edge — threshold is at most 1/3 of the last cell
    return Math.min(INSERT_BOUNDARY_THRESHOLD, cellWidths[cols - 1] / 3);
  }
  // Interior divider — threshold is at most 1/3 of the narrower adjacent cell
  const narrower = Math.min(cellWidths[boundaryIndex - 1], cellWidths[boundaryIndex]);
  return Math.min(INSERT_BOUNDARY_THRESHOLD, narrower / 3);
}

/**
 * Pure: classify a horizontal position within a grid.
 * No DOM access — takes normalized positions (0..1).
 */
export function classifyGridPosition(
  relFraction: number, // 0..1
  dividerFractions: number[], // 0..1, length = cols - 1
  cols: number,
): GridPosition {
  if (cols <= 0) return { col: 0, isBoundary: false, boundaryIndex: 0 };

  const cellWidths = getCellWidths(dividerFractions, cols);

  let col = cols - 1;
  for (let i = 0; i < cols - 1; i++) {
    if (relFraction < dividerFractions[i]) {
      col = i;
      break;
    }
  }

  let nearestBoundary = -1;
  let minDist = Infinity;

  for (let i = 0; i <= cols; i++) {
    const pos = i === 0 ? 0 : i === cols ? 1 : dividerFractions[i - 1];
    const dist = Math.abs(relFraction - pos);
    if (dist < minDist) {
      minDist = dist;
      nearestBoundary = i;
    }
  }

  const threshold = boundaryThreshold(nearestBoundary, cellWidths, cols);
  const isBoundary = minDist < threshold;
  return { col, isBoundary, boundaryIndex: nearestBoundary === -1 ? 0 : nearestBoundary };
}

// ─── DOM-assisted helpers ─────────────────────────────────────────────────

/**
 * Read column divider positions from a grid element's DOM.
 * Returns fractions (0..1) for each interior divider.
 */
export function getDividerPositions(gridEl: HTMLElement, cols: number): number[] {
  if (cols <= 1) return [];
  const cells = gridEl.querySelectorAll(".grid-cell");
  if (cells.length === 0) return Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols);

  const flexValues = Array.from(cells).map((c) => {
    const flex = (c as HTMLElement).style.flex;
    const ratio = flex ? parseFloat(flex) : 1;
    return isNaN(ratio) ? 1 : ratio;
  });

  const total = flexValues.reduce((a, b) => a + b, 0);
  if (total === 0) return Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols);

  const dividers: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < cols - 1; i++) {
    cumulative += flexValues[i] / total;
    dividers.push(cumulative);
  }
  return dividers;
}

/**
 * Convenience: combine DOM reading + pure classification.
 */
export function computeDropTarget(
  gridEl: HTMLElement,
  relX: number,
  gridWidth: number,
  cols: number,
): GridPosition {
  if (cols <= 0) return { col: 0, isBoundary: false, boundaryIndex: 0 };
  if (cols === 1) {
    const fraction = relX / gridWidth;
    // For a single cell, compute thresholds based on cell width (= 1.0)
    const cellWidth = 1.0;
    const edgeThreshold = Math.min(INSERT_BOUNDARY_THRESHOLD, cellWidth / 3);
    if (fraction <= edgeThreshold) return { col: 0, isBoundary: true, boundaryIndex: 0 };
    if (fraction >= 1 - edgeThreshold) return { col: 0, isBoundary: true, boundaryIndex: 1 };
    return { col: 0, isBoundary: false, boundaryIndex: 0 };
  }
  const dividers = getDividerPositions(gridEl, cols);
  return classifyGridPosition(relX / gridWidth, dividers, cols);
}

// ─── Tab bar helpers ──────────────────────────────────────────────────────

const TAB_BAR_BUTTON_SELECTOR = 'openp41ge-tab-button, .tab-btn, [role="tab"]';

/**
 * Resolve only the actual tab button elements in a bar, ignoring any injected helper overlay.
 */
export function getTabButtonsInBar(bar: HTMLElement): HTMLElement[] {
  return Array.from(bar.querySelectorAll(TAB_BAR_BUTTON_SELECTOR)).filter(
    (el): el is HTMLElement => {
      const htmlEl = el as HTMLElement;
      return !htmlEl.matches(".tab-drop-indicator");
    },
  );
}

/**
 * Find insertion index in a tab bar based on cursor X.
 */
export function getDropIndexInBar(bar: HTMLElement, clientX: number): number {
  const tabs = getTabButtonsInBar(bar);
  if (tabs.length === 0) {
    return 0;
  }

  let insertIndex = tabs.length;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i] as HTMLElement;
    const rect = tab.getBoundingClientRect();
    const midPoint = rect.left + rect.width / 2;

    if (clientX < midPoint) {
      insertIndex = i;
      break;
    }
  }

  return insertIndex;
}

/**
 * Determine which cell to split and which side when a drop lands on a boundary.
 */
export function splitCellForBoundary(
  cols: number,
  boundaryIndex: number,
  mouseCol: number,
): { col: number; splitLeft: boolean } {
  if (boundaryIndex === 0) return { col: 0, splitLeft: true };
  if (boundaryIndex >= cols) return { col: cols - 1, splitLeft: false };
  if (mouseCol < boundaryIndex) return { col: mouseCol, splitLeft: false };
  return { col: mouseCol, splitLeft: true };
}

// ─── File dedup check ─────────────────────────────────────────────────────

/**
 * Check if a dragged tab's file path matches any tab in a target cell.
 */
export function isSameFilePathInCell(
  ws: { tabs: Record<string, { config?: { filePath?: string } }> },
  draggedTabId: string,
  cellTabIds: string[],
): boolean {
  const draggedTab = ws.tabs[draggedTabId];
  if (!draggedTab?.config?.filePath) return false;
  const filePath = draggedTab.config.filePath;
  return cellTabIds.some((targetTabId) => {
    const targetTab = ws.tabs[targetTabId];
    return targetTab?.config?.filePath === filePath;
  });
}
