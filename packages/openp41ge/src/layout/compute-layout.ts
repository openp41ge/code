import type { Window, Grid, TabPlacement, Rect, ComputedLayout, TabId, Overlay } from "./types.js";

/**
 * Compute the absolute pixel rects for every visible tab in a window.
 *
 * The active window's grid is rendered. Overlays are positioned on top
 * of the grid within the window bounds.
 */
export function computeLayout(win: Window, viewportBounds: Rect): ComputedLayout {
  const layout = new Map<TabId, Rect>();

  // 1. Compute the window's grid layout
  const gridRects = computeGridLayout(win.grid, viewportBounds);
  for (const [tabId, rect] of gridRects) {
    layout.set(tabId, rect);
  }

  // 2. Compute overlays on top
  for (const overlay of win.overlays) {
    const rect = computeOverlayRect(overlay, viewportBounds);
    layout.set(overlay.tab.id as TabId, rect);
  }

  return layout;
}

// ─── Grid Layout Computation ──────────────────────────────────────────────

function computeGridLayout(grid: Grid, bounds: Rect): Map<TabId, Rect> {
  const result = new Map<TabId, Rect>();

  // Calculate column widths from divider ratios
  const colWidths = distributeSpace(bounds.width, grid.cols, grid.dividers.columns);

  // Calculate row heights from divider ratios
  const rowHeights = distributeSpace(bounds.height, grid.rows, grid.dividers.rows);

  // For each tab placement, calculate its pixel rect
  for (const placement of grid.placements) {
    const rect = tabPlacementToRect(placement, colWidths, rowHeights, bounds);
    if (rect) {
      // Only the active tab in the cell gets the rect
      const activeTabId = placement.activeTabId ?? placement.tabIds[0];
      result.set(activeTabId, rect);
    }
  }

  return result;
}

/**
 * Distribute total space among `count` segments using `ratios` dividers.
 * Returns an array of segment sizes in pixels.
 */
export function distributeSpace(total: number, count: number, ratios: number[]): number[] {
  if (count <= 0) return [];
  if (count === 1) return [total];

  // Ratios define the dividing points (0..1) between segments.
  const fractions: number[] = [];

  let prev = 0;
  for (let i = 0; i < ratios.length; i++) {
    fractions.push(ratios[i] - prev);
    prev = ratios[i];
  }
  // Last segment
  fractions.push(1 - prev);

  // If ratios don't align (e.g., grid was resized), fall back to equal distribution
  if (fractions.length !== count || fractions.some((f) => f <= 0)) {
    return Array.from({ length: count }, () => total / count);
  }

  return fractions.map((f) => Math.round(f * total));
}

function tabPlacementToRect(
  placement: TabPlacement,
  colWidths: number[],
  rowHeights: number[],
  bounds: Rect,
): Rect | null {
  const { row, col } = placement.position;
  const rowSpan = placement.span?.rowSpan ?? 1;
  const colSpan = placement.span?.colSpan ?? 1;

  if (row >= rowHeights.length || col >= colWidths.length) return null;

  // Calculate x position: sum of widths of columns before this one
  let x = bounds.x;
  for (let c = 0; c < col; c++) {
    x += colWidths[c];
  }

  // Calculate y position: sum of heights of rows before this one
  let y = bounds.y;
  for (let r = 0; r < row; r++) {
    y += rowHeights[r];
  }

  // Calculate width: sum of spanned columns
  let width = 0;
  const endCol = Math.min(col + colSpan, colWidths.length);
  for (let c = col; c < endCol; c++) {
    width += colWidths[c];
  }

  // Calculate height: sum of spanned rows
  let height = 0;
  const endRow = Math.min(row + rowSpan, rowHeights.length);
  for (let r = row; r < endRow; r++) {
    height += rowHeights[r];
  }

  return { x, y, width, height };
}

// ─── Overlay Layout Computation ────────────────────────────────────────────

function computeOverlayRect(
  overlay: Pick<Overlay, "position" | "width" | "height">,
  viewportBounds: Rect,
): Rect {
  const w = Math.min(overlay.width, viewportBounds.width);
  const h = Math.min(overlay.height, viewportBounds.height);

  if (typeof overlay.position === "object" && "x" in overlay.position) {
    // Custom position — clamp to viewport
    return {
      x: Math.max(0, Math.min(overlay.position.x, viewportBounds.width - w)),
      y: Math.max(0, Math.min(overlay.position.y, viewportBounds.height - h)),
      width: w,
      height: h,
    };
  }

  switch (overlay.position) {
    case "top-left":
      return { x: viewportBounds.x, y: viewportBounds.y, width: w, height: h };
    case "top-right":
      return {
        x: viewportBounds.x + viewportBounds.width - w,
        y: viewportBounds.y,
        width: w,
        height: h,
      };
    case "bottom-left":
      return {
        x: viewportBounds.x,
        y: viewportBounds.y + viewportBounds.height - h,
        width: w,
        height: h,
      };
    case "bottom-right":
      return {
        x: viewportBounds.x + viewportBounds.width - w,
        y: viewportBounds.y + viewportBounds.height - h,
        width: w,
        height: h,
      };
    case "center":
      return {
        x: viewportBounds.x + (viewportBounds.width - w) / 2,
        y: viewportBounds.y + (viewportBounds.height - h) / 2,
        width: w,
        height: h,
      };
  }
}
