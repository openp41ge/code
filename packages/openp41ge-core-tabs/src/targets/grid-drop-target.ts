/**
 * GridDropTarget — handles drops on the grid surface (cells and boundaries).
 *
 * Fires CustomEvents on `this.element` for drop operations.
 * The host application (openp41ge) listens for these events and routes
 * them to IPC / workspace operations.
 *
 * Events (bubbling):
 *   grid-split       — { winId, tabId, splitCol, splitLeft, focusTabId }
 *   grid-activate    — { winId, tabId }
 *   grid-move        — { sourceWinId, tabId, targetWinId, targetCol, insertAt, focusTabId }
 *   grid-remove      — { winId, tabId, focusTabId }
 *   grid-open-tab    — { winId, tabType, tabConfig, targetCol }
 */

import type {
  IDragSource,
  IDropTarget,
  DragResult,
  DragSourceData,
  PayloadOpenResolver,
  TargetFeedback,
} from "../interfaces";
import { computeDropTarget, isSameFilePathInCell } from "../boundary";

export const GRID_EVENTS = {
  SPLIT: "grid-split",
  ACTIVATE: "grid-activate",
  MOVE: "grid-move",
  REMOVE: "grid-remove",
  OPEN_TAB: "grid-open-tab",
} as const;

let _payloadOpenResolver: PayloadOpenResolver | null = null;

/**
 * Install (or clear, with null) the host's payload resolver. Module-level like
 * the rest of the drag state: every grid in this renderer shares it.
 */
export function setPayloadOpenResolver(resolver: PayloadOpenResolver | null): void {
  _payloadOpenResolver = resolver;
}

/** Resolve a payload drag via the installed host resolver (null when none). */
export function resolvePayloadOpen(
  ...args: Parameters<PayloadOpenResolver>
): ReturnType<PayloadOpenResolver> {
  return _payloadOpenResolver?.(...args) ?? null;
}

/**
 * True when the grid has at least one tab anywhere. An empty grid (no
 * placements, or placements all with empty tabIds) has nothing to split
 * against, so drops must fill column 0 instead of creating an empty cell.
 */
function _gridHasTabs(pageData: GridElementLike["pageData"]): boolean {
  if (!pageData) return false;
  return pageData.grid.placements.some((p) => p.tabIds.length > 0);
}

export interface WorkspaceLike {
  tabs: Record<string, { config?: { filePath?: string } }>;
}

export interface GridElementLike {
  pageData?: {
    id: string;
    grid: {
      cols: number;
      placements: Array<{
        position: { row: number; col: number };
        tabIds: string[];
      }>;
    };
  };
  winId: string;
  _lastActiveCellCol?: number;
  _focusedCol?: number;
  _getNextTabForCell?: (col: number, tabId: string) => string | undefined;
  getBoundingClientRect(): DOMRect;
  querySelectorAll(selectors: string): NodeListOf<Element>;
}

export class GridDropTarget implements IDropTarget {
  readonly type = "grid";
  readonly element: HTMLElement;

  readonly winId: string;
  private _workspace: WorkspaceLike | null;

  constructor(gridEl: HTMLElement, winId: string, workspace?: WorkspaceLike | null) {
    this.element = gridEl;
    this.winId = winId;
    this._workspace = workspace ?? null;
  }

  onHover(source: IDragSource, clientX: number, _clientY: number): TargetFeedback | null {
    const gridEl = this.element as unknown as GridElementLike;
    const pageData = gridEl.pageData;
    if (!pageData) return null;
    if (!this._resolveData(source.getDragData())) return null;

    // An empty grid cannot be split — a drop simply fills the single column.
    // Never preview a split here, or the ghost would predict an empty cell.
    if (!_gridHasTabs(pageData)) {
      return {
        showGhost: true,
        ghostConfig: { type: "cell-highlight", col: 0, cols: pageData.grid.cols },
      };
    }

    const rect = this.element.getBoundingClientRect();
    const relX = clientX - rect.left;
    const cols = pageData.grid.cols;
    const pos = computeDropTarget(this.element, relX, rect.width, cols);
    const mouseCol = pos.col;

    if (pos.isBoundary) {
      const splitLeft =
        pos.boundaryIndex === 0
          ? true
          : pos.boundaryIndex >= cols
            ? false
            : mouseCol >= pos.boundaryIndex;
      const splitCol =
        pos.boundaryIndex === 0 ? 0 : pos.boundaryIndex >= cols ? cols - 1 : mouseCol;
      return {
        showGhost: true,
        ghostConfig: {
          type: "split",
          boundaryIndex: pos.boundaryIndex,
          cols,
          mouseCol,
          splitLeft,
          splitCol,
        },
      };
    }

    return {
      showGhost: true,
      ghostConfig: { type: "cell-highlight", col: mouseCol, cols },
    };
  }

  async onDrop(source: IDragSource, clientX: number, _clientY: number): Promise<DragResult> {
    const gridEl = this.element as unknown as GridElementLike;
    const pageData = gridEl.pageData;
    if (!pageData) return { success: false, reason: "no page data" };

    const data = this._resolveData(source.getDragData());
    if (!data) return { success: false, reason: "no consumer for payload" };

    // An empty grid cannot be split — a drop on any part (incl. the right
    // boundary) fills the single column at col 0 instead of creating an empty
    // adjacent cell.
    if (!_gridHasTabs(pageData)) {
      return this._handleCellDrop(data, 0, gridEl);
    }

    const rect = this.element.getBoundingClientRect();
    const relX = clientX - rect.left;
    const cols = pageData.grid.cols;
    const pos = computeDropTarget(this.element, relX, rect.width, cols);

    if (pos.isBoundary) {
      return this._handleBoundaryDrop(data, pos.boundaryIndex, pos.col, cols, gridEl);
    }

    return this._handleCellDrop(data, pos.col, gridEl);
  }

  onLeave(): void {
    // Visual cleanup handled by the orchestrator
  }

  /**
   * Map a payload drag to the equivalent `open-tab` drag via the host
   * resolver (null when it cannot open here). Other drag types pass through.
   */
  private _resolveData(data: DragSourceData): Exclude<DragSourceData, { type: "payload" }> | null {
    if (data.type !== "payload") return data;
    const open = resolvePayloadOpen(data, { winId: this.winId, element: this.element });
    if (!open) return null;
    return {
      type: "open-tab",
      appType: open.appType,
      title: data.title,
      tabConfig: open.tabConfig,
    };
  }

  private _fire(type: string, detail: Record<string, unknown>): void {
    this.element.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  }
  private _handleBoundaryDrop(
    data: Exclude<DragSourceData, { type: "payload" }>,
    boundaryIndex: number,
    mouseCol: number,
    cols: number,
    gridEl: GridElementLike,
  ): DragResult {
    let splitCol: number;
    let splitLeft: boolean;

    if (boundaryIndex === 0) {
      splitCol = 0;
      splitLeft = true;
    } else if (boundaryIndex >= cols) {
      splitCol = cols - 1;
      splitLeft = false;
    } else if (mouseCol < boundaryIndex) {
      splitCol = mouseCol;
      splitLeft = false;
    } else {
      splitCol = mouseCol;
      splitLeft = true;
    }

    if (data.type === "tab" || data.type === "openp41ge-tab") {
      let focusTabId: string | undefined;
      if (gridEl._getNextTabForCell) {
        focusTabId = gridEl._getNextTabForCell(gridEl._lastActiveCellCol ?? 0, data.tabId);
      }

      this._fire(GRID_EVENTS.SPLIT, {
        sourceWinId: data.winId,
        winId: this.winId,
        tabId: data.tabId,
        splitCol,
        splitLeft,
        focusTabId,
      });

      gridEl._lastActiveCellCol = splitLeft ? splitCol : splitCol + 1;
      gridEl._focusedCol = gridEl._lastActiveCellCol;
      return { success: true };
    }

    if (data.type === "file") {
      // For file boundary drops, fire grid-open-tab with split info.
      // The Openp41geTabsEventHandler will dispatch splitFileOpen.
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: "file-viewer",
        tabConfig: { filePath: data.filePath },
        targetCol: splitCol,
        isBoundary: true,
        splitCol,
        splitLeft,
        pinned: true,
      });
      return { success: true };
    }

    if (data.type === "open-tab") {
      // Generic "open a pane of appType with tabConfig" payload — the host
      // (Openp41geTabsEventHandler) turns it into a workspace dispatch.
      // Boundary drops split a new column exactly like files.
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: data.appType,
        tabConfig: data.tabConfig ?? {},
        targetCol: splitCol,
        isBoundary: true,
        splitCol,
        splitLeft,
        pinned: true,
      });
      return { success: true };
    }

    return { success: false, reason: "boundary drop not supported for this type" };
  }

  private _handleCellDrop(
    data: Exclude<DragSourceData, { type: "payload" }>,
    targetCol: number,
    gridEl: GridElementLike,
  ): DragResult {
    const pageData = gridEl.pageData;
    if (!pageData) return { success: false, reason: "no page data" };

    if (data.type === "tab" || data.type === "openp41ge-tab") {
      const targetPlacement = pageData.grid.placements.find(
        (p) => p.position.row === 0 && p.position.col === targetCol,
      );

      if (targetPlacement && targetPlacement.tabIds.includes(data.tabId)) {
        this._fire(GRID_EVENTS.ACTIVATE, { winId: this.winId, tabId: data.tabId });
        gridEl._lastActiveCellCol = targetCol;
        gridEl._focusedCol = targetCol;
        return { success: true };
      }

      if (
        this._workspace &&
        targetPlacement &&
        isSameFilePathInCell(this._workspace, data.tabId, targetPlacement.tabIds as string[])
      ) {
        let focusTabId: string | undefined;
        if (gridEl._getNextTabForCell) {
          focusTabId = gridEl._getNextTabForCell(gridEl._lastActiveCellCol ?? 0, data.tabId);
        }
        this._fire(GRID_EVENTS.REMOVE, { winId: this.winId, tabId: data.tabId, focusTabId });
        gridEl._lastActiveCellCol = targetCol;
        gridEl._focusedCol = targetCol;
        return { success: true };
      }

      let focusTabId: string | undefined;
      if (gridEl._getNextTabForCell) {
        focusTabId = gridEl._getNextTabForCell(gridEl._lastActiveCellCol ?? 0, data.tabId);
      }

      this._fire(GRID_EVENTS.MOVE, {
        sourceWinId: data.winId,
        tabId: data.tabId,
        targetWinId: this.winId,
        targetCol,
        insertAt: -1,
        focusTabId,
      });

      gridEl._lastActiveCellCol = targetCol;
      gridEl._focusedCol = targetCol;
      return { success: true };
    }

    if (data.type === "file") {
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: "file-viewer",
        tabConfig: { filePath: data.filePath },
        targetCol,
        pinned: true,
      });
      return { success: true };
    }

    if (data.type === "open-tab") {
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: data.appType,
        tabConfig: data.tabConfig ?? {},
        targetCol,
        pinned: true,
      });
      return { success: true };
    }

    return { success: false, reason: "drop not supported for this type" };
  }
}
