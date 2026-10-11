/**
 * openp41ge-tabs-adapter — Bridge between the Openp41ge platform and openp41ge-core-tabs package.
 *
 * Re-exports all openp41ge-core-tabs APIs consumed by the Openp41ge platform. This is the
 * single integration point — if openp41ge-core-tabs' API changes, only this file needs
 * updating.
 *
 * The adapter also provides helper functions for translating between Openp41ge's
 * data model (Workspace, Window, Grid, Tab) and openp41ge-core-tabs' data model.
 */

// ─── Components ────────────────────────────────────────────────────────────
export { TabGrid, TabBar, TabView, TabContent } from "openp41ge-sdk-uikit";

// ─── Drag & Drop Infrastructure ───────────────────────────────────────────
export {
  DragOrchestrator,
  GhostManager,
  CursorManager,
  TabDragSource,
  TabBarDropTarget,
  GridDropTarget,
  defaultTargetResolver,
  setPayloadOpenResolver,
} from "openp41ge-sdk-uikit";

// ─── Pure Functions — Boundary Detection, Ghost Layout ────────────────────
export {
  computeDropTarget,
  computeGhostLayout,
  getDropIndexInBar,
  splitCellForBoundary,
  classifyGridPosition,
  INSERT_BOUNDARY_THRESHOLD,
  DRAG_EVENTS,
} from "openp41ge-sdk-uikit";

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  IDragSource,
  IDropTarget,
  TargetFeedback,
  DragResult,
  DragSourceData,
  GhostPreview,
  GhostColumn,
  TargetResolver,
  WorkspaceLike,
  GridElementLike,
  PayloadDragData,
  PayloadOpen,
} from "openp41ge-sdk-uikit";

// ─── Event Names ──────────────────────────────────────────────────────────
export const TAB_BAR_EVENTS = {
  REORDER: "tab-bar-reorder",
  MOVE_CELL: "tab-bar-move-cell",
} as const;

export const GRID_EVENTS = {
  SPLIT: "grid-split",
  MOVE: "grid-move",
  ACTIVATE: "grid-activate",
  REMOVE: "grid-remove",
} as const;

// ─── State Mapping Helpers ────────────────────────────────────────────────

import type { Window, Tab, Workspace } from "../layout/types.js";

/**
 * Map a Openp41ge Window into the state shape expected by <tab-grid>.
 */
export function windowToTabGridState(win: Window, workspace?: Workspace) {
  const tabs: Record<string, { title: string; content: string }> = {};
  const activeTabIds: Record<string, string> = {};

  for (const pl of win.grid.placements) {
    const colStr = String(pl.position.col);
    activeTabIds[colStr] = (pl.activeTabId ?? pl.tabIds[0] ?? "") as string;

    for (const tabId of pl.tabIds) {
      const tabsRecord = workspace?.editorTabs as Record<string, Tab | undefined> | undefined;
      const tab = tabsRecord?.[tabId as string];
      tabs[tabId as string] = {
        title: tab?.title ?? "Untitled",
        content: "",
      };
    }
  }

  return {
    winId: win.id,
    cols: win.grid.cols,
    placements: win.grid.placements.map((p) => ({
      position: { row: p.position.row, col: p.position.col },
      tabIds: p.tabIds as string[],
    })),
    tabs,
    activeTabIds,
  };
}
