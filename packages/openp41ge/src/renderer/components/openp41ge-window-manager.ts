/**
 * <openp41ge-window-manager> — Window Manager window.
 *
 * The top level is a simple list of workspaces. Clicking a workspace row opens
 * that workspace's config as a grid cell in the workspace-editor grid (the
 * `openp41ge-extension-workspaces` extension), alongside the live workspace windows. The
 * workspace editor opens the workspace's window (its Open button) and edits
 * it (name, repositories, worktrees).
 */

import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { LitElement } from "lit";
import { state } from "lit/decorators.js";
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
import type { Openp41geContextMenuElement } from "../interfaces/element-guards";
import "./openp41ge-settings-list";
import { settingsIcon } from "../icons";
import { CONFIG_EDITOR_APP_TYPE, configEditorTitle } from "../apps/config-editor/title";
import { openReleaseTab } from "../apps/release/index";
import { dataDirWorkspaces } from "../services/extension-renderer-loader";
import { WorkspaceRowDragSource } from "../services/drag-sources/workspace-row-drag-source";
import { CLEANUP_ICON, RELEASES_ICON, WORKSPACES_ICON } from "../apps/management/icons";

/** Inset that trims the capturePage bitmap edge so the ghost isn't boxed (px). */
const ROW_GHOST_CAPTURE_INSET = 2;
import "./openp41ge-manager-grid";
import {
  workspaceName,
  type Openp41geWorkspacesList,
  type WorkspaceListEntry,
} from "./openp41ge-workspaces-list";
import type { Openp41geManagerGrid } from "./openp41ge-manager-grid";

/** The namespaced app type id of the workspaces extension's editor surface. */
const WORKSPACE_EDITOR_APP_TYPE = "ext:openp41ge-extension-workspaces:workspace-editor";
import { registerManagerTabBar } from "../services/init-drag-system";
import { MANAGER_TAB_REORDER_EVENT } from "../services/drop-targets/manager-tab-bar-drop-target";
import { welcomePages } from "../content/welcome";
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  NOTCH_WIDTH,
  NOTCH_OVERFLOW,
} from "openp41ge-core-constants";

/** Default sidebar width for the manager window (matches the old fixed width). */
const DEFAULT_SIDEBAR_WIDTH = 300;
const SIDEBAR_WIDTH_STORAGE_KEY = "openp41ge:manager-sidebar-width";
/** The sidebar's open tabs and the active one, kept across reloads. */
const SIDEBAR_TABS_STORAGE_KEY = "openp41ge:manager-sidebar-tabs";

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

/** Tab handle icons, for the tabs that have one. */
const MANAGER_TAB_ICONS: Partial<Record<ManagerTabId, string>> = {
  workspaces: WORKSPACES_ICON,
  settings: settingsIcon(16),
  cleanup: CLEANUP_ICON,
  releases: RELEASES_ICON,
};

export class Openp41geWindowManager extends LitElement {
  /** Open tabs in the bar; the welcome intro tab is removed for now, so the
   *  window lands on Workspaces. */
  @state() private _openTabs: ManagerTabId[] = ["workspaces"];
  @state() private _activeTab: ManagerTabId | null = "workspaces";

  // ═══ Focus line: the window's focus is in the sidebar or the grid (the
  // last zone clicked); its focused tab has the line while the window is
  // focused, as in a workspace window. ═══
  @state() private _windowFocused = document.hasFocus();
  @state() private _sidebarFocused = false;
  /** The tab bar's tabs are scrolled past its left / right edge (that edge
   *  fades, as the workspace window's sidebars do). */
  @state() private _tabbarFadeLeft = false;
  @state() private _tabbarFadeRight = false;
  /** The tabs are wider than their strip. */
  @state() private _tabbarOverflow = false;
  private _tabbarResize: ResizeObserver | null = null;
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
    window.addEventListener("focus", this._onWindowFocusLine);
    window.addEventListener("blur", this._onWindowBlurLine);
    this.shadowRoot?.addEventListener("mousedown", this._onFocusZoneMouseDown, true);
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
    // The tabs scroll in their own strip; the + stays at the bar's end.
    const barEl = this.shadowRoot?.querySelector<HTMLElement>(".wm-tabbar-scroll");
    if (!barEl) return;
    if (typeof ResizeObserver !== "undefined") {
      this._tabbarResize = new ResizeObserver(() => this._measureTabbarFade());
      this._tabbarResize.observe(barEl);
    }
    this._unregisterManagerBar = registerManagerTabBar(barEl, this._myWindowId());
    barEl.addEventListener(MANAGER_TAB_REORDER_EVENT, this._onManagerTabReorder);
    this._setupRowDrag();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("focus", this._onWindowFocusLine);
    window.removeEventListener("blur", this._onWindowBlurLine);
    this.shadowRoot?.removeEventListener("mousedown", this._onFocusZoneMouseDown, true);
    focusLineLayer().hide(this);
    this.shadowRoot?.removeEventListener("click", this._onShadowClick);
    document.removeEventListener("pointerdown", this._onPointerDown);
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
    this._tabbarResize?.disconnect();
    this._tabbarResize = null;
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
    this._measureTabbarFade();
    const btns = this.shadowRoot?.querySelectorAll<HTMLElement>(".wm-tab-close, .wm-tabbar-add");
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
  /** Fade each edge of the tab strip the tabs are scrolled past. */
  private _measureTabbarFade = (): void => {
    const el = this.shadowRoot?.querySelector<HTMLElement>(".wm-tabbar-scroll");
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 2;
    if (left !== this._tabbarFadeLeft) this._tabbarFadeLeft = left;
    if (right !== this._tabbarFadeRight) this._tabbarFadeRight = right;
    const overflow = el.scrollWidth > el.clientWidth;
    if (overflow !== this._tabbarOverflow) this._tabbarOverflow = overflow;
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
    const row = target?.closest?.(".ws-row") as HTMLElement | null;
    const list = this._workspacesList();
    if (!row || !list || list.deleteMode) return null;
    const path = row.getAttribute("data-workspace-path") ?? "";
    const ws = path ? list.workspaces.find((w) => w.filePath === path) : undefined;
    if (!ws) return null;
    return {
      row,
      title: workspaceName(ws),
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

  /** Toggle + persist the "never show the welcome intro again" choice. */
  private _onWelcomeDismissToggle = (e: Event): void => {
    const on = (e as CustomEvent<{ checked: boolean }>).detail.checked;
    this._welcomeDismissed = on;
    void window.openp41ge.welcome.setDismissed(on);
  };

  /** Open a workspace's config in the grid's workspace-editor cell. When
   *  `pinned` is set (row double-tap / drop), the cell opens pinned. */
  private _openWorkspaceEditor(ws: WorkspaceListEntry, pinned = false): void {
    const grid = this.renderRoot?.querySelector(
      "openp41ge-manager-grid",
    ) as Openp41geManagerGrid | null;
    if (!grid) return;
    grid.openApp(
      WORKSPACE_EDITOR_APP_TYPE,
      workspaceName(ws),
      { path: ws.filePath, dir: dataDirWorkspaces() },
      undefined,
      pinned,
    );
  }

  /** The Workspaces tab's list, when that tab is showing. */
  private _workspacesList(): Openp41geWorkspacesList | null {
    return this.renderRoot?.querySelector("openp41ge-workspaces-list") ?? null;
  }

  /** The click that ends a row drag is not an open: swallow it once. */
  private readonly _consumeSuppressedClick = (): boolean => {
    if (!this._suppressClick) return false;
    this._suppressClick = false;
    return true;
  };

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

  render(): TemplateResult {
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
        /* Frameless window title bar (native drag region). The Window Manager
           has no native chrome, so it renders its own close / minimize /
           fullscreen traffic-light buttons here. */
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
        .wm-winbtn--full {
          background: #28c840;
        }
        /* Tab bar: persistent navigation row below the window title bar, styled
           like the workspace window's <tab-bar>. Hosts the "Workspaces" tab
           (active), a per-tab close button, and a trailing "+" new-tab button. */
        .wm-tabbar {
          position: relative;
          display: flex;
          align-items: center;
          flex-shrink: 0;
          height: 35px;
          padding: 0;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #2d2d2d);
          overflow: hidden;
          user-select: none;
        }
        /* Only the tabs scroll, so the + stays at the end of the bar and the
           tabs pass behind a fade at its edge (as in the workspace window's
           sidebars). */
        .wm-tabbar-scroll {
          display: flex;
          align-items: center;
          flex: 1;
          min-width: 0;
          height: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
        }
        .wm-tabbar-scroll::-webkit-scrollbar {
          display: none;
        }
        /* Overflowing, the last tab's divider would double the +'s border.
           Hide it by colour only: this class is set from measuring the
           strip, so changing the strip's size here would flip that
           measurement back and loop the render (it froze the window at the
           one sidebar width where the 1px decided overflow). */
        .wm-tabbar-scroll--overflow .wm-tab--last {
          border-right-color: transparent;
        }
        .wm-tabbar-fade {
          position: absolute;
          top: 0;
          width: 16px;
          height: 100%;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.12s ease;
        }
        .wm-tabbar-fade[data-shown] {
          opacity: 1;
        }
        .wm-tabbar-fade--left {
          left: 0;
          background: linear-gradient(to right, rgba(0, 0, 0, 0.35), transparent);
        }
        .wm-tabbar-fade--right {
          right: 34px;
          background: linear-gradient(to left, rgba(0, 0, 0, 0.35), transparent);
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
        /* Trailing "+" new-tab button, full-height square at the end of the
           bar, outside the tabs' scroll strip (it never scrolls away). */
        .wm-tabbar-add {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          margin: 0;
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
            <button
              class="wm-winbtn wm-winbtn--full"
              aria-label="Toggle full screen"
              @click=${() => window.openp41ge?.window.toggleFullScreen()}
            >
              <span>⤢</span>
            </button>
          </div>
        </div>
        <div class="wm-drawer-layer">
          <div class="wm-sidebar">
            <div class="wm-tabbar">
              <div
                class="wm-tabbar-scroll ${this._tabbarOverflow ? "wm-tabbar-scroll--overflow" : ""}"
                @scroll=${this._measureTabbarFade}
              >
                ${this._openTabs.map(
                  (id, i) => html`
                    <div
                      class="wm-tab ${this._activeTab === id ? "wm-tab--active" : ""} ${i === this._openTabs.length - 1 ? "wm-tab--last" : ""}"
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
              </div>
              <div
                class="wm-tabbar-fade wm-tabbar-fade--left"
                ?data-shown=${this._tabbarFadeLeft}
              ></div>
              <div
                class="wm-tabbar-fade wm-tabbar-fade--right"
                ?data-shown=${this._tabbarFadeRight}
              ></div>
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
                                  <openp41ge-workspaces-list
                                    class="wm-workspaces-pane"
                                    .onOpen=${(ws: WorkspaceListEntry, pinned: boolean) =>
                                      this._openWorkspaceEditor(ws, pinned)}
                                    .ignoreClick=${this._consumeSuppressedClick}
                                  ></openp41ge-workspaces-list>
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
