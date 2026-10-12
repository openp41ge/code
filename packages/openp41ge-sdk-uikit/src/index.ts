export { Openp41geIcon } from "./components/openp41ge-icon";
export type { IconName } from "./components/openp41ge-icon";
export { Openp41geToggle } from "./components/openp41ge-toggle";
export { Openp41geInlineIcon } from "./components/openp41ge-inline-icon";
export { FileExtensionSvg } from "./components/file-extension-svg";
export {
  SidebarTabContent,
  type SidebarTabBarButton,
} from "./components/sidebar-tab-content/sidebar-tab-content";
export { iconRegistry } from "./icons";
export { TabClose } from "./components/tabs/tab-close";

// ─── Drop indicators (shared blue drag/drop lines + box) ────────────────
export {
  DropLine,
  DragLine,
  DropBox,
  DROP_INDICATOR_COLOR,
  DROP_LINE_GLOW,
} from "./components/drop-indicator";
export type { DropFadeDirection } from "./components/drop-indicator";

// ─── Scrollbar ──────────────────────────────────────────────────────────
export {
  OverlayScrollbar,
  computeThumbLength,
  computeThumbPosition,
} from "openp41ge-core-scrollbar";
export type { ScrollbarAxis, OverlayScrollbarOptions } from "openp41ge-core-scrollbar";
export { installGlobalScrollbarStyles } from "./components/scrollbar/global-scrollbar-styles";

// Re-export the inline tailwind CSS for component static styles
export { tailwindCSS } from "./generated/tailwind";

// Re-export theme definitions from the merged openp41ge-themes package
export * from "./theme";

// ─── Line highlighting (syntax + search-term overlay) ─────────────────────
export { highlightLine, languageFromPath, cropLine } from "./highlight/highlight-line";
export type {
  HighlightLineOptions,
  CropLineOptions,
  CropLineResult,
} from "./highlight/highlight-line";

// ─── Tabs (from openp41ge-core-tabs) ────────────────────────────────────────────
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
} from "openp41ge-core-tabs/interfaces";
export { TabDragSource } from "openp41ge-core-tabs/sources/tab-drag-source";
export { TabBarDropTarget, TAB_BAR_EVENTS } from "openp41ge-core-tabs/targets/tab-bar-drop-target";
export {
  GridDropTarget,
  GRID_EVENTS,
  setPayloadOpenResolver,
} from "openp41ge-core-tabs/targets/grid-drop-target";
export type { WorkspaceLike, GridElementLike } from "openp41ge-core-tabs/targets/grid-drop-target";
export {
  DragOrchestrator,
  DRAG_EVENTS,
  defaultTargetResolver,
} from "openp41ge-core-tabs/orchestrator";
export type { TargetResolver } from "openp41ge-core-tabs/orchestrator";
export { GhostManager } from "openp41ge-core-tabs/ghost-manager";
export type { GhostPreview } from "openp41ge-core-tabs/ghost-manager";
export { computeGhostLayout } from "openp41ge-core-tabs/ghost-layout";
export type { GhostColumn } from "openp41ge-core-tabs/ghost-layout";
export { CursorManager } from "openp41ge-core-tabs/cursor-manager";
export { TabGrid, TabBar, TabView, TabContent } from "./components/tabs/index";
export {
  INSERT_BOUNDARY_THRESHOLD,
  classifyGridPosition,
  getDividerPositions,
  computeDropTarget,
  getDropIndexInBar,
  splitCellForBoundary,
  isSameFilePathInCell,
} from "openp41ge-core-tabs/boundary";
export type { GridPosition } from "openp41ge-core-tabs/boundary";

// ─── File Editor Component ────────────────────────────────────────────────
export { FileEditorElement } from "./components/file-editor/file-editor";
export type { FileEditorState } from "./components/file-editor/file-editor";

// Full file-editor API available at "openp41ge-sdk-uikit/file-editor"

// ─── Empty State ────────────────────────────────────────────────────────
export { Openp41geEmptyState } from "./components/tabs/openp41ge-empty-state";
export type { RecentProject } from "./components/tabs/openp41ge-empty-state";

// ─── Demo Grid Carousel ─────────────────────────────────────────────────
export { DemoOpenp41ge } from "./components/demo/demo-openp41ge";
export type { TabDef, ColumnPlacement } from "./components/demo/demo-openp41ge";

// ─── Tree Component ──────────────────────────────────────────────────────
export { Openp41geTree } from "./components/tree";
export type {
  TreeNode,
  TreeNodeAction,
  TreeNodeDblClickEventDetail,
  TreeContextMenuEventDetail,
  TreeToggleErrorEventDetail,
  DropPosition,
  IconRenderer,
  TreeNodeClickEventDetail,
  TreeNodeToggleEventDetail,
  TreeNodeActionEventDetail,
  TreeDragStartEventDetail,
  TreeDropEventDetail,
} from "./components/tree";

export { tooltipContent } from "./components/tooltip";
export type { TooltipContent, TooltipHostLike } from "./components/tooltip";
export {
  Openp41geTooltip,
  Openp41geTooltipDetail,
  Openp41geTooltipHost,
  TooltipController,
  tooltipController,
} from "./components/tooltip";
