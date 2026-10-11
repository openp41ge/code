/**
 * openp41ge-core-constants — shared dimension and configuration constants.
 *
 * Central source of truth for layout measurements, event names, and other
 * app-wide values. Import from "openp41ge-core-constants" instead of redefining
 * magic numbers across the codebase.
 */

// ─── Layout Dimensions ──────────────────────────────────────────────

/** Height of the titlebar in pixels. */
export const TITLEBAR_HEIGHT = 35;

/** Height of the bottom-pane tab bar in pixels (always-visible strip). */
export const TAB_BAR_HEIGHT = 30;

/** Minimum sidebar width in pixels. */
export const MIN_SIDEBAR_WIDTH = 160;

/** Maximum sidebar width in pixels. */
export const MAX_SIDEBAR_WIDTH = 600;

/** Width of the resize notch between sidebar and grid. */
export const NOTCH_WIDTH = 7;

/** How many pixels the notch extends outward beyond the sidebar edge. */
export const NOTCH_OVERFLOW = 3;

/** Default expanded height for the bottom pane. */
export const BOTTOM_PANE_DEFAULT_HEIGHT = 300;

/** Minimum width of a grid column in pixels. */
export const MIN_COLUMN_WIDTH = 200;

// ─── Scrollbar ─────────────────────────────────────────────────────

/** Width of custom scrollbars in pixels. */
export const SCROLLBAR_SIZE = 8;

// ─── File Tree Resize ──────────────────────────────────────────────

/** Minimum width of the file-tree preview panel. */
export const MIN_PREVIEW = 200;

/** Minimum width of the file-tree drawer panel. */
export const MIN_DRAWER = 200;

/** Minimum width of the wrapper around the file tree. */
export const MIN_WRAPPER = 280;

/** Maximum combined width ratio for file-tree resize panels. */
export const MAX_COMBINED_RATIO = 1.0;

// ─── Grid / Tab Bar ────────────────────────────────────────────────

/** Height of each item in a pane-picker list (px). */
export const ITEM_HEIGHT = 36;

/** Fraction of a column width used as the boundary threshold for insertion. */
export const INSERT_BOUNDARY_THRESHOLD = 0.15;

// ─── Error / History Limits ────────────────────────────────────────

/** Maximum number of captured errors to retain. */
export const MAX_ERRORS = 100;

/** Maximum entries in the tab-activation history. */
export const MAX_HISTORY = 50;

// ─── Workspace File ────────────────────────────────────────────────

/** Filename used to persist workspace state. */
export const WORKSPACE_STATE_FILENAME = "workspace-state.json";

/** Default TTL for draft workspaces (7 days in ms). */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Custom DOM Event Names ────────────────────────────────────────

/** Dispatched when a sidebar tab is dropped. */
export const SIDEBAR_DROP_EVENT = "sidebar-tab-drop";

export const SIDEBAR_TAB_BUTTON_SELECTOR = "[data-sidebar-tab-id]";

/** Dispatched on <openp41ge-windowview> to expand the bottom pane. */
export const BP_EXPAND_EVENT = "bp-expand";

/** Dispatched on <openp41ge-windowview> to collapse/expand the bottom pane. */
export const BP_TOGGLE_EVENT = "bp-toggle";

/** Dispatched to set bottom pane to full viewport height. */
export const BP_FULLSIZE_EVENT = "bp-fullsize";

/** Dispatched to restore bottom pane to default height. */
export const BP_SHRINK_EVENT = "bp-shrink";

/** Dispatched to collapse (close) the bottom pane. */
export const BP_CLOSE_EVENT = "bp-close";
