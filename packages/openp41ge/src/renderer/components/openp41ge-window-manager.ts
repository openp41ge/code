/**
 * <openp41ge-window-manager> — Window Manager window.
 *
 * The top level is a simple list of workspaces. Clicking a workspace row opens
 * that workspace's config as a grid cell in the workspace-editor grid (the
 * `openp41ge-extension-workspaces` extension), alongside the live workspace windows. The
 * top-level cards carry only an "Open workspace window" button — all workspace
 * editing (name, repositories, worktrees) lives in the workspace editor grid.
 */

import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { LitElement } from "lit";
import { state } from "lit/decorators.js";
import { REGEX_ICON, CASE_ON_ICON } from "./search-icons";
import "openp41ge-sdk-uikit";
import {
  tooltipController,
  OverlayScrollbar,
  DragOrchestrator,
  DRAG_EVENTS,
  GhostManager,
  type IDragSource,
  type IDropTarget,
  type TargetResolver,
  focusLineLayer,
  syncFocusLine,
} from "openp41ge-sdk-uikit";
import type { WorkspaceFileData } from "../../layout/types";
import type { Openp41geContextMenuElement } from "../interfaces/element-guards";
import "./openp41ge-settings-list";
import { settingsIcon } from "../icons";
import { CONFIG_EDITOR_APP_TYPE, configEditorTitle } from "../apps/config-editor/title";
import { openReleaseTab } from "../apps/release/index";
import { workspaceFileService } from "../services/workspace-file-service";
import { dataDirWorkspaces } from "../services/extension-renderer-loader";
import { WorkspaceRowDragSource } from "../services/drag-sources/workspace-row-drag-source";

/** Inset that trims the capturePage bitmap edge so the ghost isn't boxed (px). */
const ROW_GHOST_CAPTURE_INSET = 2;
import "./openp41ge-manager-grid";
import type { Openp41geManagerGrid } from "./openp41ge-manager-grid";

/** The namespaced app type id of the workspaces extension's editor surface. */
const WORKSPACE_EDITOR_APP_TYPE = "ext:openp41ge-extension-workspaces:workspace-editor";
import { registerManagerTabBar } from "../services/init-drag-system";
import { MANAGER_TAB_REORDER_EVENT } from "../services/drop-targets/manager-tab-bar-drop-target";
import { welcomePages } from "../content/welcome";
import { createLogger } from "openp41ge-core-logger";
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  NOTCH_WIDTH,
  NOTCH_OVERFLOW,
} from "openp41ge-core-constants";

const log = createLogger("openp41ge", "window-manager");

/** Default sidebar width for the manager window (matches the old fixed width). */
const DEFAULT_SIDEBAR_WIDTH = 300;
const SIDEBAR_WIDTH_STORAGE_KEY = "openp41ge:manager-sidebar-width";
/** The sidebar's open tabs and the active one, kept across reloads. */
const SIDEBAR_TABS_STORAGE_KEY = "openp41ge:manager-sidebar-tabs";

/** Hold a skeleton this long before the drag element appears (long-press pickup). */
const HOLD_MS = 350;
/** Pointer travel past this many px starts an immediate drag (below the long-press hold). */
const DRAG_THRESHOLD = 4;

/** Mini workspace-window skeleton: width/height (at half the old carousel size). */
const THUMB_W = 66;
const THUMB_H = 42;

interface OpenWindowSummary {
  windowId: string;
  windowType: "workspace" | "manager" | "logs";
  workspacePath: string | null;
}

/** Tabs available in the manager window's tab bar. */
type ManagerTabId = "workspaces" | "settings" | "welcome" | "releases" | "cleanup" | "migrations";

/** Labels for each manager tab, keyed by id. */
const MANAGER_TAB_LABELS: Record<ManagerTabId, string> = {
  welcome: "Welcome",
  workspaces: "Workspaces",
  settings: "Settings",
  releases: "Releases",
  cleanup: "Cleanup",
  migrations: "Migrations",
};

/** Workspaces glyph (material account-tree), as SVG markup for the Workspaces
 *  sidebar tab handle (`fill=currentColor` so it follows the tab's text colour). */
const WORKSPACES_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M120-80v-280h120v-160h200v-80H320v-280h320v280H520v80h200v160h120v280H520v-280h120v-80H320v80h120v280H120Zm280-600h160v-120H400v120ZM200-160h160v-120H200v120Zm400 0h160v-120H600v120ZM480-680ZM360-280Zm240 0Z"/></svg>';

/** Cleanup glyph (user-provided), as SVG markup for the Cleanup tab handle
 *  (`fill=currentColor` so it follows the tab's text colour). */
const CLEANUP_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M420-280h120v-100h100v-120H540v-100H420v100H320v120h100v100ZM160-120v-480l320-240 320 240v480H160Zm80-80h480v-360L480-740 240-560v360Zm240-270Z"/></svg>';

/** Releases tab icon (Material Symbols "deployed_code_update"). */
const RELEASES_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="m720-80 120-120-28-28-72 72v-164h-40v164l-72-72-28 28L720-80ZM480-800 243-663l237 137 237-137-237-137ZM120-321v-318q0-22 10.5-40t29.5-29l280-161q10-5 19.5-8t20.5-3q11 0 21 3t19 8l280 161q19 11 29.5 29t10.5 40v159h-80v-116L479-434 200-596v274l240 139v92L160-252q-19-11-29.5-29T120-321ZM578.5-58.5Q520-117 520-200t58.5-141.5Q637-400 720-400t141.5 58.5Q920-283 920-200T861.5-58.5Q803 0 720 0T578.5-58.5ZM480-491Z"/></svg>';

/** Tab handle icons, for the tabs that have one. */
const MANAGER_TAB_ICONS: Partial<Record<ManagerTabId, string>> = {
  workspaces: WORKSPACES_ICON,
  settings: settingsIcon(16),
  cleanup: CLEANUP_ICON,
  releases: RELEASES_ICON,
};

export class Openp41geWindowManager extends LitElement {
  @state() private _workspaces: Array<{ filePath: string; data: WorkspaceFileData }> = [];
  @state() private _openWindows: OpenWindowSummary[] = [];
  /** Open tabs in the bar; the welcome intro tab is removed for now, so the
   *  window lands on Workspaces. */
  @state() private _openTabs: ManagerTabId[] = ["workspaces"];
  @state() private _activeTab: ManagerTabId | null = "workspaces";

  // ═══ Focus line: the window's focus is in the sidebar or the grid (the
  // last zone clicked); its focused tab has the line while the window is
  // focused, as in a workspace window. ═══
  @state() private _windowFocused = document.hasFocus();
  @state() private _sidebarFocused = false;
  private readonly _onFocusZoneMouseDown = (e: Event): void => {
    const target = e.target as Element | null;
    if (target?.closest?.(".wm-sidebar")) this._sidebarFocused = true;
    else if (target?.closest?.("openp41ge-manager-grid")) this._sidebarFocused = false;
  };
  private readonly _onWindowFocusLine = (): void => {
    this._windowFocused = true;
  };
  private readonly _onWindowBlurLine = (): void => {
    this._windowFocused = false;
  };
  /** Whether this window remembers its sidebar tabs across reloads (not a
   *  window opened for one tab). */
  private _keepsTabs = true;
  /** The Cleanup tab lists something to review (its + menu entry gets a dot). */
  @state() private _cleanupPending = false;
  private _offCleanupChanged: (() => void) | null = null;
  /** Number of captured errors — drives the Errors tab badge. */
  @state() private _welcomeDismissed = false;
  /** Slide-transition phase for the welcome page (out-* / in-* / "" = idle). */
  /** Prevents overlapping navigations while a slide is playing. */
  @state() private _loaded = false;
  @state() private _addingWorkspace = false;
  @state() private _workspaceDeleteMode = false;
  /** Paths of workspaces selected in the list's delete mode. */
  @state() private _selectedWorkspaces: Set<string> = new Set();
  @state() private _listOverflows = false;
  /** The header is expanded into the workspace search bar. */
  @state() private _searchOpen = false;
  /** Raw text in the header search input. */
  @state() private _searchQuery = "";
  /** Match case in the header search. */
  @state() private _caseSensitive = false;
  /** Treat the header search query as a regular expression. */
  @state() private _useRegex = false;
  private _drag: {
    startX: number;
    startY: number;
    startScreenX: number;
    startScreenY: number;
    /** Cursor offset within the skeleton element (grab point), so the drag
     * element hangs from where the user actually grabbed it, not centred. */
    offsetX: number;
    offsetY: number;
    captureRect: { x: number; y: number; width: number; height: number } | null;
    path: string;
    label: string;
    active: boolean;
    mode: "open" | null;
  } | null = null;
  private _holdTimer: number | null = null;
  private _offEndSession: (() => void) | null = null;
  private _offOpenWindowsChanged: (() => void) | null = null;
  private _offWorkspaceFileChanged: (() => void) | null = null;
  private _offActivateTab: (() => void) | null = null;
  /** Subscription for a tab moved onto this window from another manager window. */
  private _offReceiveTab: (() => void) | null = null;
  /** Subscription for a tab removed from this window (moved to another/new window). */
  private _offRemoveTab: (() => void) | null = null;
  /** Unregister the tab bar from the drag system (called on disconnect). */
  private _unregisterManagerBar: (() => void) | null = null;
  /** Suppress the following row click after a drag/swipe, so the row doesn't open. */
  private _suppressClick = false;
  private _tooltipTargets: Element[] = [];
  private _overlayScrollbar: OverlayScrollbar | null = null;

  // ── Sidebar resize (drag bar) ──────────────────────────────────────────
  /** Sidebar width in pixels. Applied directly to the DOM during a drag (no
   *  full re-render per mousemove) and persisted across launches. */
  private _sidebarWidth =
    parseInt(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "", 10) || DEFAULT_SIDEBAR_WIDTH;
  private _resizeActive = false;
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;

  // ── Workspace-row drag (row → manager grid cell) ──────────────────────
  /** Orchestrator driving workspace-row drags into the manager grid. */
  private _rowOrchestrator: DragOrchestrator | null = null;
  /** Deferred `drag:start` params, fired on the first POSITION event so the
   *  main process captures a pixel-accurate row bitmap at drag threshold. */
  private _pendingRowDragStart: {
    label: string;
    screenX: number;
    screenY: number;
    appType: string;
    tabConfig: Record<string, unknown>;
    winId: string;
    offsetX: number;
    offsetY: number;
    elementWidth: number;
    elementHeight: number;
    captureRect: { x: number; y: number; width: number; height: number };
  } | null = null;
  private _rowDragActive = false;
  private _rowDragActivated = false;
  private _rowDragSource: IDragSource | null = null;
  /** Renders the cell-highlight drop box (blue wash + border) while dragging a
   *  workspace row over the manager grid. The row drag runs on its own
   *  orchestrator, so the shared init-drag-system `updateGridGhost` (which
   *  reads `_currentSource`) never fires — hence the drop had no indicator. */
  private _rowGhostManager = new GhostManager();
  /** Grid element whose drop-box overlay is currently shown during a row drag. */
  private _rowGhostShownGrid: HTMLElement | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("focus", this._onFocus);
    window.addEventListener("focus", this._onWindowFocusLine);
    window.addEventListener("blur", this._onWindowBlurLine);
    this.shadowRoot?.addEventListener("mousedown", this._onFocusZoneMouseDown, true);
    window.addEventListener("resize", this._measureListOverflow);
    document.addEventListener("keydown", this._onKeydown);
    // Welcome intro action buttons live inside the shadow DOM, so clicks are
    // delegated at the shadow root (they're retargeted to the host by the time
    // they reach a document listener).
    this.shadowRoot?.addEventListener("click", this._onShadowClick);
    // The Settings tab's content emits its dirty/saving/show-defaults state so
    // the custom settings footer can stay in sync.
    // Any new pointer press clears the drag-follow-up suppression. A click can
    // only follow a drag within the same gesture (no pointerdown between), so a
    // fresh press always means the previous drag's follow-up click is moot.
    document.addEventListener("pointerdown", this._onPointerDown);
    // When a drag-out opens a workspace window in the main process (cursor left
    // the window), the main process ends the session and notifies us to clear
    // the in-flight drag state.
    // Keep the Logs tab badge in sync with captured errors, and switch to the
    // Logs tab when an error toast is clicked (event from error-capture).
    // Keep the Logs tab badge in sync with captured errors, and switch to the
    // Logs tab when an error toast is clicked (event from error-capture).
    this._offEndSession = window.openp41ge.drag.onEndSession(() => this._teardownDrag());
    // Refresh the open-windows column immediately when any window opens/closes,
    // rather than waiting for this window to regain focus.
    this._offOpenWindowsChanged = window.openp41ge.windowManager.onOpenWindowsChanged(() => {
      void this._load();
    });
    // A workspace file changed (renamed, repos edited — in any window).
    this._offWorkspaceFileChanged =
      window.openp41ge.workspaceController?.onWorkspaceFileChanged?.(() => void this._load()) ??
      null;
    // A menu item may request a specific tab when the manager window is already
    // open; activate it and bring the window to front (done in main).
    // Whether the Cleanup tab has something to review (a dot in the + menu).
    const cleanup = window.openp41ge.cleanup;
    if (cleanup) {
      const refresh = (): void => {
        cleanup.list().then(
          (items) => (this._cleanupPending = items.length > 0),
          () => undefined,
        );
      };
      this._offCleanupChanged = cleanup.onChanged(refresh);
      refresh();
    }
    this._offActivateTab = window.openp41ge.windowManager.onActivateTab((tab) => {
      if (
        tab === "workspaces" ||
        tab === "settings" ||
        tab === "welcome" ||
        tab === "releases" ||
        tab === "cleanup"
      ) {
        this._activateTab(tab);
      }
    });
    // Another manager window moved a tab onto this one; insert it at the
    // requested index and activate it.
    this._offReceiveTab =
      window.openp41ge.windowManager.onReceiveTab?.(({ tabId, index }) => {
        if (!tabId) return;
        this._receiveOpenTab(tabId, typeof index === "number" ? index : this._openTabs.length);
      }) ?? null;
    // This window's tab was moved to another (or a new) manager window.
    this._offRemoveTab =
      window.openp41ge.windowManager.onRemoveTab?.(({ tabId }) => {
        if (!tabId) return;
        this._removeOpenTab(tabId);
      }) ?? null;
    // Fresh window opened for a specific tab (e.g. drag-out of a management
    // tab, or app menu > Settings): it should open with ONLY that tab, not
    // the default "workspaces" plus the appended launch tab.
    const launchTab = window.openp41ge.workspace.getLaunchTab();
    if (launchTab) {
      this._openTabs = [launchTab];
      this._activeTab = launchTab;
      // A window opened for one tab is not the manager's own: its tabs are
      // not the ones to reopen next time.
      this._keepsTabs = false;
    } else {
      this._restoreTabs();
    }
    void this._load();
    // If the user opted out of the welcome intro, don't land on it (or open it)
    // on future launches. Dismissal is a marker file in the app-data dir.
    void window.openp41ge.welcome.isDismissed().then((dismissed) => {
      if (dismissed) {
        this._welcomeDismissed = true;
        if (this._activeTab === "welcome") {
          this._activateTab("workspaces");
          this._closeTab("welcome");
        }
      }
    });
  }

  /** Reopen the sidebar tabs open before the last reload (unknown ids dropped). */
  private _restoreTabs(): void {
    let saved: { open?: unknown; active?: unknown } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(SIDEBAR_TABS_STORAGE_KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved || !Array.isArray(saved.open)) return;
    const known = (id: unknown): id is ManagerTabId =>
      typeof id === "string" && id in MANAGER_TAB_LABELS;
    const open = saved.open.filter(known);
    this._openTabs = open;
    this._activeTab =
      known(saved.active) && open.includes(saved.active) ? saved.active : (open[0] ?? null);
  }

  /** Remember the sidebar's tabs (best-effort: storage may be unavailable). */
  private _saveTabs(): void {
    try {
      localStorage.setItem(
        SIDEBAR_TABS_STORAGE_KEY,
        JSON.stringify({ open: this._openTabs, active: this._activeTab }),
      );
    } catch {
      // not kept across reloads
    }
  }

  /** After the first render, register the tab bar with the drag system so
   *  management tabs can be reordered / dragged. Also listens for the drop
   *  target's reorder event on the bar. */
  firstUpdated(): void {
    const barEl = this.shadowRoot?.querySelector<HTMLElement>(".wm-tabbar");
    if (!barEl) return;
    this._unregisterManagerBar = registerManagerTabBar(barEl, this._myWindowId());
    barEl.addEventListener(MANAGER_TAB_REORDER_EVENT, this._onManagerTabReorder);
    this._setupRowDrag();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("focus", this._onFocus);
    window.removeEventListener("focus", this._onWindowFocusLine);
    window.removeEventListener("blur", this._onWindowBlurLine);
    this.shadowRoot?.removeEventListener("mousedown", this._onFocusZoneMouseDown, true);
    focusLineLayer().hide(this);
    window.removeEventListener("resize", this._measureListOverflow);
    document.removeEventListener("keydown", this._onKeydown);
    this.shadowRoot?.removeEventListener("click", this._onShadowClick);
    document.removeEventListener("pointerdown", this._onPointerDown);
    this._offEndSession?.();
    this._offOpenWindowsChanged?.();
    this._offOpenWindowsChanged = null;
    this._offWorkspaceFileChanged?.();
    this._offWorkspaceFileChanged = null;
    this._offActivateTab?.();
    this._offActivateTab = null;
    this._offCleanupChanged?.();
    this._offCleanupChanged = null;
    this._offReceiveTab?.();
    this._offReceiveTab = null;
    this._offRemoveTab?.();
    this._offRemoveTab = null;
    this._unregisterManagerBar?.();
    this._unregisterManagerBar = null;
    for (const el of this._tooltipTargets) tooltipController.detach(el);
    this._tooltipTargets = [];
    this._overlayScrollbar?.destroy();
    this._overlayScrollbar = null;
    this._teardownRowDrag();
  }

  /** Attach custom tooltips to the footer tool buttons (replaces native `title`),
   *  and remember the sidebar's tabs when they change. */
  updated(changed: Map<string, unknown>): void {
    // The sidebar's focused tab's line floats over it (the toolkit's, as on
    // every tab bar; the grid's tab bars show their own).
    syncFocusLine(this, this.shadowRoot?.querySelector(".wm-tabbar") ?? null);
    if (this._keepsTabs && (changed.has("_openTabs") || changed.has("_activeTab"))) {
      this._saveTabs();
    }
    this._measureListOverflow();
    const btns = this.shadowRoot?.querySelectorAll<HTMLElement>(
      ".dw-search, .wm-search-toggle, .wm-search-clear, .dw-add, .dw-delete, .dw-delete-cancel, .dw-delete-confirm, .wm-tab-close, .wm-tabbar-add",
    );
    const live = new Set<Element>();
    if (btns) {
      for (const btn of btns) {
        const text = btn.getAttribute("data-tip");
        if (text) {
          tooltipController.attach(btn, { type: "simple", text });
          live.add(btn);
        }
      }
    }
    for (const el of this._tooltipTargets) {
      if (!live.has(el)) tooltipController.detach(el);
    }
    this._tooltipTargets = [...live];

    // Attach the custom overlay scrollbar to the workspace list once. It floats
    // over the list (no reserved gutter) and sits below the pinned footer.
    if (!this._overlayScrollbar) {
      const body = this.shadowRoot?.querySelector<HTMLElement>(".wm-body");
      const content = this.shadowRoot?.querySelector<HTMLElement>(".wm-sidebar-content");
      if (body && content) {
        this._overlayScrollbar = OverlayScrollbar.attach(body, {
          axis: "vertical",
          container: content,
          inset: { top: "0" },
          zIndex: 0,
          size: 9,
          autoHide: true,
          // The track lives in this component's shadow root, so inject the
          // overlay styles there (document-level styles don't cross the
          // shadow boundary).
          styleTarget: this.shadowRoot ?? undefined,
        });
      }
    }
  }

  /**
   * The last row shows a trailing separator only when the list doesn't overflow
   * (content fits the viewport). When the list scrolls, the trailing separator is
   * removed so a scrolled-to-bottom last row doesn't double up with the viewport
   * edge. Measure after every render and on window resize.
   */
  private _measureListOverflow = (): void => {
    const body = this.shadowRoot?.querySelector(".wm-body");
    if (!body) return;
    const overflow = body.scrollHeight > body.clientHeight + 1;
    if (overflow !== this._listOverflows) this._listOverflows = overflow;
  };

  // ═══ Sidebar resize (drag bar) ────────────────────────────────────────

  /** Start dragging the sidebar's resize notch. Mirrors the workspace/logs
   *  windows: track the pointer on `document`, keep the blue `<drag-line>` lit
   *  for the whole drag, and clamp to the shared min/max sidebar widths. */
  private _onSidebarResizeStart(e: MouseEvent): void {
    e.preventDefault();
    this._resizeActive = true;
    this._resizeStartX = e.clientX;
    this._resizeStartWidth = this._sidebarWidth;
    this._setSidebarDragLine(true);
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", this._onSidebarResizeMove);
    document.addEventListener("mouseup", this._onSidebarResizeEnd);
  }

  private _onSidebarResizeMove = (e: MouseEvent): void => {
    if (!this._resizeActive) return;
    const dx = e.clientX - this._resizeStartX;
    // The sidebar sits on the left of the grid: dragging right (+dx) widens it.
    const width = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, this._resizeStartWidth + dx),
    );
    this._applySidebarWidth(width);
  };

  private _onSidebarResizeEnd = (): void => {
    if (!this._resizeActive) return;
    this._resizeActive = false;
    this._setSidebarDragLine(false);
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", this._onSidebarResizeMove);
    document.removeEventListener("mouseup", this._onSidebarResizeEnd);
    // Persist the width so the sidebar keeps its size across launches.
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(this._sidebarWidth));
    // Re-evaluate the list overflow (and its trailing separator) now that the
    // sidebar width has settled.
    this.requestUpdate();
  };

  /** Set the sidebar width: keep the value for re-renders and apply it live to
   *  the DOM (no re-render needed while dragging). */
  private _applySidebarWidth(width: number): void {
    this._sidebarWidth = width;
    const el = (this.renderRoot as ShadowRoot | null)?.querySelector<HTMLElement>(".wm-sidebar");
    if (el) el.style.width = `${width}px`;
  }

  /** Toggle the shared `<drag-line>` inside the resize notch (hover / dragging). */
  private _setSidebarDragLine(on: boolean): void {
    const line = (this.renderRoot as ShadowRoot | null)?.querySelector(".wm-notch-v drag-line");
    if (line) line.toggleAttribute("show", on);
  }

  /** Welcome intro action buttons (e.g. "Open Workspaces") activate their tab. */
  private _onShadowClick = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.("button.wm-md-button[data-tab]") as HTMLElement | null;
    if (!btn) return;
    const tab = btn.dataset.tab ?? "";
    if (
      tab === "workspaces" ||
      tab === "settings" ||
      tab === "welcome" ||
      tab === "releases" ||
      tab === "cleanup"
    ) {
      this._activateTab(tab);
    }
  };

  /** Hover a workspace skeleton: pre-capture its bitmap so the drag ghost has
   * the real skeleton ready at drag.start even for a fast grab-and-drag. The
   * pointer-down re-request reuses this cache (see the prepare-bitmap handler). */
  private _onThumbPointerEnter(e: PointerEvent, path: string, isOpen: boolean): void {
    if (isOpen) return;
    const thumb = e.currentTarget as HTMLElement;
    const rect = thumb.getBoundingClientRect();
    window.openp41ge.drag.prepareBitmap({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  /** Begin a pointer press on a workspace skeleton (drag-out). */
  private _onThumbPointerDown(e: PointerEvent, path: string, isOpen: boolean): void {
    if (e.button !== 0) return;
    // An already-open workspace isn't an interactive drag handle — avoid a second
    // open affordance on top of the already-open window.
    if (isOpen) return;
    this._teardownDrag();
    const ws = this._workspaces.find((w) => w.filePath === path);
    const thumb = e.currentTarget as HTMLElement;
    const rect = thumb.getBoundingClientRect();
    const captureRect = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    // Pre-capture the skeleton bitmap now so the ghost can pop with the real
    // skeleton the instant the drag starts, rather than waiting for the async
    // capture that runs after drag.start.
    window.openp41ge.drag.prepareBitmap(captureRect);
    this._drag = {
      startX: e.clientX,
      startY: e.clientY,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      captureRect,
      path,
      label: ws?.data.name?.trim() || "Unnamed",
      active: false,
      mode: null,
    };
    try {
      thumb.setPointerCapture?.(e.pointerId);
    } catch (err) {
      log.debug("window-manager thumb setPointerCapture failed (synthetic pointer):", err);
    }
    // A short hold shows the drag element without any pointer movement (long-press
    // pickup). A quick drag that crosses the threshold clears this timer and starts
    // the drag from the move handler instead.
    this._clearHoldTimer();
    this._holdTimer = window.setTimeout(() => this._beginOpenDrag(), HOLD_MS);
  }

  /** Long-press fired: show the drag element (open mode) at the press point. */
  private _beginOpenDrag(): void {
    this._holdTimer = null;
    const drag = this._drag;
    if (!drag || drag.active) return;
    drag.active = true;
    this._suppressClick = true;
    this._startOpenDrag(drag.startScreenX, drag.startScreenY);
    window.openp41ge.drag.move(drag.startScreenX, drag.startScreenY);
  }

  /**
   * Put the in-flight gesture into open mode: start a real (native) drag so the
   * ghost can leave the window. Passes the skeleton's capture rect so the main
   * process swaps in a bitmap of the actual skeleton (not just a label). The
   * window opens on the drop, only if the cursor is outside this window at
   * release. Called from the long-press and from the first move past the
   * threshold.
   */
  private _startOpenDrag(screenX: number, screenY: number): void {
    const drag = this._drag;
    if (!drag) return;
    drag.mode = "open";
    window.openp41ge.drag.start(
      drag.label,
      screenX,
      screenY,
      "🗂",
      undefined,
      undefined,
      undefined,
      THUMB_W,
      THUMB_H,
      drag.offsetX,
      drag.offsetY,
      "workspace",
      drag.path,
      drag.captureRect ?? undefined,
      0,
    );
    window.openp41ge.drag.activate();
  }

  private _clearHoldTimer(): void {
    if (this._holdTimer !== null) {
      window.clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
  }

  /**
   * Once the drag passes the threshold it is always a drag-out (the carousel is
   * gone, so there is no swipe gesture to disambiguate). A drag means the
   * following row click is not a navigation — suppress it so the workspace
   * doesn't open over the drag. Cleared by the next pointerdown (see
   * _onPointerDown) or by the row click itself.
   */
  private _onThumbPointerMove(e: PointerEvent): void {
    const drag = this._drag;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.active) {
      if (drag.mode === "open") window.openp41ge.drag.move(e.screenX, e.screenY);
      return;
    }
    // A small movement kickstarts the drag immediately — the long-press hold
    // delay is only for grab-and-hold with no movement, not for a quick drag.
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    // A real drag beat the long-press timer — cancel the pending pickup.
    this._clearHoldTimer();
    drag.active = true;
    this._suppressClick = true;
    this._startOpenDrag(e.screenX, e.screenY);
  }

  /** Release: open the workspace only if the cursor was outside this window at the drop. */
  private _onThumbPointerUp(e: PointerEvent): void {
    this._clearHoldTimer();
    const drag = this._drag;
    if (!drag) return;
    const { mode, path } = drag;
    this._teardownDrag();
    if (mode === null) return;
    // Compute outside synchronously (window.screenX/screenY match the main
    // process window bounds) and end the drag in the same tick. Awaiting an
    // IPC before drag.end() left a window in which a second drag could start
    // and have its session/ghost clobbered by the delayed drag.end().
    const outside =
      e.screenX < window.screenX ||
      e.screenX > window.screenX + window.outerWidth ||
      e.screenY < window.screenY ||
      e.screenY > window.screenY + window.outerHeight;
    // Only an open drag has a ghost session to tear down.
    if (mode === "open") window.openp41ge.drag.end();
    // A release outside this window opens the workspace.
    if (outside) this._openWorkspaceWindow(path);
  }

  private _onThumbPointerCancel(): void {
    this._clearHoldTimer();
    const drag = this._drag;
    if (!drag) return;
    if (drag.mode === "open") window.openp41ge.drag.end();
    this._teardownDrag();
  }

  private _teardownDrag(): void {
    this._clearHoldTimer();
    this._drag = null;
  }

  // ── Workspace-row drag setup ────────────────────────────────────────

  private _setupRowDrag(): void {
    if (this._rowOrchestrator) return;
    this._rowOrchestrator = new DragOrchestrator(this._resolveRowTarget);
    this.shadowRoot?.addEventListener("mousedown", this._onRowMouseDown);
  }

  private _teardownRowDrag(): void {
    this._endRowDrag();
    this._rowOrchestrator?.dispose();
    this._rowOrchestrator = null;
    this.shadowRoot?.removeEventListener("mousedown", this._onRowMouseDown);
  }

  /**
   * Resolve the drop target for a workspace-row drag. The manager grid's
   * `<tab-grid>` lives inside `openp41ge-manager-grid`'s shadow root, so
   * `document.elementFromPoint` can't see it — resolve from that shadow root
   * with the same viewport coordinates (mirrors the logs window).
   *
   * Chromium's shadow-root `elementFromPoint` does NOT scope its hit-test to
   * that tree: it returns the true topmost element in the WHOLE document. So
   * when the manager overlays the grid (the "Select a workspace" empty-grid
   * placeholder) that overlay
   * is returned instead of the `<tab-grid>` contents beneath it, and a row drop
   * could never resolve. `elementsFromPoint` returns the full stacking stack
   * (topmost first) INCLUDING the grid's shadow-tree elements beneath any
   * manager overlay, so walk it to find the real drop target.
   */
  private _resolveRowTarget: TargetResolver = (
    clientX: number,
    clientY: number,
  ): IDropTarget | null => {
    const grid = this.renderRoot?.querySelector(
      "openp41ge-manager-grid",
    ) as Openp41geManagerGrid | null;
    const root = (grid?.shadowRoot ?? document) as Document | ShadowRoot;
    const els = (
      root as { elementsFromPoint: (x: number, y: number) => Element[] }
    ).elementsFromPoint(clientX, clientY);
    if (!els.length) return null;
    // The grid occludes the drop region — do not drop a cell behind it. The
    // empty-grid placeholder is NOT a blocker: dropping on it should open the
    // first workspace-editor cell.
    for (const el of els) {
      const tabBarEl = el.closest?.("tab-bar");
      if (tabBarEl instanceof HTMLElement) {
        const dt = (tabBarEl as unknown as { dropTarget?: IDropTarget }).dropTarget;
        if (dt) return dt;
      }
      const gridEl = el.closest?.("tab-grid");
      if (gridEl instanceof HTMLElement) {
        const dt = (gridEl as unknown as { dropTarget?: IDropTarget }).dropTarget;
        if (dt) return dt;
      }
    }
    return null;
  };

  /**
   * What a row drags into the grid: a workspace row its workspace editor, a
   * settings row its settings editor. Null for anything else (or a workspace
   * row in delete mode).
   */
  private _rowDragSpec(target: Element | null): {
    row: HTMLElement;
    title: string;
    appType: string;
    tabConfig: Record<string, unknown>;
  } | null {
    const settingsRow = target?.closest?.("[data-settings-id]") as HTMLElement | null;
    const settingsId = settingsRow?.getAttribute("data-settings-id");
    if (settingsRow && settingsId) {
      return {
        row: settingsRow,
        title: configEditorTitle(settingsId),
        appType: CONFIG_EDITOR_APP_TYPE,
        tabConfig: { extensionId: settingsId, path: `config:${settingsId}` },
      };
    }
    if (target?.closest?.(".ws-del")) return null;
    const row = target?.closest?.(".ws-row") as HTMLElement | null;
    if (!row || this._workspaceDeleteMode) return null;
    const path = row.getAttribute("data-workspace-path") ?? "";
    const ws = path ? this._workspaces.find((w) => w.filePath === path) : undefined;
    if (!ws) return null;
    return {
      row,
      title: ws.data.name?.trim() || "Unnamed",
      appType: WORKSPACE_EDITOR_APP_TYPE,
      tabConfig: { path: ws.filePath, dir: dataDirWorkspaces() },
    };
  }

  /** Mousedown on a workspace or settings row: begin a row drag. */
  private _onRowMouseDown = (e: Event): void => {
    const me = e as MouseEvent;
    if (me.button !== 0) return;
    const spec = this._rowDragSpec(me.target as Element | null);
    if (!spec) return;
    const { row, title, appType, tabConfig } = spec;

    e.preventDefault();
    const source = new WorkspaceRowDragSource(appType, title, tabConfig);

    const rect = row.getBoundingClientRect();
    const captureRect = {
      x: rect.x + ROW_GHOST_CAPTURE_INSET,
      y: rect.y + ROW_GHOST_CAPTURE_INSET,
      width: Math.max(1, rect.width - ROW_GHOST_CAPTURE_INSET * 2),
      height: Math.max(1, rect.height - ROW_GHOST_CAPTURE_INSET * 2),
    };
    this._pendingRowDragStart = {
      label: title,
      screenX: me.screenX,
      screenY: me.screenY,
      appType,
      tabConfig,
      winId: this._myWindowId(),
      offsetX: me.screenX - (window.screenX + rect.left),
      offsetY: me.screenY - (window.screenY + rect.top),
      elementWidth: rect.width,
      elementHeight: rect.height,
      captureRect,
    };
    this._beginRowDrag(source);
    this._rowOrchestrator?.startDrag(source, me.clientX, me.clientY);
  };

  private _beginRowDrag(source: IDragSource): void {
    this._rowDragSource = source;
    if (this._rowDragActive) return;
    this._rowDragActive = true;
    this._rowDragActivated = false;
    document.addEventListener(DRAG_EVENTS.POSITION, this._onRowDragPosition);
    document.addEventListener(DRAG_EVENTS.END, this._onRowDragEnd);
    document.addEventListener("mousemove", this._onRowDragMouseMove);
  }

  /** First POSITION event past the threshold: start the main-process bitmap
   *  ghost (DragGhostManager) with the captured row bitmap, then keep moving. */
  private _onRowDragPosition = (e: Event): void => {
    if (!this._rowDragActive) return;
    const detail = (e as CustomEvent<{ screenX: number; screenY: number }>).detail;
    if (!detail) return;
    if (!this._rowDragActivated) {
      this._rowDragActivated = true;
      this._suppressClick = true;
      this._fireRowDragStart();
    }
    window.openp41ge?.drag?.move?.(detail.screenX, detail.screenY);
  };

  /** Fire the deferred workspace-row `drag:start` (open-tab payload). */
  private _fireRowDragStart(): void {
    const drag = window.openp41ge?.drag;
    const p = this._pendingRowDragStart;
    if (!drag?.start || !p) return;
    this._pendingRowDragStart = null;
    drag.start(
      p.label,
      p.screenX,
      p.screenY,
      undefined,
      undefined,
      p.winId,
      undefined,
      p.elementWidth,
      p.elementHeight,
      p.offsetX,
      p.offsetY,
      "open-tab",
      undefined,
      p.captureRect,
      ROW_GHOST_CAPTURE_INSET,
      { appType: p.appType, tabConfig: p.tabConfig },
    );
  }

  private _onRowDragEnd = (): void => {
    this._endRowDrag();
  };

  /** Every raw mousemove during a row drag — paints the live inline drop
   *  indicator over the grid cell under the cursor. The orchestrator's
   *  POSITION event only carries screen coords, so use the native client coords
   *  here (mirrors init-drag-system's `updateGridGhost` on mousemove). */
  private _onRowDragMouseMove = (ev: MouseEvent): void => {
    // Only paint the drop indicator once the drag has actually started (past
    // the threshold). A plain click still delivers a mousemove between
    // mousedown/mouseup, which must NOT show a drop target.
    if (!this._rowDragActive || !this._rowDragActivated) return;
    this._updateRowGridGhost(ev.clientX, ev.clientY);
  };

  /** Show the cell-highlight drop box (blue wash + border) for the grid cell
   *  under the cursor, or the wash-only box over a tab bar (so the tab bar's
   *  insert line reads clearly). Mirrors init-drag-system's `updateGridGhost`.
   */
  private _updateRowGridGhost(clientX: number, clientY: number): void {
    const source = this._rowDragSource;
    if (!source) {
      this._clearRowGridGhost();
      return;
    }
    const target = this._resolveRowTarget(clientX, clientY);
    if (!target) {
      this._clearRowGridGhost();
      return;
    }

    // Cursor over a grid cell's tab bar: the TabBarDropTarget owns the insert
    // line; suppress the landing box's border so the line reads clearly.
    if (target.type === "tab-bar") {
      const barEl = target.element as HTMLElement;
      const gridEl = barEl.closest("tab-grid");
      const col = (target as unknown as { col?: number }).col;
      if (!(gridEl instanceof HTMLElement) || col === undefined || col < 0) {
        this._clearRowGridGhost();
        return;
      }
      if (this._rowGhostShownGrid && this._rowGhostShownGrid !== gridEl) {
        this._rowGhostManager.hideGhost(this._rowGhostShownGrid);
        this._rowGhostShownGrid = null;
      }
      const gridCols = (gridEl as unknown as { cols?: number }).cols ?? 1;
      this._rowGhostManager.showGhost(gridEl, {
        cols: gridCols,
        activeCol: col,
        suppressFrame: true,
      });
      this._rowGhostShownGrid = gridEl;
      return;
    }

    if (target.type !== "grid") {
      this._clearRowGridGhost();
      return;
    }

    const feedback = target.onHover(source, clientX, clientY);
    if (!feedback?.showGhost || !feedback.ghostConfig) {
      this._clearRowGridGhost();
      return;
    }

    // Re-showing on the SAME grid must not tear down/rebuild the overlay on
    // every mousemove (that would re-fade the accent from opacity 0 and
    // flicker); `showGhost` reuses the existing overlay while attached. Only
    // tear it down when the target switches to a DIFFERENT grid.
    if (this._rowGhostShownGrid && this._rowGhostShownGrid !== target.element) {
      this._rowGhostManager.hideGhost(this._rowGhostShownGrid);
      this._rowGhostShownGrid = null;
    }

    const cfg = feedback.ghostConfig as Record<string, unknown>;
    this._rowGhostManager.showGhost(target.element, {
      cols: (cfg.cols as number) ?? 1,
      boundaryIndex: cfg.boundaryIndex as number | undefined,
      splitCol: cfg.splitCol as number | undefined,
      splitLeft: cfg.splitLeft as boolean | undefined,
      // GridDropTarget.onHover returns `mouseCol` in split config,
      // but `col` in cell-center config — handle both.
      activeCol: (cfg.mouseCol ?? cfg.col ?? 0) as number,
    });
    this._rowGhostShownGrid = target.element;
  }

  private _clearRowGridGhost(): void {
    if (this._rowGhostShownGrid) {
      this._rowGhostManager.hideGhost(this._rowGhostShownGrid);
      this._rowGhostShownGrid = null;
    }
  }

  private _endRowDrag(): void {
    if (!this._rowDragActive) return;
    window.openp41ge?.drag?.end?.();
    this._rowDragActive = false;
    this._rowDragActivated = false;
    this._clearRowGridGhost();
    this._rowDragSource = null;
    this._pendingRowDragStart = null;
    document.removeEventListener(DRAG_EVENTS.POSITION, this._onRowDragPosition);
    document.removeEventListener(DRAG_EVENTS.END, this._onRowDragEnd);
    document.removeEventListener("mousemove", this._onRowDragMouseMove);
  }

  /** A fresh pointer press marks the end of any drag-follow-up click window. */
  private _onPointerDown = (): void => {
    this._suppressClick = false;
  };

  /** Escape closes the inline new-workspace card or leaves workspace delete mode. */
  private _onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this._addingWorkspace) {
      this._addingWorkspace = false;
    } else if (this._workspaceDeleteMode) this._cancelWorkspaceDeleteMode();
  };

  /** Toggle + persist the "never show the welcome intro again" choice. */
  private _onWelcomeDismissToggle = (e: Event): void => {
    const on = (e as CustomEvent<{ checked: boolean }>).detail.checked;
    this._welcomeDismissed = on;
    void window.openp41ge.welcome.setDismissed(on);
  };

  private _onFocus = (): void => {
    void this._load();
  };

  private async _load(): Promise<void> {
    try {
      this._workspaces = await workspaceFileService.listWorkspaces();
    } catch (err) {
      log.error("window-manager listWorkspaces failed:", err, { skipToast: true });
      this._workspaces = [];
    }
    try {
      this._openWindows = await window.openp41ge.windowManager.openWindowSummaries();
    } catch (err) {
      log.error("window-manager openWindowSummaries failed:", err, { skipToast: true });
      this._openWindows = [];
    }
    this._loaded = true;
  }

  /** Open (or re-focus) a workspace-bound window; refresh open-state pills. */
  private _openWorkspaceWindow(path: string): void {
    window.openp41ge.windowManager.openWorkspaceWindow(path);
    window.setTimeout(() => void this._load(), 350);
  }

  /** Open a workspace's config in the grid's workspace-editor cell. When
   *  `pinned` is set (row double-tap / drop), the cell opens pinned. */
  private _openWorkspaceEditor(
    ws: { filePath: string; data: WorkspaceFileData },
    pinned = false,
  ): void {
    const grid = this.renderRoot?.querySelector(
      "openp41ge-manager-grid",
    ) as Openp41geManagerGrid | null;
    if (!grid) return;
    grid.openApp(
      WORKSPACE_EDITOR_APP_TYPE,
      ws.data.name?.trim() || "Unnamed",
      { path: ws.filePath, dir: dataDirWorkspaces() },
      undefined,
      pinned,
    );
  }

  /** Open a settings schema's editor (the platform's, or an extension's) in
   *  the grid: one tab per schema; `pinned` from a double-click. */
  private _openSettings(id: string, pinned: boolean): void {
    const grid = this.renderRoot?.querySelector(
      "openp41ge-manager-grid",
    ) as Openp41geManagerGrid | null;
    grid?.openApp(
      CONFIG_EDITOR_APP_TYPE,
      configEditorTitle(id),
      { extensionId: id, path: `config:${id}` },
      undefined,
      pinned,
    );
  }

  /** Open a release (a Releases tab row) in the grid: one tab per release;
   *  `pinned` from a double-click. */
  private _openRelease(tag: string, pinned: boolean): void {
    const grid = this.renderRoot?.querySelector(
      "openp41ge-manager-grid",
    ) as Openp41geManagerGrid | null;
    if (grid) openReleaseTab(grid, tag, pinned);
  }

  /** Search bar row shown above the workspace-list footer while search is open.
   *  Belongs to the Workspaces tab pane (it is toggled by that tab's footer). */
  private _workspaceSearchBar(): TemplateResult {
    return html`
      <div class="wm-search-bar">
        <div class="wm-search">
          <input
            class="wm-search-input"
            placeholder="Search workspaces…"
            spellcheck="false"
            .value=${this._searchQuery}
            @input=${this._onSearchInput}
            @keydown=${this._onSearchKeydown}
          />
          <button
            class="wm-search-toggle ${this._useRegex ? "wm-search-toggle--on" : ""}"
            aria-label="Regex search"
            aria-pressed=${this._useRegex}
            data-tip="Regex search"
            @click=${() => {
              this._useRegex = !this._useRegex;
            }}
          >
            ${unsafeHTML(REGEX_ICON)}
          </button>
          <button
            class="wm-search-toggle ${this._caseSensitive ? "wm-search-toggle--on" : ""}"
            aria-label="Match case"
            aria-pressed=${this._caseSensitive}
            data-tip=${this._caseSensitive ? "Match case (on)" : "Match case (off)"}
            @click=${() => {
              this._caseSensitive = !this._caseSensitive;
            }}
          >
            ${unsafeHTML(CASE_ON_ICON)}
          </button>
          <button
            class="wm-search-clear"
            aria-label="Clear search"
            data-tip="Close search"
            @click=${this._exitSearch}
          >
            ✕
          </button>
        </div>
      </div>
    `;
  }

  /** Footer for the top-level workspace list (+ / trashcan, delete mode). */
  private _workspaceListFooter(): TemplateResult {
    return html`
      <div class="ws-list-footer">
        <button
          class="dw-search"
          aria-label="Search workspaces"
          aria-pressed=${this._searchOpen}
          data-tip="Search workspaces"
          @click=${(e: Event) => {
            e.stopPropagation();
            if (this._searchOpen) {
              this._exitSearch();
            } else {
              this._startSearch();
            }
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
        <span class="wm-footer-spacer"></span>
        ${
          this._workspaceDeleteMode
            ? html`
                <button
                  class="dw-delete-cancel"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._cancelWorkspaceDeleteMode();
                  }}
                  data-tip="Cancel"
                >
                  Cancel
                </button>
                <button
                  class="dw-delete-confirm"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    void this._deleteSelectedWorkspaces();
                  }}
                  data-tip="Delete selected workspaces"
                  ?disabled=${this._selectedWorkspaces.size === 0}
                >
                  Delete
                </button>
              `
            : html`
                <button
                  class="dw-add"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._toggleAddWorkspace();
                  }}
                  aria-label="New workspace"
                  data-tip="New workspace"
                >
                  ＋
                </button>
                <button
                  class="dw-delete"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._activateWorkspaceDeleteMode();
                  }}
                  aria-label="Delete workspaces"
                  data-tip="Delete workspaces"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="18px"
                    viewBox="0 -960 960 960"
                    width="18px"
                    fill="currentColor"
                  >
                    <path
                      d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"
                    />
                  </svg>
                </button>
              `
        }
      </div>
    `;
  }

  /** Toggle the inline "new workspace" name row on the top-level list. */
  private _toggleAddWorkspace(): void {
    this._workspaceDeleteMode = false;
    this._addingWorkspace = !this._addingWorkspace;
    if (this._addingWorkspace) {
      void this.updateComplete.then(() => {
        this.shadowRoot?.querySelector<HTMLInputElement>(".wm-new-ws-input")?.focus();
      });
    }
  }

  /** Enter commits, Escape cancels the new-workspace name row. */
  private _onNewWorkspaceKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void this._createWorkspaceFromInput();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._addingWorkspace = false;
    }
  }

  /** Create a workspace from the inline name input, then refresh the list. */
  private async _createWorkspaceFromInput(): Promise<void> {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>(".wm-new-ws-input");
    const name = input?.value.trim() ?? "";
    this._addingWorkspace = false;
    if (!name) return;
    try {
      await workspaceFileService.createWorkspace(name);
    } catch (err) {
      log.error("window-manager createWorkspace failed:", name, err, { skipToast: true });
      return;
    }
    await this._load();
  }

  /** Whether a workspace matches the header search query (name / repo URL / worktree). */
  private _matchesQuery(
    ws: { data: WorkspaceFileData },
    query: string,
    caseSensitive: boolean,
    useRegex: boolean,
  ): boolean {
    if (!query) return true;
    const name = ws.data.name?.trim() || "Unnamed";
    const haystacks = [
      name,
      ...(ws.data.repos ?? []).map((r) => r.url),
      ...(ws.data.repos ?? []).flatMap((r) => r.worktrees ?? []),
    ];
    if (useRegex) {
      try {
        const re = new RegExp(query, caseSensitive ? "" : "i");
        return haystacks.some((h) => re.test(h));
      } catch (err) {
        log.debug("window-manager filter regex invalid:", query, err);
        return false;
      }
    }
    const needle = caseSensitive ? query : query.toLowerCase();
    return haystacks.some((h) =>
      caseSensitive ? h.includes(query) : h.toLowerCase().includes(needle),
    );
  }

  /** Workspaces shown in the list, honouring the header search query + toggles. */
  private get _filteredWorkspaces(): Array<{ filePath: string; data: WorkspaceFileData }> {
    const q = this._searchQuery;
    if (!q.trim()) return this._workspaces;
    return this._workspaces.filter((w) =>
      this._matchesQuery(w, q, this._caseSensitive, this._useRegex),
    );
  }

  /** Expand the header into the search bar and focus the input. */
  /** Activate a tab, opening it in the bar first if needed. */
  private _activateTab(id: ManagerTabId): void {
    if (!this._openTabs.includes(id)) this._openTabs = [...this._openTabs, id];
    this._activeTab = id;
  }

  /** Close a tab. Closing the last tab leaves the bar empty (a manager can
   *  have zero tabs; the + button re-opens tabs). */
  private _closeTab(id: ManagerTabId): void {
    const idx = this._openTabs.indexOf(id);
    if (idx === -1) return;
    const next = this._openTabs.filter((t) => t !== id);
    this._openTabs = next;
    if (this._activeTab === id) {
      this._activeTab = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
    }
  }

  /** This window's id (cached lazily). Used to register the bar for drags. */
  private _myWindowId(): string {
    return window.openp41ge?.workspace?.getWindowId?.() ?? "";
  }

  /** Reorder a tab to `toIndex` (after removing it from its current slot). */
  private _reorderOpenTab(tabId: string, toIndex: number): void {
    const idx = this._openTabs.indexOf(tabId as ManagerTabId);
    if (idx === -1) return;
    const next = this._openTabs.filter((t) => t !== tabId);
    const at = Math.max(0, Math.min(toIndex, next.length));
    next.splice(at, 0, tabId as ManagerTabId);
    this._openTabs = next;
  }

  /** A tab was dropped onto this window's bar from another manager window. */
  private _receiveOpenTab(tabId: string, index: number): void {
    if (!this._openTabs.includes(tabId as ManagerTabId)) {
      const next = [...this._openTabs];
      const at = Math.max(0, Math.min(index, next.length));
      next.splice(at, 0, tabId as ManagerTabId);
      this._openTabs = next;
    }
    this._activeTab = tabId as ManagerTabId;
  }

  /** A tab was moved off this window to another (or a new) manager window. */
  private _removeOpenTab(tabId: string): void {
    const idx = this._openTabs.indexOf(tabId as ManagerTabId);
    if (idx === -1) return;
    const next = this._openTabs.filter((t) => t !== tabId);
    this._openTabs = next;
    if (this._activeTab === tabId) {
      this._activeTab = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
    }
  }

  /** Fired by the manager tab-bar drop target after a same-window reorder drop. */
  private _onManagerTabReorder = (e: Event): void => {
    const detail = (e as CustomEvent).detail as {
      tabId: string;
      fromIndex: number;
      toIndex: number;
    };
    if (!detail?.tabId) return;
    this._reorderOpenTab(detail.tabId, detail.toIndex);
  };

  /** Open the inline + menu listing the available tabs, with an "O" badge on
   *  the right marking each tab already open in the bar. */
  private _onTabAddClick(e: Event): void {
    const btn = e.currentTarget as HTMLElement | null;
    const r = btn?.getBoundingClientRect();
    const menu = document.createElement("openp41ge-contextmenu") as Openp41geContextMenuElement;
    menu.x = Math.max(8, (r?.right ?? 160) - 160);
    menu.y = (r?.bottom ?? 0) + 2;
    // The Welcome tab is the landing tab and can't be opened again, so it is
    // not offered in the + menu (only Workspaces / Settings / Releases).
    menu.items = (Object.keys(MANAGER_TAB_LABELS) as ManagerTabId[])
      .filter((id) => id !== "welcome")
      .map((id) => ({
        label: MANAGER_TAB_LABELS[id],
        // Boxed "O" marker (mirrors the sidebar + menu) for tabs already open.
        badge: this._openTabs.includes(id) ? "O" : undefined,
        // Cleanup: something to review.
        dot: id === "cleanup" && this._cleanupPending,
        action: () => this._activateTab(id),
      }));
    document.body.appendChild(menu);
  }

  private _startSearch(): void {
    this._searchOpen = true;
    void this.updateComplete.then(() => {
      this.shadowRoot?.querySelector<HTMLInputElement>(".wm-search-input")?.focus();
    });
  }

  /** Collapse the search bar, clear the query, and reset the toggles. */
  private _exitSearch(): void {
    this._searchOpen = false;
    this._searchQuery = "";
    this._caseSensitive = false;
    this._useRegex = false;
  }

  private _onSearchInput(e: Event): void {
    this._searchQuery = (e.target as HTMLInputElement).value;
  }

  private _onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this._exitSearch();
    }
  }

  /** Enter workspace delete mode: cards become checkbox-selectable. */
  private _activateWorkspaceDeleteMode(): void {
    this._addingWorkspace = false;
    this._workspaceDeleteMode = true;
    this._selectedWorkspaces = new Set();
  }

  /** Leave workspace delete mode and clear the selection. */
  private _cancelWorkspaceDeleteMode(): void {
    this._workspaceDeleteMode = false;
    this._selectedWorkspaces = new Set();
  }

  /** Toggle whether a workspace card is selected for deletion. */
  private _toggleWorkspaceSelection(filePath: string): void {
    const next = new Set(this._selectedWorkspaces);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    this._selectedWorkspaces = next;
  }

  /** Delete the selected workspace files (keeping their data dirs), then refresh. */
  private async _deleteSelectedWorkspaces(): Promise<void> {
    const selected = this._selectedWorkspaces;
    this._workspaceDeleteMode = false;
    this._selectedWorkspaces = new Set();
    if (selected.size === 0) return;
    for (const path of selected) {
      try {
        await window.openp41ge.dialog.deleteWorkspaceFile(path, false);
      } catch (err) {
        log.error("window-manager delete workspace file failed:", path, err, { skipToast: true });
        // ignore individual failures
      }
    }
    await this._load();
  }

  /** "2 repos" / "1 repo" style label. */
  private _countLabel(n: number, singular: string): string {
    return `${n} ${n === 1 ? singular : singular + "s"}`;
  }

  /** Number of vertical columns/cells to draw for a window in the skeleton.
   *  The workspace grid only splits horizontally, so cells are one per column. */
  private _skeletonCells(
    win: { grid?: { placements?: unknown[]; cols?: number } } | undefined,
  ): number {
    const g = win?.grid;
    if (!g) return 1;
    return g.placements?.length || g.cols || 1;
  }

  /** Workspace paths that already have at least one live workspace window. */
  private get _openPaths(): Set<string> {
    return new Set(
      this._openWindows
        .filter((w) => w.windowType === "workspace" && w.workspacePath)
        .map((w) => w.workspacePath as string),
    );
  }

  render(): TemplateResult {
    // Workspaces that already have at least one live workspace window.
    const openPaths = this._openPaths;
    // Rows shown in the list — filtered by the header search when it is active.
    const filtered = this._searchQuery.trim() ? this._filteredWorkspaces : this._workspaces;

    return html`
      <style>
        *,
        *::before,
        *::after {
          box-sizing: border-box;
        }
        :host {
          display: flex;
          height: 100vh;
          background: var(--bg, #1e1e1e);
          color: var(--text-primary, #ddd);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .wm-root {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
          height: 100%;
          position: relative;
        }
        /* Frameless window title bar (native drag region). The Window Manager is
           not fullscreenable, so it renders its own close/minimize traffic-light
           buttons (no fullscreen/green) here. */
        .wm-titlebar {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          height: 35px; /* matches the workspace + logs titlebars (TITLEBAR_HEIGHT) */
          padding: 0 14px;
          gap: 12px;
          box-sizing: border-box;
          -webkit-app-region: drag;
          user-select: none;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #333);
        }
        .wm-winbtns {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          -webkit-app-region: no-drag;
        }
        .wm-winbtn {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: none;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: transparent;
          font-size: 9px;
          line-height: 1;
          cursor: pointer;
        }
        .wm-winbtn span {
          opacity: 0;
        }
        .wm-winbtn:hover {
          color: #222;
        }
        .wm-winbtn:hover span {
          opacity: 1;
        }
        .wm-winbtn--close {
          background: #ff5f57;
        }
        .wm-winbtn--min {
          background: #febc2e;
        }
        /* Tab bar: persistent navigation row below the window title bar, styled
           like the workspace window's <tab-bar>. Hosts the "Workspaces" tab
           (active), a per-tab close button, and a trailing "+" new-tab button. */
        .wm-tabbar {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          height: 35px;
          padding: 0;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #2d2d2d);
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
          user-select: none;
        }
        .wm-tabbar::-webkit-scrollbar {
          display: none;
        }
        .wm-tab {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          min-width: 105px;
          height: 34px;
          padding: 0 0 0 10px;
          border-right: 1px solid var(--divider, #333);
          font-size: 13px;
          line-height: 34px;
          cursor: pointer;
          white-space: nowrap;
          user-select: none;
          color: var(--text-secondary, #999);
        }
        .wm-tab--active {
          background: var(--border-divider, #2d2d2d);
          color: var(--text-primary, #ccc);
        }
        .wm-tab:hover {
          color: var(--text-primary, #ccc);
        }
        .wm-tab-icon {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          margin-right: 8px;
          line-height: 1;
        }
        .wm-tab-icon svg {
          display: block;
        }
        .wm-tab-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .wm-tab-badge {
          flex-shrink: 0;
          margin-left: 6px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 9px;
          background: rgba(140, 42, 42, 0.9);
          color: #fff;
          font-size: 11px;
          line-height: 18px;
          text-align: center;
          box-sizing: border-box;
        }
        /* The close button is the toolkit's <tab-close> (as on every tab
           handle); the bar only spaces it from the title. */
        .wm-tab-close {
          margin-left: 10px;
        }
        /* Trailing "+" new-tab button, full-height square pinned to the right
           side of the bar (margin-left:auto pushes it to the end). */
        .wm-tabbar-add {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          margin: 0 0 0 auto;
          font-size: 16px;
          line-height: 1;
          color: var(--text-secondary, #999);
          cursor: pointer;
          border-radius: 0;
          /* Left separator between the trailing "+" button and the tabs, so
             the right-pinned button reads as part of the bar. */
          border-left: 1px solid var(--divider, #333);
          box-sizing: border-box;
          user-select: none;
          transition:
            background 0.15s,
            color 0.15s;
        }
        .wm-tabbar-add:hover {
          background: var(--border-divider, #2d2d2d);
          color: #eee;
        }
        .wm-tabbar-add-glyph {
          display: block;
          line-height: 1;
          /* The + glyph renders low in its 34px button; lift just the glyph,
             leaving the hover fill square in place. */
          transform: translateY(-2px);
        }
        /* Search toggle: full-height square icon button on the far left of
           the persistent bottom bar; toggles the search bar that slides up
           above the footer. */
        .dw-search {
          flex: none;
          border: none;
          background: transparent;
          color: var(--text-secondary, #999);
          border-radius: 0;
          height: 100%;
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          /* Right-side separator between the search utility and the
             right-aligned add/delete action group. */
          border-right: 1px solid var(--divider, #333);
          /* Flush against the window's rounded bottom-left corner:
             content-box keeps the icon centred in the square content
             (like .wt-refresh-btn) while the 8px left padding grows the
             tile outward over the bar's removed left padding, insetting
             the icon from the corner while the hover fill touches the
             window edge. */
          box-sizing: content-box;
          padding-left: 8px;
          user-select: none;
        }
        .dw-search:hover,
        .dw-search[aria-pressed="true"] {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .wm-footer-spacer {
          flex: 1;
        }
        /* Search bar: a row that appears just above the workspace-list footer,
           inside the Workspaces tab pane. Toggled by the footer search button. */
        .wm-search-bar {
          display: flex;
          align-items: stretch;
          height: 34px;
          padding: 0;
          box-sizing: border-box;
          background: var(--bg-secondary, #161616);
          border-top: 1px solid var(--divider, #333);
        }
        .wm-search {
          display: flex;
          align-items: stretch;
          flex: 1;
          min-width: 0;
          height: 100%;
        }
        .wm-search-input {
          flex: 1;
          min-width: 0;
          height: 100%;
          background: transparent;
          color: var(--text-primary, #ddd);
          border: none;
          padding: 0 10px 0 14px;
          font-size: 13px;
          outline: none;
          caret-color: var(--text-primary, #ddd);
        }
        .wm-search-input::placeholder {
          color: var(--text-secondary, #777);
          font-weight: 400;
        }
        /* Full-height square action buttons (regex, case, clear) separated by
           border-left — mirrors the bottom bar's .p41ge-icon-btn look. */
        .wm-search-toggle,
        .wm-search-clear {
          flex: none;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          aspect-ratio: 1 / 1;
          padding: 0;
          border: none;
          border-left: 1px solid var(--divider, #333);
          border-radius: 0;
          background: transparent;
          color: var(--text-secondary, #999);
          cursor: pointer;
          transition:
            color 0.1s ease,
            background 0.1s ease;
        }
        .wm-search-toggle:hover,
        .wm-search-clear:hover {
          color: var(--text-primary, #ddd);
          background: var(--bg-hover, #2a2d2e);
        }
        .wm-search-toggle--on {
          color: var(--text-primary, #ddd);
        }
        .wm-search-toggle--on:hover {
          color: var(--text-primary, #ddd);
        }
        .wm-drawer-layer {
          position: relative;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: row;
          overflow: hidden;
        }
        .wm-sidebar {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          width: ${this._sidebarWidth}px;
          min-width: ${MIN_SIDEBAR_WIDTH}px;
          background: var(--bg-secondary, #161616);
          border-right: 1px solid var(--divider, #2d2d2d);
          overflow: hidden;
        }
        /* Resize notch (drag bar) on the sidebar's grid-facing edge. Mirrors
           the workspace/logs window notches: a 7px-wide, zero-width flex
           track (negative margins cancel the width) that straddles the
           sidebar/grid boundary and hosts the blue drag-line hover
           affordance. */
        .wm-notch-v {
          width: ${NOTCH_WIDTH}px;
          flex-shrink: 0;
          cursor: col-resize;
          position: relative;
          z-index: 10;
          background: transparent;
          margin-left: -${NOTCH_OVERFLOW}px;
          margin-right: -${NOTCH_WIDTH - NOTCH_OVERFLOW}px;
        }
        .wm-sidebar-content {
          position: relative;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .wm-main {
          position: relative;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          /* Match the grid surface to the sidebar/content (bg-secondary) so the
             grid region doesn't show the lighter root background. */
          background: var(--bg-secondary, #161616);
        }
        .wm-grid {
          position: absolute;
          inset: 0;
          display: block;
        }
        .wm-body {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          overflow-y: auto;
          /* Clip the horizontal page slide here (not on the pane) so the sticky
             nav/card still anchor to this scroll container. */
          overflow-x: hidden;
          /* Match the content view surface to the bottom bar / tab bar. */
          background: var(--bg-secondary, #161616);
          /* No horizontal padding so rows + separators span the full window width;
             the rows keep their own content inset. The list starts below the
             tab bar. Each tab pane owns its bottom bar (sticky in flow), so the
             body itself does not reserve space for an overlaying bar. */
          padding: 0;
          box-sizing: border-box;
        }
        .wm-body--welcome {
          /* The welcome slideshow controls are its own bottom bar. */
          padding-bottom: 0;
        }
        /* The workspaces list scrolls under the pinned footer; no drawer overlay. */
        ul {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        li.ws-row {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          cursor: pointer;
          border-bottom: 1px solid var(--divider, #2f3031);
          transition: background 0.1s ease;
        }
        /* Hover background on the row: a click opens the workspace-editor
           cell in the grid (and a double-click pins it). Uses the same grey
           as the active manager tab (--border-divider). */
        li.ws-row:hover {
          background: var(--border-divider, #2d2d2d);
        }
        /* The last row's trailing separator only renders when the list fits the
           viewport (not below the fold), so a folded last row never shows a
           second bottom border when it scrolls into view. */
        li.ws-row--last:not(.ws-row--last-visible) {
          border-bottom: none;
        }
        .ws-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .ws-name {
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 14px;
          font-weight: 600;
        }
        .ws-meta {
          color: var(--text-secondary, #999);
          font-size: 12px;
        }
        /* Right-edge icon button that opens the workspace window. */
        .ws-open-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--text-secondary, #999);
          cursor: pointer;
          transition:
            background 0.1s ease,
            color 0.1s ease;
        }
        .ws-open-btn:hover {
          background: var(--bg-hover, #2a2d2e);
          color: var(--text-primary, #e3e3e3);
        }
        .ws-open-btn svg {
          width: 16px;
          height: 16px;
          display: block;
        }
        .ws-open-btn:focus-visible {
          outline: 1px solid var(--accent, #569cd6);
          outline-offset: 1px;
        }

        /* Inline row of mini workspace-window skeletons (up to 3) sitting at the
           row's right edge, just before the edit button. */
        .ws-thumbs {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .ws-more {
          color: var(--text-secondary, #999);
          font-size: 11px;
          line-height: 1.25;
          user-select: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 1px;
        }

        /* Mini workspace-window skeleton: title bar + window layout, half the
           old carousel height. */
        .ws-thumb {
          position: relative;
          width: 66px;
          height: 42px;
          flex-shrink: 0;
          border-radius: 6px;
          background: var(--bg, #1e1e1e);
          border: 1px solid var(--divider, #444);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          cursor: grab;
        }
        .ws-thumb:active {
          cursor: grabbing;
        }
        .ws-row--open .ws-thumb {
          cursor: default;
        }
        .ws-thumb-chrome {
          height: 7px;
          flex-shrink: 0;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #333);
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 4px;
        }
        .ws-thumb-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--text-secondary, #999);
          opacity: 0.55;
        }
        .ws-win-body {
          flex: 1;
          min-height: 0;
          display: flex;
          gap: 2px;
          padding: 3px;
          min-width: 0;
        }
        .ws-win-side {
          width: 12px;
          flex-shrink: 0;
          background: var(--bg-secondary, #161616);
          border-radius: 2px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          padding: 2px 0;
        }
        .ws-thumb-side-row {
          width: 8px;
          height: 2px;
          border-radius: 1px;
          background: var(--bg-active, #37373d);
        }
        .ws-win-grid {
          flex: 1;
          display: flex;
          gap: 2px;
          min-width: 0;
        }
        .ws-thumb-cell {
          flex: 1 1 0;
          min-width: 0;
          background: var(--bg-active, #37373d);
          border-radius: 2px;
        }

        /* Edit (pencil) button: square corners, full border. */
        .ws-edit {
          flex-shrink: 0;
          align-self: center;
          width: 28px;
          height: 28px;
          padding: 0;
          box-sizing: border-box;
          border: 1px solid var(--divider, #333);
          border-radius: 0;
          background: transparent;
          color: var(--text-secondary, #999);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition:
            background 0.1s ease,
            color 0.1s ease;
        }
        .ws-edit:hover {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .ws-edit svg {
          display: block;
        }
        /* Confirm / cancel buttons on the inline "new workspace" row, sitting at
           the row's right edge (where the thumbs + edit button live on normal
           rows). Same rounded + hover treatment as the edit button. */
        .ws-new-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .ws-action {
          flex-shrink: 0;
          align-self: center;
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--text-secondary, #999);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition:
            background 0.1s ease,
            color 0.1s ease;
        }
        .ws-action:hover {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .ws-action svg {
          display: block;
        }
        /* Workspace-list delete mode + inline "new workspace" row. */
        .ws-row--select {
          cursor: pointer;
        }
        /* The inline "new workspace" row uses the standard solid separator; the
           dashed outline distinguishes it from a normal workspace row. */
        .ws-row--new {
          cursor: default;
        }
        .ws-row--new:hover {
          background: var(--bg-hover, #2a2d2e);
        }
        .wm-new-ws-input {
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary, #ddd);
          font-size: 14px;
          font-family: inherit;
          font-weight: 600;
          padding: 0;
          /* Align the placeholder with the workspace name in the other rows. */
          height: auto;
          align-self: flex-start;
        }
        .wm-new-ws-input::placeholder {
          color: var(--text-secondary, #777);
          font-weight: 400;
        }
        /* Skeleton placeholders for the inline "new workspace" card. */
        @keyframes ws-skeleton-pulse {
          0%,
          100% {
            opacity: 0.45;
          }
          50% {
            opacity: 1;
          }
        }
        .ws-skeleton {
          display: inline-block;
          border-radius: 4px;
          background: var(--bg-active, #37373d);
          animation: ws-skeleton-pulse 1.3s ease-in-out infinite;
        }
        .ws-skeleton--num {
          width: 118px;
          height: 12px;
          vertical-align: middle;
          margin-top: 4px;
        }
        .empty {
          color: var(--text-secondary, #777);
          font-size: 13px;
          padding: 0 16px;
          text-align: center;
        }
        /* The workspace-list empty state is centred both horizontally and
           vertically within the space above the tab's bottom bar. */
        .wm-workspaces-pane > .empty {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          min-height: 0;
        }
        /* Application-level tab panes (Welcome / Releases placeholders). */
        .wm-tab-pane {
          padding: 16px 14px;
        }
        /* Empty state shown when every tab has been closed: the bar still has
           the + button to re-open tabs. Centered in the body. */
        .wm-no-tabs {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-align: center;
          color: var(--text-secondary, #999);
          box-sizing: border-box;
        }
        .wm-no-tabs-title {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary, #ccc);
        }
        .wm-no-tabs-hint {
          margin: 0;
          font-size: 13px;
          line-height: 1.5;
          max-width: 220px;
        }
        /* Releases tab: fills the body edge-to-edge so the release cards
           scroll while the bottom bar (refresh) stays pinned to the bottom.
           The pane itself owns the scroll + footer, so the tab pane has no
           padding and is a full-height flex column. */
        .wm-releases-pane {
          height: 100%;
          padding: 0;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        .wm-releases-pane > openp41ge-releases-pane {
          flex: 1;
          min-height: 0;
        }
        .wm-cleanup-pane {
          height: 100%;
          padding: 0;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        .wm-cleanup-pane > openp41ge-cleanup-pane {
          flex: 1;
          min-height: 0;
        }
        .wm-migrations-pane {
          height: 100%;
          padding: 0;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        .wm-migrations-pane > openp41ge-migrations-pane {
          flex: 1;
          min-height: 0;
        }
        /* Settings pane: the list of settings schemas (rows carry their padding). */
        .wm-settings-pane {
          height: 100%;
          box-sizing: border-box;
        }
        /* Workspaces tab: a full-height flex column whose bottom group (search
           bar + footer) sticks to the bottom of the pane as the list scrolls. */
        .wm-workspaces-pane {
          display: flex;
          flex-direction: column;
          min-height: 100%;
          box-sizing: border-box;
        }
        .wm-workspaces-bottom {
          margin-top: auto;
          position: sticky;
          bottom: 0;
          /* Paint above the scrolling list rows. */
          z-index: 1;
        }
        /* Welcome slideshow pane: a flex column so the page content scrolls
           (in .wm-body) while the nav bar stays pinned to the bottom. */
        .wm-welcome {
          display: flex;
          flex-direction: column;
          min-height: 100%;
          box-sizing: border-box;
          padding: 16px 14px 0;
        }
        .wm-welcome .wm-markdown > :last-child {
          margin-bottom: 0;
        }
        .wm-tab-placeholder {
          margin: 0;
          font-size: 13px;
          color: var(--text-secondary, #999);
        }
        /* Welcome intro: typographic layout for the rendered markdown. */
        .wm-markdown {
          font-size: 14px;
          line-height: 1.75;
          color: var(--text-secondary, #a6a6a6);
          max-width: 68ch;
        }
        .wm-markdown h1 {
          font-size: 22px;
          margin: 0 0 18px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-primary, #f5f5f5);
        }
        .wm-markdown h2 {
          font-size: 15px;
          margin: 28px 0 12px;
          padding-bottom: 6px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--text-primary, #f0f0f0);
          border-bottom: 1px solid var(--divider, #333);
        }
        .wm-markdown p {
          margin: 0 0 14px;
        }
        .wm-markdown ul,
        .wm-markdown ol {
          margin: 0 0 14px;
          padding-left: 22px;
        }
        .wm-markdown li {
          margin: 5px 0;
        }
        .wm-markdown strong {
          color: var(--text-primary, #ffffff);
          font-weight: 700;
        }
        .wm-markdown code {
          background: var(--bg-active, #37373d);
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 12px;
        }
        .wm-markdown a {
          color: var(--accent, #79c0ff);
        }
        .wm-markdown .wm-md-button {
          display: inline-flex;
          align-items: center;
          margin: 4px 0 14px;
          padding: 6px 14px;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary, #eee);
          background: var(--bg-active, #37373d);
          border: 1px solid var(--divider, #444);
          border-radius: 5px;
          cursor: pointer;
        }
        .wm-markdown .wm-md-button:hover {
          background: var(--bg-hover, #45454d);
          color: var(--text-primary, #fff);
        }
        /* Info notes (markdown blockquote): indented box with an accent left rule. */
        .wm-markdown .wm-md-quote {
          margin: 0 0 14px;
          padding: 8px 12px;
          font-size: 13px;
          color: var(--text-secondary, #b0b0b0);
          background: var(--bg-active, #23232a);
          border-left: 3px solid var(--accent, #79c0ff);
          border-radius: 0 4px 4px 0;
        }
        .wm-markdown .wm-md-quote p {
          margin: 0;
        }
        /* Welcome footer bar pinned to the bottom of the pane. */
        .wm-slideshow-nav {
          position: sticky;
          bottom: 0;
          flex-shrink: 0;
          display: flex;
          align-items: stretch;
          justify-content: space-between;
          height: 34px;
          /* Break out of the pane's 14px side padding so the bar spans the full window width. */
          margin: 0 -14px;
          background: var(--bg-secondary, #161616);
          border-top: 1px solid var(--divider, #333);
        }
        /* Settings-style card for the "never show the welcome message again"
           toggle. Rendered in flow, right below the welcome content, with
           spacing on each side so it does not touch the tab edges. */
        .wm-welcome-dismiss {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          box-sizing: border-box;
          margin: 28px 24px 56px;
          padding: 10px 16px;
          border-radius: 10px;
          background: var(--bg-active, #23232a);
          border: 1px solid var(--divider, #333);
          color: var(--text-primary, #eee);
          font-family: inherit;
          user-select: none;
        }
        .wm-welcome-dismiss-label {
          font-size: 13px;
          font-weight: 500;
        }
        /* Workspace-window explainer: the animated demo spans 80% of the
           available width, and the explanation text (and any shortcut hints)
           stacks underneath it. The demo never changes its own width; the
           sidebars slide within it. */
        .wm-window-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          margin: 30px 0 40px;
        }
        .wm-window-stage > :first-child {
          width: 80%;
          flex: none;
        }
        .wm-window-stage > .wm-window-copy {
          width: 100%;
          flex: none;
        }
        .wm-window-stage strong {
          color: var(--text-primary, #fff);
        }
        /* The description column under the demo: text and any shortcut hints
           stack below the skeleton. */
        .wm-window-copy {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        /* Keyboard-shortcut hints under the explanation text. */
        .wm-markdown .wm-shortcuts {
          margin: 14px 0 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 12px;
          color: var(--text-secondary, #b0b0b0);
        }
        .wm-markdown .wm-shortcut {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .wm-markdown .wm-shortcuts .kbd {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          color: var(--text-primary, #eee);
          background: var(--bg-active, #2b2b31);
          border: 1px solid var(--divider, #3c3c3c);
          border-bottom-width: 2px;
          border-radius: 4px;
          padding: 3px 6px;
          line-height: 1;
          white-space: nowrap;
        }
        /* Workspace-list footer bar: pinned at the bottom of the list pane. */
        .ws-list-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-shrink: 0;
          height: 34px;
          padding: 0;
          border-top: 1px solid var(--divider, #333);
          background: var(--bg-secondary, #161616);
        }
        .dw-add {
          border: none;
          background: transparent;
          color: var(--text-secondary, #999);
          font-size: 20px;
          border-radius: 0;
          /* Full-height, square action button like the workspace window's
             .p41ge-icon-btn: fills the bottom bar, square, with a cap
             separator on the group's outer (left) edge. */
          height: 100%;
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          user-select: none;
          border-left: 1px solid var(--divider, #333);
        }
        .dw-add:hover {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .dw-delete,
        .dw-delete-confirm {
          border: none;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .dw-delete {
          border: none;
          background: transparent;
          color: var(--text-secondary, #999);
          border-radius: 0;
          /* Full-height, square action button with a separator line
             between it and the adjacent add button. */
          height: 100%;
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          border-left: 1px solid var(--divider, #333);
        }
        .dw-delete:hover {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .dw-delete svg {
          fill: currentColor;
        }
        .dw-delete-confirm {
          background: transparent;
          color: var(--text-secondary, #999);
        }
        .dw-delete-confirm:hover {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .dw-delete-confirm:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .dw-delete-cancel {
          border: none;
          background: transparent;
          color: var(--text-secondary, #999);
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          cursor: pointer;
          border-radius: 6px;
        }
        .dw-delete-cancel:hover {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .dw-checkbox {
          width: 14px;
          height: 14px;
          border: 1px solid var(--text-secondary, #999);
          border-radius: 3px;
          flex-shrink: 0;
          align-self: center;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: transparent;
        }
        .dw-checkbox--checked {
          background: var(--accent, #569cd6);
          border-color: var(--accent, #569cd6);
          color: #fff;
        }
        .dw-checkbox--checked::after {
          content: "✓";
          font-size: 11px;
          line-height: 1;
        }
      </style>
      <div class="wm-root">
        <div class="wm-titlebar">
          <div class="wm-winbtns">
            <button
              class="wm-winbtn wm-winbtn--close"
              aria-label="Close window"
              @click=${() => window.openp41ge?.window.close()}
            >
              <span>✕</span>
            </button>
            <button
              class="wm-winbtn wm-winbtn--min"
              aria-label="Minimize window"
              @click=${() => window.openp41ge?.window.minimize()}
            >
              <span>─</span>
            </button>
          </div>
        </div>
        <div class="wm-drawer-layer">
          <div class="wm-sidebar">
            <div class="wm-tabbar">
              ${this._openTabs.map(
                (id) => html`
                  <div
                    class="wm-tab ${this._activeTab === id ? "wm-tab--active" : ""}"
                    data-manager-tab=${id}
                    ?data-focused=${
                      this._activeTab === id && this._windowFocused && this._sidebarFocused
                    }
                    @click=${() => this._activateTab(id)}
                  >
                    ${
                      MANAGER_TAB_ICONS[id]
                        ? html`<span class="wm-tab-icon"
                            >${unsafeHTML(MANAGER_TAB_ICONS[id])}</span
                          >`
                        : nothing
                    }
                    <span class="wm-tab-title">${MANAGER_TAB_LABELS[id]}</span>
                    <tab-close
                      class="wm-tab-close"
                      data-tip="Close tab"
                      ?active=${this._activeTab === id}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._closeTab(id);
                      }}
                    ></tab-close>
                  </div>
                `,
              )}
              <div
                class="wm-tabbar-add"
                aria-label="New tab"
                data-tip="New tab"
                @click=${this._onTabAddClick}
              >
                <span class="wm-tabbar-add-glyph">+</span>
              </div>
            </div>
            <div class="wm-sidebar-content">
              <div class="wm-body${this._activeTab === "welcome" ? " wm-body--welcome" : ""}">
                ${
                  this._activeTab === null
                    ? html`<div class="wm-tab-pane wm-no-tabs">
                        <p class="wm-no-tabs-title">No tabs open</p>
                        <p class="wm-no-tabs-hint">
                          Use the + button above to open Workspaces, Settings, or Releases.
                        </p>
                      </div>`
                    : this._activeTab === "welcome"
                      ? html`
                          <div class="wm-tab-pane wm-welcome">
                            <div class="wm-markdown">${unsafeHTML(welcomePages[0] ?? "")}</div>
                            <div class="wm-welcome-dismiss">
                              <span class="wm-welcome-dismiss-label"
                                >Never show the welcome message again</span
                              >
                              <openp41ge-toggle
                                .checked=${this._welcomeDismissed}
                                label="Never show the welcome message again"
                                .onLabel=${"Yes"}
                                .offLabel=${"No"}
                                @change=${this._onWelcomeDismissToggle}
                              ></openp41ge-toggle>
                            </div>
                            <div class="wm-slideshow-nav"></div>
                          </div>
                        `
                      : this._activeTab === "releases"
                        ? html`<div class="wm-tab-pane wm-releases-pane">
                            <openp41ge-releases-pane
                              @open-release=${(e: CustomEvent<{ tag: string; pinned: boolean }>) =>
                                this._openRelease(e.detail.tag, e.detail.pinned)}
                            ></openp41ge-releases-pane>
                          </div>`
                        : this._activeTab === "migrations"
                          ? html`<div class="wm-tab-pane wm-migrations-pane">
                              <openp41ge-migrations-pane></openp41ge-migrations-pane>
                            </div>`
                          : this._activeTab === "cleanup"
                            ? html`<div class="wm-tab-pane wm-cleanup-pane">
                                <openp41ge-cleanup-pane></openp41ge-cleanup-pane>
                              </div>`
                            : this._activeTab === "settings"
                              ? html`<div class="wm-settings-pane">
                                  <openp41ge-settings-list
                                    .onOpen=${(id: string, pinned: boolean) => {
                                      // The click ending a row drag is not an open.
                                      if (this._suppressClick) {
                                        this._suppressClick = false;
                                        return;
                                      }
                                      this._openSettings(id, pinned);
                                    }}
                                  ></openp41ge-settings-list>
                                </div>`
                              : html`
                                  <div class="wm-workspaces-pane">
                                    ${
                                      this._loaded &&
                                      this._workspaces.length === 0 &&
                                      !this._addingWorkspace
                                        ? html`<p class="empty">No workspaces yet.</p>`
                                        : this._searchOpen &&
                                            this._workspaces.length > 0 &&
                                            filtered.length === 0
                                          ? html`<p class="empty">
                                              No workspaces match “${this._searchQuery}”.
                                            </p>`
                                          : html`
                                              <ul>
                                                ${
                                                  this._addingWorkspace
                                                    ? html`
                                                        <li class="ws-row ws-row--new">
                                                          <div class="ws-info">
                                                            <input
                                                              class="wm-new-ws-input"
                                                              placeholder="Enter workspace name"
                                                              spellcheck="false"
                                                              @keydown=${(e: KeyboardEvent) => this._onNewWorkspaceKeydown(e)}
                                                              @blur=${() => {
                                                                if (this._addingWorkspace)
                                                                  void this._createWorkspaceFromInput();
                                                              }}
                                                            />
                                                            <div class="ws-meta">
                                                              <span
                                                                class="ws-skeleton ws-skeleton--num"
                                                              ></span>
                                                            </div>
                                                          </div>
                                                          <div class="ws-new-actions">
                                                            <button
                                                              class="ws-action ws-action--confirm"
                                                              aria-label="Create workspace"
                                                              title="Create workspace"
                                                              @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                                              @click=${(e: Event) => {
                                                                e.stopPropagation();
                                                                void this._createWorkspaceFromInput();
                                                              }}
                                                            >
                                                              <svg
                                                                xmlns="http://www.w3.org/2000/svg"
                                                                height="24px"
                                                                viewBox="0 -960 960 960"
                                                                width="24px"
                                                                fill="#e3e3e3"
                                                              >
                                                                <path
                                                                  d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"
                                                                />
                                                              </svg>
                                                            </button>
                                                            <button
                                                              class="ws-action ws-action--cancel"
                                                              aria-label="Cancel"
                                                              title="Cancel"
                                                              @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                                              @click=${(e: Event) => {
                                                                e.stopPropagation();
                                                                this._addingWorkspace = false;
                                                              }}
                                                            >
                                                              <svg
                                                                xmlns="http://www.w3.org/2000/svg"
                                                                height="24px"
                                                                viewBox="0 -960 960 960"
                                                                width="24px"
                                                                fill="#e3e3e3"
                                                              >
                                                                <path
                                                                  d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                                                                />
                                                              </svg>
                                                            </button>
                                                          </div>
                                                        </li>
                                                      `
                                                    : nothing
                                                }
                                                ${filtered.map((w, i) => {
                                                  const name = w.data.name?.trim() || "Unnamed";
                                                  const repos = w.data.repos?.length ?? 0;
                                                  const worktrees = (w.data.repos ?? []).reduce(
                                                    (n, r) => n + (r.worktrees?.length ?? 0),
                                                    0,
                                                  );
                                                  const isOpen = openPaths.has(w.filePath);
                                                  const isLast = i === filtered.length - 1;
                                                  return html`
                                                    <li
                                                      class="ws-row ${this._workspaceDeleteMode ? "ws-row--select" : ""} ${isOpen && !this._workspaceDeleteMode ? "ws-row--open" : ""} ${isLast ? "ws-row--last" : ""} ${isLast && !this._listOverflows ? "ws-row--last-visible" : ""}"
                                                      data-workspace-path=${w.filePath}
                                                      @click=${(e: Event) => {
                                                        e.stopPropagation();
                                                        if (this._suppressClick) {
                                                          this._suppressClick = false;
                                                          return;
                                                        }
                                                        if (this._workspaceDeleteMode) {
                                                          this._toggleWorkspaceSelection(
                                                            w.filePath,
                                                          );
                                                          return;
                                                        }
                                                        // Normal mode: open the workspace
                                                        // editor as a grid cell (the edit
                                                        // button is gone — the row itself
                                                        // opens the editor).
                                                        this._openWorkspaceEditor(w);
                                                      }}
                                                      @dblclick=${(e: Event) => {
                                                        // Double-tap pins the workspace
                                                        // editor tab in the grid.
                                                        e.stopPropagation();
                                                        if (this._workspaceDeleteMode) return;
                                                        this._openWorkspaceEditor(w, true);
                                                      }}
                                                    >
                                                      <div class="ws-info">
                                                        <div class="ws-name">${name}</div>
                                                        <div class="ws-meta">
                                                          ${this._countLabel(repos, "repo")} ·
                                                          ${this._countLabel(worktrees, "worktree")}
                                                        </div>
                                                      </div>
                                                      ${
                                                        this._workspaceDeleteMode
                                                          ? html`<span
                                                              class="dw-checkbox ${this._selectedWorkspaces.has(w.filePath) ? "dw-checkbox--checked" : ""}"
                                                            ></span>`
                                                          : html`<button
                                                              class="ws-open-btn"
                                                              type="button"
                                                              title="Open workspace window"
                                                              aria-label="Open workspace window"
                                                              @click=${(e: Event) => {
                                                                e.stopPropagation();
                                                                this._openWorkspaceWindow(
                                                                  w.filePath,
                                                                );
                                                              }}
                                                            >
                                                              <svg
                                                                xmlns="http://www.w3.org/2000/svg"
                                                                height="16px"
                                                                viewBox="0 -960 960 960"
                                                                width="16px"
                                                                fill="currentColor"
                                                              >
                                                                <path
                                                                  d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"
                                                                />
                                                              </svg>
                                                            </button>`
                                                      }
                                                    </li>
                                                  `;
                                                })}
                                              </ul>
                                            `
                                    }
                                    <div class="wm-workspaces-bottom">
                                      ${this._searchOpen ? this._workspaceSearchBar() : nothing}
                                      ${this._workspaceListFooter()}
                                    </div>
                                  </div>
                                `
                }
              </div>
            </div>
          </div>
          <!-- Sidebar resize notch (between the sidebar and the grid) -->
          <div
            class="wm-notch-v wm-notch"
            @mousedown=${(e: MouseEvent) => this._onSidebarResizeStart(e)}
            @mouseenter=${() => this._setSidebarDragLine(true)}
            @mouseleave=${() => this._setSidebarDragLine(false)}
          >
            <drag-line orientation="vertical" style="left:1px"></drag-line>
          </div>
          <div class="wm-main">
            <openp41ge-manager-grid
              class="wm-grid"
              .focusVisible=${this._windowFocused && !this._sidebarFocused}
            ></openp41ge-manager-grid>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-window-manager", Openp41geWindowManager);
