import { z } from "zod";

// ─── IDs ───────────────────────────────────────────────────────────────────

export const WorkspaceId = z.string().brand("WorkspaceId");
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const WindowId = z.string().brand("WindowId");
export type WindowId = z.infer<typeof WindowId>;

export const TabId = z.string().brand("TabId");
export type TabId = z.infer<typeof TabId>;

export const SystemTabId = z.string().brand("SystemTabId");
export type SystemTabId = z.infer<typeof SystemTabId>;

export const OverlayId = z.string().brand("OverlayId");
export type OverlayId = z.infer<typeof OverlayId>;

export const TabGroupId = z.string().brand("TabGroupId");
export type TabGroupId = z.infer<typeof TabGroupId>;

// ─── Workspace File Data ───────────────────────────────────────────────────

/**
 * Contents of a .openp41ge-workspace file.
 *
 * v2 makes the file the single source of truth for a workspace: it carries the
 * manifest (name, repos, dataDir) AND the session (the workspace's windows and
 * shared sidebar state) that used to live in the global workspace.json. The new
 * session fields are optional so v1 files (manifest-only) still parse; the
 * migration in `layout/workspace-file.ts` fills their defaults.
 */
export interface WorkspaceFileData {
  id: string;
  name?: string;
  version: number;
  createdAt: string;
  dataDir: string;
  repos: Array<{ url: string; worktrees: string[] }>;
  /** ISO-8601 timestamp of the last time this workspace was opened. */
  lastActivatedAt?: string;

  // ── v2: workspace-owned, shared state ──────────────────────────────
  /** Which sidebar panels exist (pinned/order), keyed by system tab ID. */
  systemTabs?: Record<string, unknown>;
  /** Editor tabs pinned to the workspace (not owned by a single window). */
  editorTabs?: Record<string, unknown>;
  /** Tab groups (related-tab clusters) for the workspace. */
  tabGroups?: Record<string, unknown>;
  /** Workspace-level scoped folders. */
  scopedFolders?: string[];
  /** Sidebar docking/open state shared across every window of this workspace. */
  sharedSidebars?: {
    leftSidebarTabs: string[];
    rightSidebarTabs: string[];
    leftSidebarOpen: boolean;
    rightSidebarOpen: boolean;
  };
  /** One entry per open window (session). */
  windows?: Window[];
}

// ─── Rect / Bounds ─────────────────────────────────────────────────────────

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Bounds = z.infer<typeof BoundsSchema>;

// ─── Tab (replaces old Pane) ───────────────────────────────────────────────

/** App type identifier — maps to a registered app type package. */
const AppTypeId = z.string();

const TabConfigSchema = z.record(z.unknown());

export const TabSchema = z.object({
  id: TabId,
  appType: AppTypeId,
  title: z.string(),
  config: TabConfigSchema.optional().default({}),
  isPreview: z.boolean().default(false),
});
export type Tab = z.infer<typeof TabSchema>;

export function createTab(
  id: string,
  appType: string,
  title: string,
  config?: Record<string, unknown>,
  isPreview: boolean = false,
): Tab {
  return TabSchema.parse({ id, appType, title, config: config ?? {}, isPreview });
}

// ─── Grid ──────────────────────────────────────────────────────────────────

/**
 * Grid is a regular matrix of cells arranged in rows and columns.
 * Each cell can hold multiple tabs (stored as tabIds[]), but only one
 * tab is active (visible) at a time — index 0 is active.
 */
const CellPositionSchema = z.object({
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
});

const CellSpanSchema = z.object({
  rowSpan: z.number().int().min(1).default(1),
  colSpan: z.number().int().min(1).default(1),
});

export const TabPlacementSchema = z.object({
  tabIds: z.array(TabId).min(1),
  activeTabId: TabId.optional(),
  position: CellPositionSchema,
  span: CellSpanSchema.default({ rowSpan: 1, colSpan: 1 }),
});
export type TabPlacement = z.infer<typeof TabPlacementSchema>;

/** Column/row divider ratios (0..1), stored per boundary between cells. */
const DividerRatiosSchema = z.object({
  columns: z.array(z.number().min(0).max(1)),
  rows: z.array(z.number().min(0).max(1)),
});

export const GridSchema = z.object({
  id: z.string(),
  rows: z.number().int().min(1),
  cols: z.number().int().min(1),
  placements: z.array(TabPlacementSchema),
  dividers: DividerRatiosSchema,
});
export type Grid = z.infer<typeof GridSchema>;

export function createGrid(id: string, rows = 1, cols = 1): Grid {
  return GridSchema.parse({
    id,
    rows,
    cols,
    placements: [],
    dividers: {
      columns: Array.from({ length: cols - 1 }, () => 0.5),
      rows: Array.from({ length: rows - 1 }, () => 0.5),
    },
  });
}

/** Helper: get the active tab ID for a cell. */
export function activeTabInCell(placement: TabPlacement): TabId {
  return placement.tabIds[0];
}

/** Helper: set the active tab ID (moves it to index 0). */
export function setActiveTabInCell(placement: TabPlacement, tabId: TabId): TabPlacement {
  const others = placement.tabIds.filter((id) => id !== tabId);
  return { ...placement, tabIds: [tabId, ...others] };
}

// ─── Overlay ───────────────────────────────────────────────────────────────

export const OverlayPositionSchema = z.union([
  z.literal("top-left"),
  z.literal("top-right"),
  z.literal("bottom-left"),
  z.literal("bottom-right"),
  z.literal("center"),
  z.object({ x: z.number(), y: z.number() }),
]);
export type OverlayPosition = z.infer<typeof OverlayPositionSchema>;

export const OverlaySchema = z.object({
  id: OverlayId,
  tab: TabSchema,
  position: OverlayPositionSchema.default("bottom-right"),
  width: z.number().positive().default(400),
  height: z.number().positive().default(300),
  opacity: z.number().min(0).max(1).default(0.95),
  zIndex: z.number().int().default(100),
});
export type Overlay = z.infer<typeof OverlaySchema>;

/** @internal Create an Overlay data object. */
export function createOverlayData(
  id: string,
  tab: Tab,
  position: OverlayPosition = "bottom-right",
): Overlay {
  return OverlaySchema.parse({ id, tab, position });
}

// ─── SidebarTab (formerly SystemTab) ────────────────────────────────────────

/** Sidebar tabs are sidebar-based app panels (Explorer, Git, Search, etc.). */
export const SidebarTabSchema = z.object({
  id: SystemTabId,
  appType: z.string(),
  title: z.string(),
  pinned: z.boolean().default(false),
  /** ISO-8601 timestamp of the last time this tab was the active tab in its sidebar. */
  lastAccessedAt: z.string().nullable().default(null),
});
export type SidebarTab = z.infer<typeof SidebarTabSchema>;

export function createSidebarTab(
  id: string,
  appType: string,
  title: string,
  pinned: boolean = false,
): SidebarTab {
  return SidebarTabSchema.parse({ id, appType, title, pinned });
}

// Backward-compat aliases
export const SystemTabSchema = SidebarTabSchema;
export type SystemTab = SidebarTab;
export const createSystemTab = createSidebarTab;

// ─── SidebarState ───────────────────────────────────────────────────────────────

/**
 * Per-window sidebar state — what is active and how wide the sidebar is. The
 * *set/side/open* of sidebar tabs is shared across a workspace's windows and
 * lives on `Workspace.sidebar` (see `WorkspaceSidebarSchema`).
 */
export const SidebarStateSchema = z.object({
  activeViewId: z.string().nullable().default(null),
  width: z.number().positive().default(280),
  /** Active left sidebar system tab ID. */
  activeLeftTab: SystemTabId.nullable().default(null),
  /** Active right sidebar system tab ID. */
  activeRightTab: SystemTabId.nullable().default(null),
});
export type SidebarState = z.infer<typeof SidebarStateSchema>;

// ─── WorkspaceSidebar ─────────────────────────────────────────────────────────

/**
 * Workspace-shared sidebar state — which sidebar tabs exist, which side each is
 * on, and whether each sidebar is open. Shared across every window of the
 * workspace (the Explorer open in one window is open in all).
 */
export const WorkspaceSidebarSchema = z.object({
  /** Ordered system tab IDs for the left sidebar. */
  leftSidebarTabs: z.array(SystemTabId).default([]),
  /** Ordered system tab IDs for the right sidebar. */
  rightSidebarTabs: z.array(SystemTabId).default([]),
  /** Whether the left sidebar is open. */
  leftSidebarOpen: z.boolean().default(false),
  /** Whether the right sidebar is open. */
  rightSidebarOpen: z.boolean().default(true),
});
export type WorkspaceSidebar = z.infer<typeof WorkspaceSidebarSchema>;

export function createWorkspaceSidebar(): WorkspaceSidebar {
  return WorkspaceSidebarSchema.parse({
    leftSidebarTabs: [],
    rightSidebarTabs: [],
    leftSidebarOpen: false,
    rightSidebarOpen: false,
  });
}

// ─── Window ────────────────────────────────────────────────────────────────

export const WindowSchema = z.object({
  id: WindowId,
  bounds: BoundsSchema,
  monitor: z.number().int().nonnegative().default(0),
  grid: GridSchema,
  sidebar: SidebarStateSchema.optional().default({ activeViewId: null, width: 280 }),
  overlays: z.array(OverlaySchema).default([]),
});
export type Window = z.infer<typeof WindowSchema>;

export function createWindow(id: string, bounds?: Bounds, monitor?: number): Window {
  const grid = createGrid(id, 1, 1);
  return WindowSchema.parse({
    id,
    bounds: bounds ?? { x: 0, y: 0, width: 1280, height: 800 },
    monitor: monitor ?? 0,
    grid,
    sidebar: { activeViewId: null, width: 280 },
    overlays: [],
  });
}

// ─── Workspace ─────────────────────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  id: WorkspaceId,
  windows: z.array(WindowSchema),
  editorTabs: z.record(TabId, TabSchema).default({}),
  /** System tabs (sidebar panels), keyed by system tab ID. */
  systemTabs: z.record(SystemTabId, SystemTabSchema).default({}),
  tabGroups: z
    .record(
      TabGroupId,
      z.object({
        id: TabGroupId,
        parentTabId: z.string(),
        childTabIds: z.array(z.string()),
      }),
    )
    .default({}),
  scopedFolders: z.array(z.string()).default([]),
  /** Shared sidebar docking/open state for every window in the workspace. */
  sidebar: WorkspaceSidebarSchema.default(createWorkspaceSidebar()),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export function createWorkspace(id: string): Workspace {
  const window0 = createWindow(`win-${id}-0`);

  return WorkspaceSchema.parse({
    id,
    windows: [
      {
        ...window0,
        sidebar: {
          ...window0.sidebar!,
          activeLeftTab: null,
          activeRightTab: null,
        },
      },
    ],
    editorTabs: {},
    systemTabs: {},
    sidebar: createWorkspaceSidebar(),
  });
}

// ─── Computed Layout ───────────────────────────────────────────────────────

/** Result of layout computation: maps tab IDs to their pixel rects. */
export type ComputedLayout = Map<TabId, Rect>;
