/**
 * TabController interface — every app tab must implement this.
 *
 * Controllers own tab content state outside the DOM and survive tab switches
 * (unmount → keep controller registered → mount on return).
 *
 * Lifecycle:
 *   createController(tabId, appType)
 *     → new instance, registerController(ctrl)
 *     → ctrl.restore(savedState)  // if restoring from session
 *     → ctrl.mount(container)     // tab enters DOM
 *     → ctrl.setVisible(false)    // tab switched away
 *     → ctrl.unmount()            // tab leaves DOM (but ctrl stays in registry)
 *     → ctrl.mount(container)     // tab switched back, same or new container
 *     → ctrl.setVisible(true)     // tab becomes active
 *     → ctrl.snapshot()           // serializable state for persistence
 */

import type { SurfaceWorkspace } from "openp41ge-sdk";

export interface TabController {
  readonly tabId: string;
  readonly appType: string;

  /** Called when the tab enters the DOM. Must create content inside `container`. */
  mount(container: HTMLElement): void;

  /** Called when the tab leaves the DOM. Detach resources (not processes), save state. */
  unmount(): void;

  /** Called when the tab's tab becomes active/inactive. Subclasses throttle output here. */
  setVisible(visible: boolean): void;

  /** Serializable state for save/restore across sessions. Must be JSON-safe. */
  snapshot(): Record<string, unknown>;

  /** Restore state after re-mount. Called before mount() or any render. */
  restore(state: Record<string, unknown>): void;
}

/**
 * FileViewerController — subtype of TabController for file-viewer tabs.
 *
 * Only FileEditorController implements this. Calling code uses
 * isFileViewerController() to safely access file-specific properties
 * instead of duck-typing against optional properties on TabController.
 */
export interface FileViewerController extends TabController {
  filePath: string;
  _isDirty: boolean;
  loadFile(path: string, fileName?: string): Promise<void>;
}

/** Type guard: checks if a TabController is a FileViewerController. */
export function isFileViewerController(ctrl: TabController): ctrl is FileViewerController {
  return ctrl.appType === "file-viewer";
}

/**
 * Registration record for an app type — how the app creates its controllers.
 */
export interface AppTypeRegistration {
  id: string;
  label: string;
  icon: string;
  description: string;
  createController: (tabId: string) => TabController;
  /** A settings tab: its handle shows the settings gear. */
  settings?: boolean;
  /** An extension grid surface's per-tab label (SDK `GridSurfaceSpec.tabLabel`). */
  tabLabel?: (params: Readonly<Record<string, unknown>>) => {
    title?: string;
    description?: string;
    icon?: string;
  };
  /** Whether it needs a workspace open (default "required"): a window with
   *  no workspace opens only "none" app types. */
  workspace?: SurfaceWorkspace;
}

// ─── System Tab Registration ──────────────────────────────────────────────

/**
 * SystemTabController — interface for system tab content in the sidebar.
 *
 * Simpler lifecycle than TabController since system tabs don't support
 * preview slots, pinning in the same way, or cross-cell dragging.
 * They mount/unmount with the sidebar's active tab.
 */
export interface SystemTabController {
  readonly tabId: string;
  readonly appType: string;
  mount(container: HTMLElement): void | Promise<void>;
  unmount(): void;

  /**
   * Optional keep-alive hook: the sidebar keeps the controller/element mounted
   * while the tab is inactive, but tells it to suspend background work (reloads,
   * listeners, recompute) so hidden tabs cost nothing. Controllers should mark
   * a dirty bit on changes and reconcile in place when made visible again.
   * Mirrors the main-app TabController.setVisible contract.
   */
  setVisible?(visible: boolean): void;
}

/**
 * A system tab's own, unique settings surface (a grid tab).
 *
 * Every sidebar tab owns exactly one settings grid tab. The tab's settings
 * button emits `openEvent` (a unique DOM event) to open it. This is generic so
 * extension-provided sidebar tabs can supply their own settings.
 */
export interface SystemTabSettings {
  /** Grid app type id for this tab's settings surface. */
  appType: string;
  /** Settings grid tab label. */
  label: string;
  /** Icon for the settings button/grid tab; defaults to a gear. */
  icon?: string;
  description?: string;
  /** Unique DOM event emitted by this tab's settings button to open it. */
  openEvent: string;
  /** Factory that creates the settings grid tab controller. */
  createController: (tabId: string) => TabController;
}

/**
 * Registration record for a system tab type.
 *
 * System tabs are sidebar-based app panels (e.g. the extensions' Explorer, History, Agents).
 * They are separate from editor tab types and use a simpler lifecycle.
 */
/** The sidebar + picker's groups, in their order. */
export const SIDEBAR_TAB_GROUPS = ["Workspace", "System", "Logs"] as const;
export type SidebarTabGroup = (typeof SIDEBAR_TAB_GROUPS)[number];

export interface SystemTabRegistration {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Default sidebar where this tab type opens when first created. */
  defaultSide: "left" | "right";
  /** Whether it needs a workspace open (default "required"): a window with
   *  no workspace offers only "none" sidebar tabs. */
  workspace?: SurfaceWorkspace;
  /** Its group in the sidebar's + picker. Default: "System" when it needs no
   *  workspace, else "Workspace". */
  group?: SidebarTabGroup;
  /** Factory function to create the system tab content controller. */
  createController: (tabId: string, config?: Record<string, unknown>) => SystemTabController;
  /** This tab's own, unique settings surface (grid tab). Optional. */
  settings?: SystemTabSettings;
  /**
   * When true, the tab is only registered (and only offered) in non-packaged
   * dev builds. Used for panels that are not ready for production — a
   * `devOnly` tab is dropped from packaged builds at registration time.
   */
  devOnly?: boolean;
}
