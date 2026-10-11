/**
 * openp41ge-core-tabs — Lit-based drag-and-drop tab system.
 *
 * A self-contained package for building draggable tab bars and grid
 * drop zones.  No Electron/IPC dependencies — fires CustomEvents that
 * the host application wires to its own infrastructure.
 */

// ─── Interfaces ───────────────────────────────────────────────────────────
export type {
  IDragSource,
  IDropTarget,
  IDragHandler,
  DragSourceData,
  DragResult,
  TargetFeedback,
  GhostFactory,
  PayloadDragData,
  PayloadOpen,
  PayloadOpenResolver,
} from "./interfaces";

// ─── Drag Source ──────────────────────────────────────────────────────────
export { TabDragSource } from "./sources/tab-drag-source";

// ─── Drop Targets ─────────────────────────────────────────────────────────
export { TabBarDropTarget, TAB_BAR_EVENTS } from "./targets/tab-bar-drop-target";
export { GridDropTarget, GRID_EVENTS, setPayloadOpenResolver } from "./targets/grid-drop-target";
export type { WorkspaceLike, GridElementLike } from "./targets/grid-drop-target";

// ─── Orchestrator ─────────────────────────────────────────────────────────
export { DragOrchestrator, DRAG_EVENTS, defaultTargetResolver } from "./orchestrator";
export type { TargetResolver } from "./orchestrator";

// ─── Ghost management ─────────────────────────────────────────────────────
export { GhostManager } from "./ghost-manager";
export type { GhostPreview } from "./ghost-manager";
export { computeGhostLayout } from "./ghost-layout";
export type { GhostColumn } from "./ghost-layout";

// ─── Cursor ───────────────────────────────────────────────────────────────
export { CursorManager } from "./cursor-manager";

// ─── Boundary / utilities ─────────────────────────────────────────────────
export {
  INSERT_BOUNDARY_THRESHOLD,
  classifyGridPosition,
  getDividerPositions,
  computeDropTarget,
  getDropIndexInBar,
  splitCellForBoundary,
  isSameFilePathInCell,
} from "./boundary";
export type { GridPosition } from "./boundary";
