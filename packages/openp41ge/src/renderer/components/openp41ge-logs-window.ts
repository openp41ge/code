/**
 * <openp41ge-logs-window> — the standalone Logs window root.
 *
 * Booted when the main process creates a window with windowType `"logs"`. It is
 * a resizable window (hiddenInset titlebar, like workspace windows) with a top
 * bar and a single shared <tab-grid> (no sidebars) so several log streams can
 * be watched side by side.
 *
 * The component reuses the uikit tab system rather than a hand-rolled grid:
 *   - <tab-grid> owns the columns, per-column <tab-bar>/<tab-content>, the
 *     drop targets, ghost previews and drag-split detection.
 *   - This component owns the LOCAL grid model (placements / active tabs / tab
 *     metadata) and mounts one <openp41ge-log-viewer> per tab via
 *     grid.mountController().
 *   - Drag/reorder/split/move are driven by the events the grid and its tab
 *     bars bubble up (grid-activate, grid-move, grid-split, tab-bar-reorder,
 *     tab-bar-move-cell, grid-focus-col). A thin logs-specific DragOrchestrator
 *     starts tab drags; it is intentionally NOT the workspace's drag system
 *     (which is coupled to the workspace model and is skipped for logs windows
 *     in StartupContext.wireServices).
 *
 * Each tab is a single log stream (one system). By default the grid opens
 * only the platform (app) log; every other system must be opened manually. The
 * sidebar (Cmd/Ctrl+B) has two tabs: **Streams** (every registered system; click → preview, drag to
 * the grid → permanently open) and **Search** (a cross-stream search over the
 * buffered logs). A dropped stream row lands as a pinned tab; a single click
 * lands as an unpinned preview that is replaced by the next preview open in
 * its column (and is promoted to pinned when the tab is clicked again).
 * Clicking a log row opens a detail drawer (sliding in from the right,
 * inside the tab grid) for that entry.
 */

import { LitElement, html, type TemplateResult, nothing } from "lit";
import { state, customElement } from "lit/decorators.js";
import {
  listLogStreams,
  subscribeLogStreams,
  subscribeLogs,
  queryLog,
  type LogStreamInfo,
  type LogEntry,
  type LogViewEntry,
} from "openp41ge-core-logger";
import { Openp41geLogViewer } from "openp41ge-core-logger/viewer";
import {
  DragOrchestrator,
  TabDragSource,
  OverlayScrollbar,
  GhostManager,
  DRAG_EVENTS,
  type TabGrid,
  type TargetResolver,
  type IDropTarget,
  type IDragSource,
  type TargetFeedback,
  type GhostPreview,
} from "openp41ge-sdk-uikit";
// Registers drag/drop affordances (side-effect import of the uikit module).
import "openp41ge-sdk-uikit";
import { LogFilePageReader } from "../services/log-file-page-reader";
import { LogStreamDragSource } from "../services/drag-sources/log-stream-drag-source";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "logs-window");
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  NOTCH_WIDTH,
  NOTCH_OVERFLOW,
} from "openp41ge-core-constants";
import type { Openp41geContextMenuElement } from "../interfaces/element-guards";

interface LogTab {
  id: string;
  /** System (plugin id / platform) this tab filters to. */
  system: string;
  title: string;
  /** false = preview (unpinned): replaced by the next preview open in its
   *  column and promoted to pinned when its tab is clicked again. */
  pinned: boolean;
}

interface Placement {
  position: { row: number; col: number };
  tabIds: string[];
}

interface DetailState {
  /** First line of the message (the headline shown in the log row). */
  message: string;
  /** The lines after the first — typically an appended stack trace. */
  stack: string;
  source: string;
  system: string;
  process: string;
  levelLabel: string;
  timestamp: number;
}

/** One open detail drawer, locked to (and animating from) its owning grid cell.
 *  Multiple cells can each hold a drawer simultaneously. `cell` may be null
 *  (fallback to a single grid-wide drawer when no cell is resolvable). */
interface DrawerState {
  id: number;
  cell: Element | null;
  detail: DetailState;
}

const TAB_PREFIX = "logtab-";

/** The platform's own log system id — auto-opened when the window first shows. */
const PLATFORM_SYSTEM = "openp41ge";
let _tabSeq = 0;

/** Stable grid window id — the logs grid is local to this window, so a single
 *  shared id is enough (the drop events carry it but this host ignores it). */
const WIN_ID = "logs-window";

/** Default sidebar width for the logs window (matches the workspace gutter). */
const DEFAULT_SIDEBAR_WIDTH = 260;

/** The sidebar's openable tabs. Only these two exist in the logs window. */
type SidebarTabId = "streams" | "search";
interface SidebarTabDef {
  id: SidebarTabId;
  title: string;
}
const SIDEBAR_TABS: SidebarTabDef[] = [
  { id: "streams", title: "Streams" },
  { id: "search", title: "Search" },
];
const SIDEBAR_TAB_BY_ID: Record<SidebarTabId, SidebarTabDef> = {
  streams: { id: "streams", title: "Streams" },
  search: { id: "search", title: "Search" },
};

/** Ghost capture inset (px) applied to the source element rect. Trims the
 *  element's 1px separator border so the bitmap ghost is a clean copy. */
const TAB_GHOST_CAPTURE_INSET = 2;

/** Deferred `drag:start` params for a grid-tab drag, captured on mousedown and
 *  fired on the first POSITION event (after the drag threshold is met).
 *  Mirrors the workspace's `_pendingDragStart`. */
interface PendingTabDragStart {
  label: string;
  screenX: number;
  screenY: number;
  tabId: string;
  winId: string;
  worksetId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  captureRect: { x: number; y: number; width: number; height: number };
}

/** Deferred `drag:start` params for a sidebar stream-row drag, captured on
 *  mousedown and fired on the first POSITION event. Mirrors the workspace's
 *  `_pendingLogStreamDragStart`. */
interface PendingStreamDragStart {
  label: string;
  screenX: number;
  screenY: number;
  system: string;
  winId: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  captureRect: { x: number; y: number; width: number; height: number };
}

/** Copy button icon for the drawer's code blocks (user-provided Material icon). */
const COPY_ICON = html` <svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor"
  aria-hidden="true"
>
  <path
    d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"
  />
</svg>`;

/** Check mark shown briefly after a successful copy. */
const CHECK_ICON = html` <svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor"
  aria-hidden="true"
>
  <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
</svg>`;

@customElement("openp41ge-logs-window")
export class Openp41geLogsWindow extends LitElement {
  /** Fully store the grid state in `state` so Lit re-renders on change. */
  @state() private _tabs: LogTab[] = [];
  /** Column-ordered placements: `_placements[i].position.col === i`. */
  @state() private _placements: Placement[] = [];
  /** col (as string key) → active tab id in that column. */
  @state() private _activeTabIds: Record<string, string> = {};
  @state() private _drawers: DrawerState[] = [];
  /** Monotonic id for distinguishing open drawers across cells. */
  private _drawerId = 0;
  /** Which code block currently shows the "copied" check (key or null). */
  @state() private _copied: string | null = null;
  private _copiedTimer: number | null = null;
  /** When the first streams register, populate the default tabs once. */
  @state() private _defaultsApplied = false;

  private _viewers = new Map<string, Openp41geLogViewer>();
  private _offStreams: (() => void) | null = null;
  private _offLogs: (() => void) | null = null;
  private _detailUnsub: (() => void) | null = null;
  private _offRevealError: (() => void) | null = null;
  private _orchestrator: DragOrchestrator | null = null;
  /** Column new streams are opened in (last active/focused column). */
  private _lastActiveCol = 0;

  /** Single sidebar panel — open/closed and which side it sits on. The side is
   *  config-driven; the config isn't built yet, so it defaults to the right. */
  @state() private _sidebarOpen = false;
  @state() private _sidebarSide: "left" | "right" = "right";
  /** Which sidebar tab the panel is showing: the stream list or cross-stream search. */
  /** Order of open sidebar tabs (defaults to just Streams). */
  @state() private _sidebarOpenTabs: SidebarTabId[] = ["streams"];
  /** Active sidebar tab (must be in `_sidebarOpenTabs` unless all are closed). */
  @state() private _sidebarTab: SidebarTabId = "streams";
  /** The window is focused: the focused tab shows its line only then. */
  @state() private _windowFocused = document.hasFocus();
  /** The sidebar, not the grid, was clicked last: its active tab is the
   *  focused tab. Kept while the window is blurred. */
  @state() private _sidebarFocused = false;
  /** A press in the sidebar focuses it; one in the grid focuses the grid. */
  private readonly _onFocusZoneMouseDown = (e: Event): void => {
    const target = e.target as Element | null;
    if (target?.closest?.(".lw-sidebar")) this._sidebarFocused = true;
    else if (target?.closest?.("tab-grid")) this._sidebarFocused = false;
  };
  private readonly _onWindowFocus = (): void => {
    this._windowFocused = true;
  };
  private readonly _onWindowBlur = (): void => {
    this._windowFocused = false;
  };
  @state() private _searchQuery = "";

  /** Sidebar tab-strip overflow state (drives the edge shadows + re-renders). */
  @state() private _lwSbScrollLeft = 0;
  @state() private _lwSbHasOverflow = false;

  /** Draggable sidebar width. Applied directly to the DOM during a drag (no
   *  full re-render per mousemove) and kept across re-renders / re-opens. */
  private _sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  private _resizeActive = false;
  private _resizeSide: "left" | "right" = "right";
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;

  /** Renders the grid drop indicator (split line / cell highlight) during a
   *  drag, mirroring the workspace's `updateGridGhost`. The orchestrator
   *  resolves the target but never renders the grid's ghost itself, so this
   *  host drives it from its own mousemove listener. */
  private _ghostManager = new GhostManager();
  private _ghostShownGrid: HTMLElement | null = null;
  private _dragActive = false;
  private _dragActivated = false;
  private _dragSource: IDragSource | null = null;
  private _pendingTabDragStart: PendingTabDragStart | null = null;
  private _pendingStreamDragStart: PendingStreamDragStart | null = null;
  private _sidebarScrollbar: OverlayScrollbar | null = null;
  /** The element the sidebar scrollbar is currently attached to (so it can be
   *  re-attached when the sidebar switches between Streams and Search). */
  private _sidebarScrollTarget: HTMLElement | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────

  connectedCallback(): void {
    super.connectedCallback();
    this._setupDrag();
    // Cmd/Ctrl+B toggles the single sidebar panel (one shortcut, one sidebar).
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("resize", this._onDetailResize);
    window.addEventListener("focus", this._onWindowFocus);
    window.addEventListener("blur", this._onWindowBlur);
    // Build the default tab set from the systems that have logged so far. If
    // none have logged yet, subscribe and populate as soon as the first stream
    // registers (so a freshly booted app still gets its default tabs).
    if (listLogStreams().length > 0) {
      this._applyDefaults();
    }
    this._offStreams = subscribeLogStreams(() => {
      if (!this._defaultsApplied && listLogStreams().length > 0) {
        this._applyDefaults();
      }
      this.requestUpdate();
    });
    this._offLogs = subscribeLogs(() => this.requestUpdate());
    // Open an error on request: the one this window was launched for, and any
    // sent later (e.g. a "View log" link while the window is already open).
    const logs = window.openp41ge?.logs;
    this._offRevealError =
      logs?.onRevealError?.((errorId) => void this.revealError(errorId)) ?? null;
    const launchErrorId = logs?.getLaunchErrorId?.();
    if (launchErrorId) void this.updateComplete.then(() => this.revealError(launchErrorId));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("focus", this._onWindowFocus);
    window.removeEventListener("blur", this._onWindowBlur);
    if (this._copiedTimer !== null) {
      window.clearTimeout(this._copiedTimer);
      this._copiedTimer = null;
    }
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("resize", this._onDetailResize);
    document.removeEventListener("mousemove", this._onSidebarResizeMove);
    document.removeEventListener("mouseup", this._onSidebarResizeEnd);
    if (this._resizeActive) {
      this._resizeActive = false;
      document.body.style.cursor = "";
    }
    this._sidebarScrollbar?.destroy();
    this._sidebarScrollbar = null;
    this._sidebarScrollTarget = null;
    this._sbResizeObserver?.disconnect();
    this._sbResizeObserver = null;
    this._sbResizeTarget = null;
    this._teardownDrag();
    this._offStreams?.();
    this._offStreams = null;
    this._offLogs?.();
    this._offLogs = null;
    this._offRevealError?.();
    this._offRevealError = null;
    this._detachDetailListeners();
    for (const v of this._viewers.values()) {
      if (v.parentNode) v.parentNode.removeChild(v);
    }
    this._viewers.clear();
  }

  protected firstUpdated(): void {
    this._attachDetailListeners();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("_placements") || changed.has("_tabs")) {
      void this._mountViewers();
    }
    this._attachSidebarScrollbar();
    this._ensureLwSbResizeObserver();
  }

  /** Toggle the sidebar on Cmd/Ctrl+B (either modifier alone, no shift/alt). */
  private _onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    if (e.key.toLowerCase() !== "b") return;
    e.preventDefault();
    this._sidebarOpen = !this._sidebarOpen;
  };

  /** Titlebar sidebar toggle button — same action as Cmd/Ctrl+B. */
  private _toggleSidebar = (): void => {
    this._sidebarOpen = !this._sidebarOpen;
  };

  // ═══ Sidebar resize (drag bar) ────────────────────────────────────────

  /** Start dragging the sidebar's resize notch. Mirrors the workspace's
   *  `openp41ge-windowview` resize handle: track the pointer on `document`,
   *  keep the blue `<drag-line>` lit for the whole drag, and clamp to the
   *  shared min/max sidebar widths. */
  private _onSidebarResizeStart(e: MouseEvent, side: "left" | "right"): void {
    e.preventDefault();
    this._resizeActive = true;
    this._resizeSide = side;
    this._resizeStartX = e.clientX;
    this._resizeStartWidth = this._sidebarWidth;
    this._setSidebarDragLine(side, true);
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", this._onSidebarResizeMove);
    document.addEventListener("mouseup", this._onSidebarResizeEnd);
  }

  private _onSidebarResizeMove = (e: MouseEvent): void => {
    if (!this._resizeActive) return;
    const dx = e.clientX - this._resizeStartX;
    // Left handle: dragging right (+dx) widens the sidebar. Right handle: the
    // opposite (dragging left, -dx, widens).
    const delta = this._resizeSide === "left" ? dx : -dx;
    const width = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, this._resizeStartWidth + delta),
    );
    this._applySidebarWidth(width);
  };

  private _onSidebarResizeEnd = (): void => {
    if (!this._resizeActive) return;
    this._resizeActive = false;
    this._setSidebarDragLine(this._resizeSide, false);
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", this._onSidebarResizeMove);
    document.removeEventListener("mouseup", this._onSidebarResizeEnd);
    // Re-evaluate the tab-strip overflow (and its edge shadows) now that the
    // sidebar width has settled.
    this.requestUpdate();
  };

  /** Set the sidebar width: keep the value for re-renders and apply it live to
   *  the DOM (no re-render needed while dragging). */
  private _applySidebarWidth(width: number): void {
    this._sidebarWidth = width;
    const el = (this.renderRoot as ShadowRoot | null)?.querySelector<HTMLElement>(".lw-sidebar");
    if (el) el.style.width = `${width}px`;
  }

  /** Toggle the shared `<drag-line>` inside a resize notch (hover / dragging). */
  private _setSidebarDragLine(side: "left" | "right", on: boolean): void {
    const line = (this.renderRoot as ShadowRoot | null)?.querySelector(
      `.lw-notch-v.${side}-notch drag-line`,
    );
    if (line) line.toggleAttribute("show", on);
  }

  /** A sidebar plus its grid-facing resize notch. */
  private _sidebarLayout(side: "left" | "right"): TemplateResult {
    return html`
      ${side === "left" ? this._sidebarTemplate() : nothing}
      <div
        class="lw-notch-v ${side}-notch"
        @mousedown=${(e: MouseEvent) => this._onSidebarResizeStart(e, side)}
        @mouseenter=${() => this._setSidebarDragLine(side, true)}
        @mouseleave=${() => this._setSidebarDragLine(side, false)}
      >
        <drag-line
          orientation="vertical"
          style=${side === "left" ? "left:1px" : "right:2px"}
        ></drag-line>
      </div>
      ${side === "right" ? this._sidebarTemplate() : nothing}
    `;
  }

  /** The scrollable sidebar tab strip. */
  private _lwSbScrollEl(): HTMLElement | null {
    return (
      (this.renderRoot as ShadowRoot | null)?.querySelector<HTMLElement>(".lw-sb-tabs") ?? null
    );
  }

  /** Whether the left edge of the tab strip is currently under an overflow
   *  (tabs are cut off on the left) — keeps the left shadow visible. */
  private get _lwSbShowLeftShadow(): boolean {
    const el = this._lwSbScrollEl();
    return el ? el.scrollLeft > 2 : false;
  }

  /** Whether the right edge of the tab strip overflows (tabs cut off on the
   *  right) — keeps the right shadow visible. */
  private get _lwSbShowRightShadow(): boolean {
    const el = this._lwSbScrollEl();
    return el ? el.scrollWidth - el.clientWidth - el.scrollLeft > 2 : false;
  }

  /** Track the sidebar tab strip's scroll/overflow so the edge shadows
   *  re-evaluate (mirrors `openp41ge-sidebar._onTabBarScroll`). */
  private _onLwSbTabBarScroll = (e: Event): void => {
    const el = e.target as HTMLElement;
    this._lwSbScrollLeft = el.scrollLeft;
    this._lwSbHasOverflow = el.scrollWidth - el.clientWidth > 2;
  };

  /** Pull the current tab-strip scroll/overflow into state so the template
   *  (and its edge shadows) re-evaluate against the freshly-laid-out metrics
   *  — the getters alone would read stale layout during a render. */
  private _refreshLwSbOverflow(): void {
    const el = this._lwSbScrollEl();
    if (!el) return;
    this._lwSbScrollLeft = el.scrollLeft;
    this._lwSbHasOverflow = el.scrollWidth - el.clientWidth > 2;
  }

  /** Point a ResizeObserver at the live sidebar so width changes (sidebar drag,
   *  window resize) re-evaluate the tab-strip overflow after layout settles.
   *  Re-targeted on every render in case the sidebar was reopened. */
  private _ensureLwSbResizeObserver(): void {
    const el =
      (this.renderRoot as ShadowRoot | null)?.querySelector<HTMLElement>(".lw-sidebar") ?? null;
    if (el === this._sbResizeTarget) return;
    this._sbResizeTarget = el;
    if (typeof ResizeObserver === "undefined") return;
    if (!this._sbResizeObserver) {
      this._sbResizeObserver = new ResizeObserver(() => this._refreshLwSbOverflow());
    }
    this._sbResizeObserver.disconnect();
    if (el) this._sbResizeObserver.observe(el);
  }

  private _sbResizeObserver: ResizeObserver | null = null;
  private _sbResizeTarget: HTMLElement | null = null;

  /** Open the clicked sidebar tab and scroll the strip so it's fully visible
   *  (not left clipped under the edge shadow) — mirrors
   *  `openp41ge-sidebar._onTabClick`. */
  private _onLwSbTabClick = (id: SidebarTabId): void => {
    this._openSidebarTab(id);
    requestAnimationFrame(() => {
      const scroll = this._lwSbScrollEl();
      const tab = scroll?.querySelector<HTMLElement>(`[data-testid="lw-sbtab-${id}"]`) ?? null;
      if (!scroll || !tab) return;
      const cRect = scroll.getBoundingClientRect();
      const tRect = tab.getBoundingClientRect();
      if (tRect.left >= cRect.left && tRect.right <= cRect.right) return;
      scroll.scrollLeft = Math.max(0, tRect.left - cRect.left + scroll.scrollLeft - 8);
    });
  };

  /** Open the sidebar's Streams tab (used by the empty-state button). */
  private _openSidebarStreams = (): void => {
    this._sidebarOpen = true;
    this._openSidebarTab("streams");
  };

  /** Open (adding if needed) and activate a sidebar tab. */
  private _openSidebarTab = (id: SidebarTabId): void => {
    if (!this._sidebarOpenTabs.includes(id)) {
      this._sidebarOpenTabs = [...this._sidebarOpenTabs, id];
    }
    this._sidebarTab = id;
  };

  /** Close a sidebar tab; if it was active, fall back to a neighbour (or none). */
  private _closeSidebarTab = (e: Event, id: SidebarTabId): void => {
    e.stopPropagation();
    const rest = this._sidebarOpenTabs.filter((t) => t !== id);
    this._sidebarOpenTabs = rest;
    if (this._sidebarTab === id) {
      this._sidebarTab = rest[0] ?? "streams";
    }
  };

  /** Open the inline ＋ menu listing the openable sidebar tabs, workspace-style. */
  private _onSidebarAddClick = (): void => {
    const btn =
      (this.renderRoot as ShadowRoot | null)?.querySelector<HTMLElement>(".lw-sb-add") ?? null;
    const r = btn?.getBoundingClientRect();
    const menu = document.createElement("openp41ge-contextmenu") as Openp41geContextMenuElement;
    menu.x = Math.max(8, (r?.right ?? 160) - 160);
    menu.y = (r?.bottom ?? 0) + 2;
    menu.items = SIDEBAR_TABS.map((t) => ({
      label: t.title,
      badge: this._sidebarOpenTabs.includes(t.id) ? "open" : "",
      action: () => this._openSidebarTab(t.id),
    }));
    document.body.appendChild(menu);
  };

  private _paneFor(id: SidebarTabId): TemplateResult {
    return id === "search" ? this._searchPane() : this._streamsPane();
  }

  /** Attach the floating OverlayScrollbar to the sidebar's visible list once it
   *  renders. Idempotent per target — re-attaches when the sidebar switches
   *  between the Streams list and the Search results (which are different
   *  scrolling elements). */
  private _attachSidebarScrollbar(): void {
    if (!this._sidebarOpen || typeof ResizeObserver === "undefined") return;
    const list = this.renderRoot?.querySelector<HTMLElement>(".lw-sidebar-list");
    const container = this.renderRoot?.querySelector<HTMLElement>(".lw-sidebar-body");
    if (!list || !container) return;
    if (this._sidebarScrollTarget === list) return;
    this._sidebarScrollbar?.destroy();
    this._sidebarScrollbar = null;
    this._sidebarScrollTarget = list;
    this._sidebarScrollbar = OverlayScrollbar.attach(list, {
      axis: "vertical",
      container,
      styleTarget: this.shadowRoot ?? undefined,
      size: 9,
      hoverSize: 12,
      autoHide: true,
    });
  }

  // ── Drag setup (logs-specific, NOT the workspace drag system) ─────────

  private _resolveTarget: TargetResolver = (
    clientX: number,
    clientY: number,
  ): IDropTarget | null => {
    // `document.elementFromPoint` does not pierce shadow roots — for a point
    // inside this window it returns the <openp41ge-logs-window> host, never the
    // inner <tab-grid>/<tab-bar>, so a drag could never resolve a drop target
    // (tabs could not be moved/split into cells). Resolve from our own shadow
    // root instead; it uses the same viewport coordinates.
    const root = (this.shadowRoot ?? document) as Document | ShadowRoot;
    const el = (
      root as { elementFromPoint: (x: number, y: number) => Element | null }
    ).elementFromPoint(clientX, clientY);
    if (!el) return null;
    // <tab-bar> and <tab-grid> are light-DOM components that expose their own
    // dropTarget; match them directly (the workspace resolver's legacy class
    // selectors do not apply to the uikit components).
    const tabBarEl = (el as Element).closest?.("tab-bar");
    if (tabBarEl instanceof HTMLElement) {
      const dt = (tabBarEl as unknown as { dropTarget?: IDropTarget }).dropTarget;
      if (dt) return dt;
    }
    const gridEl = (el as Element).closest?.("tab-grid");
    if (gridEl instanceof HTMLElement) {
      const dt = (gridEl as unknown as { dropTarget?: IDropTarget }).dropTarget;
      if (dt) return dt;
    }
    return null;
  };

  private _setupDrag(): void {
    if (this._orchestrator) return;
    this._orchestrator = new DragOrchestrator(this._resolveTarget);
    this.shadowRoot?.addEventListener("mousedown", this._onMouseDown);
    this.shadowRoot?.addEventListener("mousedown", this._onFocusZoneMouseDown, true);
    this.shadowRoot?.addEventListener("click", this._onTabCloseClick);
  }

  private _teardownDrag(): void {
    this._onDragEnd();
    this._orchestrator?.dispose();
    this._orchestrator = null;
    this.shadowRoot?.removeEventListener("mousedown", this._onMouseDown);
    this.shadowRoot?.removeEventListener("mousedown", this._onFocusZoneMouseDown, true);
    this.shadowRoot?.removeEventListener("click", this._onTabCloseClick);
  }

  private _onMouseDown = (e: Event): void => {
    const me = e as MouseEvent;
    // Only the primary button initiates tab drags; right/middle clicks must
    // never start one. Close buttons are handled by the click handler below.
    if (me.button !== 0) return;
    const target = me.target as Element | null;
    if (target?.closest?.(".tab-close")) return;
    const tabBtn = target?.closest?.("[data-tab-id]");
    if (!(tabBtn instanceof HTMLElement)) return;

    e.preventDefault();
    const tabId = tabBtn.getAttribute("data-tab-id") || "";
    const barEl = tabBtn.closest("tab-bar");
    if (!barEl) return;
    const bar = barEl as HTMLElement & { winId?: string; col?: number };
    const winId = bar.winId || WIN_ID;
    const label = this._tabById(tabId)?.title ?? tabBtn.textContent?.trim() ?? "Tab";

    // The visible drag element is the main-process bitmap ghost (DragGhostManager);
    // the in-DOM ghost must be invisible so the two never overlap.
    const source = new TabDragSource(tabBtn, tabId, winId, winId, label, () => {
      const ghost = document.createElement("div");
      ghost.style.cssText =
        "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px;z-index:-1;";
      return ghost;
    });

    // Defer `drag:start` until the first POSITION event (threshold met), so the
    // main process captures a pixel-accurate bitmap of the tab button (like the
    // workspace grid). Capture the cursor offset + source rect here (mousedown).
    const rect = tabBtn.getBoundingClientRect();
    const tabScreenX = window.screenX + rect.left;
    const tabScreenY = window.screenY + rect.top;
    this._pendingTabDragStart = {
      label,
      screenX: me.screenX,
      screenY: me.screenY,
      tabId,
      winId,
      worksetId: winId,
      width: tabBtn.offsetWidth,
      height: tabBtn.offsetHeight,
      offsetX: me.screenX - tabScreenX,
      offsetY: me.screenY - tabScreenY,
      captureRect: {
        x: rect.x + TAB_GHOST_CAPTURE_INSET,
        y: rect.y + TAB_GHOST_CAPTURE_INSET,
        width: Math.max(1, rect.width - TAB_GHOST_CAPTURE_INSET * 2),
        height: Math.max(1, rect.height - TAB_GHOST_CAPTURE_INSET * 2),
      },
    };
    this._beginDrag(source);
    this._orchestrator?.startDrag(source, me.clientX, me.clientY);
  };

  // ── Grid drop indicator + main-process bitmap drag ghost ────────────────

  /** Track an active drag so `mousemove` renders the grid drop indicator and
   *  the POSITION events drive the main-process bitmap ghost (which appears
   *  only after the drag threshold is met). */
  private _beginDrag(source: IDragSource): void {
    this._dragSource = source;
    if (this._dragActive) return;
    this._dragActive = true;
    this._dragActivated = false;
    document.addEventListener("mousemove", this._onDragMove);
    document.addEventListener(DRAG_EVENTS.POSITION, this._onDragPosition);
    document.addEventListener(DRAG_EVENTS.END, this._onDragEnd);
  }

  /** End the drag: hide the bitmap ghost, clear the drop indicator, drop the
   *  listeners and reset the deferred start state. */
  private _onDragEnd = (): void => {
    this._clearGridGhost();
    window.openp41ge?.drag?.end?.();
    this._dragActive = false;
    this._dragActivated = false;
    this._dragSource = null;
    this._pendingTabDragStart = null;
    this._pendingStreamDragStart = null;
    document.removeEventListener("mousemove", this._onDragMove);
    document.removeEventListener(DRAG_EVENTS.POSITION, this._onDragPosition);
    document.removeEventListener(DRAG_EVENTS.END, this._onDragEnd);
  };

  private _onDragMove = (e: Event): void => {
    if (!this._dragActive || !this._dragActivated) return;
    const me = e as MouseEvent;
    this._updateGridGhost(me.clientX, me.clientY);
  };

  /** Orchestrator POSITION events (fired after the drag threshold is met):
   *  start the main-process bitmap ghost on the first one, then keep moving it. */
  private _onDragPosition = (e: Event): void => {
    if (!this._dragActive) return;
    const detail = (e as CustomEvent<{ screenX: number; screenY: number }>).detail;
    if (!detail) return;
    if (!this._dragActivated) {
      this._dragActivated = true;
      this._fireDragStart();
    }
    window.openp41ge?.drag?.move?.(detail.screenX, detail.screenY);
  };

  /** Fire the deferred `drag:start` for whichever source engaged the drag. */
  private _fireDragStart(): void {
    const drag = window.openp41ge?.drag;
    if (!drag || !drag.start) return;
    if (this._pendingTabDragStart) {
      const p = this._pendingTabDragStart;
      this._pendingTabDragStart = null;
      drag.start(
        p.label,
        p.screenX,
        p.screenY,
        undefined,
        p.tabId,
        p.winId,
        p.worksetId,
        p.width,
        p.height,
        p.offsetX,
        p.offsetY,
        "tab",
        undefined,
        p.captureRect,
        TAB_GHOST_CAPTURE_INSET,
      );
      return;
    }
    if (this._pendingStreamDragStart) {
      const p = this._pendingStreamDragStart;
      this._pendingStreamDragStart = null;
      drag.start(
        p.label,
        p.screenX,
        p.screenY,
        undefined,
        undefined,
        p.winId,
        undefined,
        p.width,
        p.height,
        p.offsetX,
        p.offsetY,
        "open-tab",
        undefined,
        p.captureRect,
        TAB_GHOST_CAPTURE_INSET,
        { appType: "log-viewer", tabConfig: { system: p.system } },
      );
    }
  }

  /** Same-window drop indicator, mirroring the workspace's `updateGridGhost`.
   *
   *  The orchestrator already resolves the drop target each mousemove and the
   *  tab-bar's target renders its own insert line, so we only render the grid's
   *  ghost overlay: the split line + highlighted landing cell that tells the
   *  user the tab will open/re-arrange into a new cell. */
  private _updateGridGhost(clientX: number, clientY: number): void {
    const target = this._resolveTarget(clientX, clientY);
    const element = (target as unknown as { element?: HTMLElement })?.element;
    const source = this._dragSource;
    if (!element || !source) {
      this._clearGridGhost();
      return;
    }

    const tag = element.tagName.toLowerCase();
    const gridEl =
      tag === "tab-grid"
        ? element
        : tag === "tab-bar"
          ? (element.closest?.("tab-grid") as HTMLElement | null)
          : null;
    if (!(gridEl instanceof HTMLElement)) {
      this._clearGridGhost();
      return;
    }

    // A different grid than the one currently overlaying: tear the old one down.
    if (this._ghostShownGrid && this._ghostShownGrid !== gridEl) {
      this._ghostManager.hideGhost(this._ghostShownGrid);
      this._ghostShownGrid = null;
    }

    if (tag === "tab-bar") {
      // Keep the landing cell's wash behind the tab bar's own insert line.
      const col = (target as unknown as { col?: number }).col;
      if (typeof col !== "number" || col < 0) {
        this._clearGridGhost();
        return;
      }
      const cols = (gridEl as unknown as { cols?: number }).cols ?? 1;
      this._ghostManager.showGhost(gridEl, { cols, activeCol: col, suppressFrame: true });
      this._ghostShownGrid = gridEl;
      return;
    }

    // Grid body: ask the drop target for the landing cell / split config and
    // paint the overlay. Calling onHover on the grid target is safe — it only
    // returns config (it renders nothing); the tab-bar's own onHover is left to
    // the orchestrator so its insert line is not shown twice.
    const feedback = (
      target as unknown as {
        onHover?: (s: IDragSource, x: number, y: number) => TargetFeedback | null;
      }
    ).onHover?.(source, clientX, clientY);
    if (!feedback || !feedback.showGhost || !feedback.ghostConfig) {
      this._clearGridGhost();
      return;
    }
    const cfg = feedback.ghostConfig as Record<string, unknown>;
    const preview: GhostPreview = {
      cols: (cfg.cols as number) ?? 1,
      boundaryIndex: cfg.boundaryIndex as number | undefined,
      splitCol: cfg.splitCol as number | undefined,
      splitLeft: cfg.splitLeft as boolean | undefined,
      activeCol: (cfg.mouseCol ?? cfg.col ?? 0) as number,
    };
    this._ghostManager.showGhost(gridEl, preview);
    this._ghostShownGrid = gridEl;
  }

  private _clearGridGhost(): void {
    if (this._ghostShownGrid) {
      this._ghostManager.hideGhost(this._ghostShownGrid);
      this._ghostShownGrid = null;
    }
  }

  private _onTabCloseClick = (e: Event): void => {
    const el = (e.target as Element | null)?.closest?.(".tab-close[data-close-tab-id]");
    if (!(el instanceof HTMLElement)) return;
    e.preventDefault();
    e.stopPropagation();
    const tabId = el.getAttribute("data-close-tab-id");
    if (tabId) this._closeTab(tabId);
  };

  // ── Default tabs ─────────────────────────────────────────────────────

  /** Auto-open only the platform log; other systems must be opened manually. */
  private _applyDefaults(): void {
    if (this._defaultsApplied) return;
    const systems = new Set(listLogStreams().map((s) => s.system));
    if (!systems.has(PLATFORM_SYSTEM)) return;
    this._defaultsApplied = true;
    const tabs = [this._makeTab(PLATFORM_SYSTEM)];
    const tabIds = tabs.map((t) => t.id);
    this._tabs = tabs;
    this._setPlacements([{ position: { row: 0, col: 0 }, tabIds }]);
    this._reconcileActives();
    this._lastActiveCol = 0;
  }

  private _makeTab(system: string, pinned = true): LogTab {
    return { id: `${TAB_PREFIX}${_tabSeq++}`, system, title: system, pinned };
  }

  private _tabById(tabId: string): LogTab | undefined {
    return this._tabs.find((t) => t.id === tabId);
  }

  // ── Grid state helpers ───────────────────────────────────────────────

  private get _cols(): number {
    return Math.max(this._placements.length, 1);
  }

  private _colPlacement(col: number): Placement | undefined {
    return this._placements.find((p) => p.position.col === col);
  }

  /** Sort placements by column and renumber so `[i].position.col === i` — the
   *  invariant <tab-grid>'s `_getNextTabForCell` and GridDropTarget rely on. */
  private _setPlacements(placements: Placement[]): void {
    const sorted = [...placements].sort((a, b) => a.position.col - b.position.col);
    this._placements = sorted.map((p, i) => ({
      position: { row: 0, col: i },
      tabIds: p.tabIds,
    }));
  }

  /** Ensure every column that has tabs has a valid active id (first tab if the
   *  tracked one was closed/moved), and drop stale column entries. */
  private _reconcileActives(): void {
    const next: Record<string, string> = {};
    for (const p of this._placements) {
      const colStr = String(p.position.col);
      const cur = this._activeTabIds[colStr];
      next[colStr] = cur && p.tabIds.includes(cur) ? cur : (p.tabIds[0] ?? "");
    }
    this._activeTabIds = next;
  }

  private _activeTabIdFor(col: number): string {
    return this._activeTabIds[String(col)] ?? this._colPlacement(col)?.tabIds[0] ?? "";
  }

  /**
   * Move a tab into `targetCol` at `insertAt` (append when -1 / out of range).
   * Removes the source column if it empties (never below one column).
   */
  private _moveTab(tabId: string, targetCol: number, insertAt: number, activate = true): void {
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    const srcIdx = boxes.findIndex((b) => b.tabIds.includes(tabId));
    if (srcIdx < 0) return;
    boxes[srcIdx].tabIds = boxes[srcIdx].tabIds.filter((id) => id !== tabId);

    let tIdx = targetCol;
    if (tIdx < 0 || tIdx > boxes.length) tIdx = boxes.length;
    if (tIdx >= boxes.length) boxes.push({ tabIds: [] });
    const at =
      insertAt < 0 ? boxes[tIdx].tabIds.length : Math.min(insertAt, boxes[tIdx].tabIds.length);
    boxes[tIdx].tabIds.splice(at, 0, tabId);

    if (boxes[srcIdx].tabIds.length === 0 && boxes.length > 1) {
      boxes.splice(srcIdx, 1);
    }

    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._reconcileActives();
    if (activate) {
      const landed = boxes.findIndex((b) => b.tabIds.includes(tabId));
      if (landed >= 0) {
        this._activeTabIds = { ...this._activeTabIds, [String(landed)]: tabId };
        this._lastActiveCol = landed;
      }
    }
  }

  /** Reorder a tab within a single column. */
  private _reorder(col: number, fromIndex: number, toIndex: number): void {
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    const box = boxes[col];
    if (!box || fromIndex < 0 || fromIndex >= box.tabIds.length) return;
    if (toIndex < 0 || toIndex > box.tabIds.length) return;
    const [moved] = box.tabIds.splice(fromIndex, 1);
    box.tabIds.splice(toIndex, 0, moved);
    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._reconcileActives();
  }

  /** Split a tab into a fresh column placed at the given boundary. */
  private _splitTab(tabId: string, splitCol: number, splitLeft: boolean): void {
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    const srcIdx = boxes.findIndex((b) => b.tabIds.includes(tabId));
    if (srcIdx < 0) return;
    boxes[srcIdx].tabIds = boxes[srcIdx].tabIds.filter((id) => id !== tabId);

    const at = Math.max(0, Math.min(splitLeft ? splitCol : splitCol + 1, boxes.length));
    boxes.splice(at, 0, { tabIds: [tabId] });

    // Remove the (now empty) source column if it has no tabs left.
    if (boxes.length > 1) {
      const emptyIdx = boxes.findIndex((b) => b.tabIds.length === 0);
      if (emptyIdx >= 0 && !boxes[emptyIdx].tabIds.includes(tabId)) {
        boxes.splice(emptyIdx, 1);
      }
    }

    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._reconcileActives();
    const landed = boxes.findIndex((b) => b.tabIds.includes(tabId));
    if (landed >= 0) {
      this._activeTabIds = { ...this._activeTabIds, [String(landed)]: tabId };
      this._lastActiveCol = landed;
    }
  }

  /** Open a fresh empty column at the end and focus it. */
  private _addColumn(): void {
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    boxes.push({ tabIds: [] });
    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._reconcileActives();
    this._lastActiveCol = boxes.length - 1;
  }

  private _closeTab(tabId: string): void {
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    const srcIdx = boxes.findIndex((b) => b.tabIds.includes(tabId));
    if (srcIdx < 0) return;
    boxes[srcIdx].tabIds = boxes[srcIdx].tabIds.filter((id) => id !== tabId);
    if (boxes.length > 1 && boxes[srcIdx].tabIds.length === 0) {
      boxes.splice(srcIdx, 1);
    }
    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._tabs = this._tabs.filter((t) => t.id !== tabId);
    this._releaseViewer(tabId);
    this._reconcileActives();
    if (this._lastActiveCol >= this._placements.length) this._lastActiveCol = 0;
  }

  // ── Tab / cell operations (public accessors used by tests) ───────────

  private _activate(col: number, tabId: string): void {
    const p = this._colPlacement(col);
    if (!p || !p.tabIds.includes(tabId)) return;
    this._lastActiveCol = col;
    this._activeTabIds = { ...this._activeTabIds, [String(col)]: tabId };
  }

  /** Open (or reuse) a tab for `system` in the given column.
   *
   *  `pinned` is the tab's permanence:
   *    - true  (drag onto the grid / a search-result drag) → permanent tab.
   *    - false (single click on a row) → an unpinned preview that is replaced
   *      by the next preview opened in its column, and promoted to pinned when
   *      its tab is clicked again. */
  private _openStream(system: string, col?: number, pinned = true): void {
    let targetCol = col ?? this._lastActiveCol;
    if (!this._colPlacement(targetCol)) {
      targetCol = this._placements.length ? this._placements[0].position.col : 0;
    }

    // Reuse a tab already open for this system (wherever it is).
    const existing = this._tabs.find((t) => t.system === system);
    if (existing) {
      if (!existing.pinned && pinned) {
        // A drag/drop onto the grid promotes a preview to permanent.
        this._pinTab(existing.id);
      }
      const currentCol = this._placements.findIndex((p) => p.tabIds.includes(existing.id));
      if (currentCol === targetCol && this._colPlacement(targetCol)) {
        this._activate(targetCol, existing.id);
      } else {
        this._moveTab(existing.id, targetCol, -1, true);
      }
      return;
    }

    // A preview open replaces any existing preview in the target column
    // (VS Code-style preview replacement).
    if (!pinned) {
      const target = this._colPlacement(targetCol);
      if (target) {
        const pi = target.tabIds.findIndex((id) => {
          const t = this._tabById(id);
          return !!t && !t.pinned;
        });
        if (pi >= 0 && this._tabById(target.tabIds[pi])?.system !== system) {
          this._closeTab(target.tabIds[pi]);
          targetCol = this._colPlacement(targetCol)
            ? targetCol
            : this._placements.length
              ? this._placements[0].position.col
              : 0;
        }
      }
    }

    const tab = this._makeTab(system, pinned);
    this._tabs = [...this._tabs, tab];
    // A brand-new tab is not in any placement yet, so insert it directly into
    // the target column (there is no source column to remove it from).
    this._insertTab(tab, targetCol, true);
  }

  /** Append a brand-new tab into `targetCol` (creating the column if needed) and
   *  activate it. Unlike `_moveTab`, the tab is NOT already in a placement, so
   *  there is no source column to remove it from. */
  private _insertTab(tab: LogTab, targetCol: number, activate = true): void {
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    let tIdx = targetCol;
    if (tIdx < 0 || tIdx > boxes.length) tIdx = boxes.length;
    if (tIdx >= boxes.length) boxes.push({ tabIds: [] });
    boxes[tIdx].tabIds.push(tab.id);
    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._reconcileActives();
    if (activate) {
      this._activeTabIds = { ...this._activeTabIds, [String(tIdx)]: tab.id };
      this._lastActiveCol = tIdx;
    }
  }

  /** Promote a preview tab to permanent (pin it). */
  private _pinTab(tabId: string): void {
    this._tabs = this._tabs.map((t) => (t.id === tabId ? { ...t, pinned: true } : t));
    this.requestUpdate();
  }

  // ── Grid event handlers (bubbled from <tab-grid> / <tab-bar>) ─────────

  private _onGridActivate = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    const col = detail.col as number | undefined;
    if (!tabId) return;
    const colNum =
      typeof col === "number" ? col : this._placements.findIndex((p) => p.tabIds.includes(tabId));
    this._activate(colNum, tabId);
  };

  private _onGridFocusCol = (e: Event): void => {
    const col = (e as CustomEvent).detail?.col as number | undefined;
    if (typeof col === "number") this._lastActiveCol = col;
  };

  private _onGridMove = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    this._moveTab(
      tabId,
      Number(detail.targetCol) || 0,
      Number.isFinite(detail.insertAt) ? detail.insertAt : -1,
    );
  };

  private _onGridSplit = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    this._splitTab(tabId, Number(detail.splitCol) || 0, Boolean(detail.splitLeft));
  };

  /** A stream row dropped on the grid fired `grid-open-tab` (open-tab source).
   *  Open it as a PINNED tab — in the cell, or in a freshly-split column when
   *  the drop landed on a column boundary. */
  private _onGridOpenTab = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    if (detail.tabType !== "log-viewer") return;
    const system = (detail.tabConfig as Record<string, unknown> | undefined)?.system as
      string | undefined;
    if (!system) return;
    if (
      detail.isBoundary &&
      (typeof detail.splitCol === "number" || typeof detail.splitLeft === "boolean")
    ) {
      this._openStreamSplit(system, Number(detail.splitCol) || 0, Boolean(detail.splitLeft));
      return;
    }
    const targetCol = Number.isFinite(detail.targetCol) ? Number(detail.targetCol) : undefined;
    this._openStream(system, targetCol, true);
  };

  /** Open a stream in a brand-new column split at the given boundary. Used when
   *  an `open-tab` stream source is dropped onto a column boundary. */
  private _openStreamSplit(system: string, splitCol: number, splitLeft: boolean): void {
    const existing = this._tabs.find((t) => t.system === system);
    if (existing) {
      this._pinTab(existing.id);
      const currentCol = this._placements.findIndex((p) => p.tabIds.includes(existing.id));
      if (currentCol === splitCol) {
        this._activate(splitCol, existing.id);
      } else {
        this._moveTab(existing.id, splitCol, -1, true);
      }
      return;
    }
    const tab = this._makeTab(system, true);
    this._tabs = [...this._tabs, tab];
    const boxes = this._placements.map((p) => ({ tabIds: [...p.tabIds] }));
    const at = Math.max(0, Math.min(splitLeft ? splitCol : splitCol + 1, boxes.length));
    boxes.splice(at, 0, { tabIds: [tab.id] });
    this._setPlacements(boxes.map((b, i) => ({ position: { row: 0, col: i }, tabIds: b.tabIds })));
    this._reconcileActives();
    this._activeTabIds = { ...this._activeTabIds, [String(at)]: tab.id };
    this._lastActiveCol = at;
  }

  private _onReorder = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    this._reorder(Number(detail.col) || 0, Number(detail.fromIndex), Number(detail.toIndex));
  };

  private _onMoveCell = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    this._moveTab(tabId, Number(detail.targetCol) || 0, Number(detail.dropIndex), true);
  };

  // ── Sidebar / stream rows / cross-stream search ───────────────────────

  /** Start a drag when the primary button goes down on a stream row. A plain
   *  click (no movement) still fires `click` afterwards and opens a preview;
   *  a drag onto the grid opens the stream permanently via `grid-open-tab`. */
  private _onStreamRowMouseDown = (e: Event): void => {
    const me = e as MouseEvent;
    if (me.button !== 0) return;
    const row = (me.target as Element | null)?.closest?.("[data-system]") as HTMLElement | null;
    if (!row) return;
    const system = row.getAttribute("data-system") || "";
    if (!system || !this._orchestrator) return;
    e.preventDefault();
    const source = new LogStreamDragSource(system);

    // Defer `drag:start` until the first POSITION event (threshold met) so the
    // main process captures a pixel-accurate bitmap of the sidebar row (like the
    // workspace's log-stream rows).
    const rect = row.getBoundingClientRect();
    const rowScreenX = window.screenX + rect.left;
    const rowScreenY = window.screenY + rect.top;
    this._pendingStreamDragStart = {
      label: system,
      screenX: me.screenX,
      screenY: me.screenY,
      system,
      winId: WIN_ID,
      offsetX: me.screenX - rowScreenX,
      offsetY: me.screenY - rowScreenY,
      width: row.offsetWidth,
      height: row.offsetHeight,
      captureRect: {
        x: rect.x + TAB_GHOST_CAPTURE_INSET,
        y: rect.y + TAB_GHOST_CAPTURE_INSET,
        width: Math.max(1, rect.width - TAB_GHOST_CAPTURE_INSET * 2),
        height: Math.max(1, rect.height - TAB_GHOST_CAPTURE_INSET * 2),
      },
    };
    this._beginDrag(source);
    this._orchestrator.startDrag(source, me.clientX, me.clientY);
  };

  /** Cross-stream search over the buffered logs (all systems). */
  private _searchResults(): readonly LogEntry[] {
    const q = this._searchQuery.trim();
    if (!q) return [];
    return queryLog({ search: q, limit: 200 });
  }

  // ── Detail drawer ────────────────────────────────────────────────────

  private _attachDetailListeners(): void {
    if (this._detailUnsub) return;
    const handler = (e: Event): void => {
      const entry = (e as CustomEvent<{ entry?: LogViewEntry }>).detail?.entry;
      if (!entry) return;
      // Lock the drawer to the grid cell that owns the clicked row, so it
      // overlays (and animates from) that column only. The event is composed,
      // so the composed path includes the tab-grid's grid-cell even across the
      // viewer/grid shadow boundaries.
      const cell =
        e
          .composedPath?.()
          .find((p): p is Element => p instanceof Element && p.classList.contains("grid-cell")) ??
        null;
      const nl = entry.message.indexOf("\n");
      const detail: DetailState = {
        message: nl < 0 ? entry.message : entry.message.slice(0, nl),
        stack: nl < 0 ? "" : entry.message.slice(nl + 1),
        source: entry.source,
        system: entry.system,
        process: entry.process,
        levelLabel: entry.levelLabel,
        timestamp: entry.timestamp,
      };
      // One drawer per cell: refresh an existing drawer for this cell, or open
      // a new one. Clicks with no resolvable cell share single grid-wide drawer.
      const idx = this._drawers.findIndex((d) => d.cell === cell);
      if (idx >= 0) {
        this._drawers = this._drawers.map((d, i) => (i === idx ? { ...d, detail } : d));
      } else {
        this._drawers = [...this._drawers, { id: ++this._drawerId, cell, detail }];
      }
    };
    this.shadowRoot?.addEventListener("log-row-click", handler);
    this._detailUnsub = () => this.shadowRoot?.removeEventListener("log-row-click", handler);
  }

  private _closeDrawer(id: number): void {
    this._drawers = this._drawers.filter((d) => d.id !== id);
  }

  /** Copy a code block's decoded text to the clipboard and flash a check. */
  private async _copyToClipboard(key: string, text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        this._legacyCopy(text);
      }
    } catch (err) {
      log.warn("logs-window clipboard write failed; falling back:", err);
      this._legacyCopy(text);
    }
    this._copied = key;
    if (this._copiedTimer !== null) window.clearTimeout(this._copiedTimer);
    this._copiedTimer = window.setTimeout(() => {
      this._copied = null;
      this._copiedTimer = null;
    }, 1200);
  }

  /** Clipboard fallback for environments without the async Clipboard API. */
  private _legacyCopy(text: string): void {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (err) {
      log.debug("logs-window legacy copy failed:", err);
      /* Best effort. */
    }
    ta.remove();
  }

  /** A labelled code block (square frame) with a copy button hanging beneath
   *  its bottom-right corner. The <pre> carries the selectable content; the
   *  bordered .lw-codeblock wrapper frames it, and the copy button is a small
   *  square frame in its own right whose top edge touches the block's bottom
   *  edge. */
  private _detailCodeblock(opts: {
    key: string;
    title: string;
    text: string;
    testid: string;
    buttonTestid: string;
    ariaLabel: string;
  }): TemplateResult {
    const copied = this._copied === opts.key;
    return html`
      <div class="lw-codeblock-wrap">
        <div class="lw-sec-title">${opts.title}</div>
        <div class="lw-codeblock" data-testid=${opts.testid}>
          <pre>${this._decodeEntities(opts.text)}</pre>
        </div>
        <button
          type="button"
          class="lw-copy-btn${copied ? " copied" : ""}"
          aria-label=${opts.ariaLabel}
          data-testid=${opts.buttonTestid}
          @click=${() => this._copyToClipboard(opts.key, this._decodeEntities(opts.text))}
        >
          ${copied ? CHECK_ICON : COPY_ICON}
        </button>
      </div>
    `;
  }

  private _detachDetailListeners(): void {
    this._detailUnsub?.();
    this._detailUnsub = null;
  }

  /** Recompute drawer geometry after a layout change while any are open. */
  private _onDetailResize = (): void => {
    if (this._drawers.length > 0) this.requestUpdate();
  };

  /** A cell's geometry (left/top/width/height) relative to [.lw-grid], or null
   *  when the cell can't be resolved (fall back to covering the whole grid). */
  private _cellRectFor(cell: Element | null): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const grid = this.renderRoot?.querySelector(".lw-grid") as HTMLElement | null;
    if (!grid || !cell || !cell.isConnected) return null;
    const gr = grid.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    return {
      left: cr.left - gr.left,
      top: cr.top - gr.top,
      width: cr.width,
      height: cr.height,
    };
  }

  // ── Viewer mounting into <tab-grid> ──────────────────────────────────

  private _grid(): TabGrid | null {
    const grid = this.renderRoot?.querySelector("tab-grid");
    return grid ? (grid as unknown as TabGrid) : null;
  }

  /** Mount each tab's log viewer into its <tab-content> controller slot.
   *  Waits for the grid (and its tab-content children) to finish rendering so
   *  the controller divs exist before mounting. Idempotent — re-mounts after
   *  a re-render so viewers follow their tabs when they move columns. */
  private async _mountViewers(): Promise<void> {
    const grid = this._grid();
    if (!grid) return;
    try {
      await (grid as unknown as { updateComplete: Promise<void> }).updateComplete;
      const contents = grid.querySelectorAll("tab-content");
      await Promise.all(
        Array.from(contents).map(
          (tc) => (tc as unknown as { updateComplete: Promise<void> }).updateComplete,
        ),
      );
    } catch (err) {
      // Defensive: if the grid is mid-teardown, skip this pass.
      log.debug("logs-window grid update-complete wait failed; skipping:", err);
    }
    for (const tab of this._tabs) {
      if (!this._placements.some((p) => p.tabIds.includes(tab.id))) continue;
      const viewer = this._ensureViewer(tab);
      grid.mountController(tab.id, viewer);
    }
  }

  private _ensureViewer(tab: LogTab): Openp41geLogViewer {
    let viewer = this._viewers.get(tab.id);
    if (!viewer) {
      viewer = document.createElement(Openp41geLogViewer.tagName) as Openp41geLogViewer;
      viewer.pageReader = new LogFilePageReader();
      viewer.system = tab.system;
      this._viewers.set(tab.id, viewer);
    }
    return viewer;
  }

  private _releaseViewer(tabId: string): void {
    const viewer = this._viewers.get(tabId);
    if (viewer?.parentNode) viewer.parentNode.removeChild(viewer);
    this._viewers.delete(tabId);
  }

  // ── Render ───────────────────────────────────────────────────────────

  private _tabData(): Record<string, { title: string; content: string; pinned: boolean }> {
    const data: Record<string, { title: string; content: string; pinned: boolean }> = {};
    for (const t of this._tabs) data[t.id] = { title: t.title, content: "", pinned: t.pinned };
    return data;
  }

  render(): TemplateResult {
    const isMac =
      typeof window !== "undefined" &&
      (window.openp41ge?.platform === "darwin" || navigator.platform.startsWith("Mac"));

    return html`
      <style>
        :host {
          display: block;
          height: 100%;
          overflow: hidden;
        }
        .lw-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          box-sizing: border-box;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #d4d4d4);
          font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace;
        }
        .lw-titlebar {
          flex-shrink: 0;
          height: 35px;
          box-sizing: border-box; /* total 35px incl. the 1px border — matches the workspace titlebar */
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 10px;
          border-bottom: 1px solid var(--border-divider, #2d2d2d);
          background: var(--bg-gutter, #161616);
          -webkit-app-region: drag;
          user-select: none;
        }
        .lw-titlebar .lw-spacer {
          flex: 1;
        }
        .lw-titlebar button,
        .lw-winbtn,
        .lw-sidebar-btn {
          -webkit-app-region: no-drag;
        }
        /* Right-sidebar toggle (mirrors the workspace titlebar's tb-btn). */
        .lw-sidebar-btn {
          width: 1.75rem; /* w-7 — same as the workspace titlebar button */
          height: 1.75rem;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 0.25rem; /* rounded */
          cursor: pointer;
          color: var(--text-secondary, #999);
          transition:
            color 0.12s ease,
            background 0.12s ease;
          margin-right: 0.25rem; /* mr-1 */
        }
        .lw-sidebar-btn:hover {
          background: var(--hover-bg, rgba(128, 128, 128, 0.15));
          color: var(--text-primary, #ccc);
        }
        .lw-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 26px;
          padding: 0 10px;
          border: 1px solid var(--border-divider, #333);
          border-radius: 5px;
          background: var(--bg-secondary, #161616);
          color: var(--text-primary, #ccc);
          font-size: 12px;
          font-family: var(--font-ui, sans-serif);
          cursor: pointer;
        }
        .lw-btn:hover {
          background: var(--bg-hover, #262626);
        }
        .lw-winbtn {
          width: 46px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-secondary, #aaa);
          font-size: 14px;
          font-family: var(--font-ui, sans-serif);
        }
        .lw-winbtn:hover {
          background: var(--bg-hover, #333);
        }
        .lw-winbtn.lw-close:hover {
          background: #e81123;
          color: #fff;
        }
        .lw-grid {
          flex: 1;
          min-width: 0;
          min-height: 0;
          position: relative;
          display: flex;
          overflow: hidden;
        }
        .lw-grid tab-grid {
          flex: 1;
          min-width: 0;
          min-height: 0;
          display: block;
        }
        /* Sidebar: a single, toggleable panel that sits on the configured side
           (right by default). Styled with the same language as the workspace
           sidebar (gutter background + a divider on its grid-facing edge). */
        .lw-body {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: row;
          overflow: hidden;
        }
        .lw-sidebar {
          width: 260px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          background: var(--bg-gutter, #161616);
        }
        .lw-sidebar.left {
          border-right: 1px solid var(--border-divider, #2d2d2d);
        }
        .lw-sidebar.right {
          border-left: 1px solid var(--border-divider, #2d2d2d);
        }
        /* Resize notch (drag bar) on the sidebar's grid-facing edge. Mirrors
           the workspace windowview notch: a 7px-wide, zero-width flex track
           (negative margins cancel the width) that straddles the sidebar/grid
           boundary and hosts the blue drag-line hover affordance. */
        .lw-notch-v {
          width: ${NOTCH_WIDTH}px;
          flex-shrink: 0;
          cursor: col-resize;
          position: relative;
          z-index: 10;
          background: transparent;
          margin-left: -${NOTCH_OVERFLOW}px;
          margin-right: -${NOTCH_WIDTH - NOTCH_OVERFLOW}px;
        }
        .lw-sidebar-head {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          height: 35px;
          padding: 0 12px;
          border-bottom: 1px solid var(--border-divider, #2d2d2d);
          font-family: var(--font-ui, sans-serif);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--text-secondary, #999);
        }
        .lw-sidebar-body {
          flex: 1;
          min-height: 0;
          position: relative;
          overflow: hidden;
        }
        .lw-sidebar-list {
          height: 100%;
          overflow-y: auto;
          padding: 6px 0;
        }
        .lw-sidebar-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          cursor: pointer;
          font-family: var(--font-ui, sans-serif);
          font-size: 12px;
          color: var(--text-primary, #ccc);
        }
        .lw-sidebar-row:hover {
          background: var(--bg-hover, #262626);
        }
        .lw-sidebar-sys {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lw-sidebar-count {
          flex-shrink: 0;
          color: var(--text-muted, #888);
          font-size: 11px;
          background: var(--bg-primary, #161616);
          border-radius: 8px;
          padding: 1px 7px;
        }
        .lw-sidebar-empty {
          padding: 12px;
          color: var(--text-muted, #888);
          font-size: 12px;
          font-style: italic;
          font-family: var(--font-ui, sans-serif);
        }
        .lw-empty {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-muted, #888);
          font-size: 12px;
          font-style: italic;
          pointer-events: none;
          background: var(--bg-primary, #1e1e1e);
        }
        .lw-sb-tabbar {
          position: relative;
          flex-shrink: 0;
          display: flex;
          align-items: stretch;
          height: 34px;
          border-bottom: 1px solid var(--border-divider, #2d2d2d);
          font-family: var(--font-ui, sans-serif);
          font-size: 13px;
        }
        .lw-sb-tabs {
          display: flex;
          align-items: stretch;
          flex: 1;
          min-width: 0;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .lw-sb-tabs::-webkit-scrollbar {
          display: none;
        }
        /* Edge shadows over the tab strip: shown while it overflows so tabs
           sliding under the edges read as cut off (mirrors the workspace
           sidebar). The right one stops just short of the + button. */
        .lw-sb-shadow {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 16px;
          pointer-events: none;
          z-index: 3;
          transition: opacity 0.12s ease;
        }
        .lw-sb-shadow.left {
          left: 0;
          background: linear-gradient(to right, rgba(0, 0, 0, 0.35), transparent);
        }
        .lw-sb-shadow.right {
          right: 34px;
          background: linear-gradient(to left, rgba(0, 0, 0, 0.35), transparent);
        }
        /* Workspace-style sidebar tab. */
        .lw-sb-tab {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 120px;
          height: 34px;
          padding: 0 0 0 10px;
          font-size: 13px;
          color: var(--text-secondary, #999);
          cursor: pointer;
          border-right: 1px solid var(--border-divider, #2d2d2d);
          user-select: none;
          white-space: nowrap;
          transition:
            color 0.075s ease,
            background 0.075s ease;
        }
        .lw-sb-tab:hover {
          color: var(--text-primary, #ccc);
        }
        /* The focused tab: a blue line across its top edge, as in the
           grid's tab bars. Inset, so the tab keeps its size. */
        .lw-sb-tab[data-focused] {
          box-shadow: inset 0 2px 0 #4a9eff;
        }
        .lw-sb-tab.active {
          background: var(--border-divider, #2d2d2d);
          color: var(--text-primary, #ccc);
        }
        .lw-sb-tab-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* The close button is the toolkit's <tab-close> (as on every tab
           handle). It is full height, so it draws the focus line over its own
           hover background too. */
        .lw-sb-tab[data-focused] .lw-sb-tab-close {
          box-shadow: inset 0 2px 0 #4a9eff;
        }
        /* ＋ button pinned to the right edge of the tab bar. */
        .lw-sb-add {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          flex-shrink: 0;
          border: none;
          border-left: 1px solid var(--border-divider, #2d2d2d);
          border-radius: 0;
          background: transparent;
          color: var(--text-secondary, #999);
          font-size: 13px;
          font-family: var(--font-ui, sans-serif);
          cursor: pointer;
          transition: background 0.075s ease;
          outline: none;
        }
        .lw-sb-add:hover {
          background: var(--bg-hover-strong, #444);
          color: var(--text-primary, #ccc);
        }
        .lw-search {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .lw-search-box {
          flex-shrink: 0;
          padding: 8px 10px;
          border-bottom: 1px solid var(--border-divider, #2d2d2d);
        }
        .lw-search-input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid var(--border-divider, #333);
          border-radius: 5px;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #d4d4d4);
          font-size: 12px;
          font-family: var(--font-ui, sans-serif);
          outline: none;
          box-sizing: border-box;
        }
        .lw-search-input:focus {
          border-color: var(--accent, #4fc1ff);
        }
        .lw-search-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 6px 12px;
          cursor: pointer;
          font-family: var(--font-ui, sans-serif);
          font-size: 12px;
          color: var(--text-primary, #ccc);
        }
        .lw-search-row:hover {
          background: var(--bg-hover, #262626);
        }
        .lw-search-time {
          flex-shrink: 0;
          color: var(--text-muted, #888);
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .lw-search-system {
          flex-shrink: 0;
          color: var(--accent, #4fc1ff);
          font-size: 11px;
          max-width: 40%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lw-search-msg {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary, #aaa);
        }
        .lw-detail-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          /* Allow highlighting / selecting log content so it can be copied. */
          user-select: text;
        }
        .lw-sec-title {
          color: var(--text-muted, #888);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-family: var(--font-ui, sans-serif);
          margin-bottom: 6px;
        }
        /* The block and its dangling copy button share a column, so the button's
           top edge can sit flush against the block's bottom edge. */
        .lw-codeblock-wrap {
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }
        /* Square copy button hanging off the block's bottom-right corner: a
           bordered frame in its own right whose top edge touches the block's
           bottom edge. The -1px top margin merges the button's top border with
           the block's bottom border into one continuous line (a tab attached
           to the block). */
        .lw-copy-btn {
          align-self: flex-end;
          position: relative;
          overflow: visible;
          box-sizing: border-box;
          display: grid;
          place-items: center;
          width: 26px;
          height: 24px;
          margin: -1px 0 0;
          padding: 0;
          border: 1px solid var(--border-divider, #2d2d2d);
          border-radius: 0;
          background: var(--bg-surface, #161616);
          color: var(--text-secondary, #999);
          cursor: pointer;
        }
        .lw-copy-btn svg {
          width: 12px;
          height: 12px;
        }
        .lw-copy-btn:hover,
        .lw-copy-btn:focus-visible {
          color: var(--text-primary, #fff);
          background: var(--bg-hover-strong, #2a2a2a);
        }
        .lw-copy-btn.copied {
          color: #6ecb6e;
        }
        /* Square code block for the Message / Stack details: monospace content
           on a surface background with a straight-edge border. The <pre> inside
           scrolls; the bordered wrapper is NOT a scroll container. */
        .lw-codeblock {
          position: relative;
          box-sizing: border-box;
          margin: 0;
          border: 1px solid var(--border-divider, #2d2d2d);
          border-radius: 0;
          background: var(--bg-surface, #161616);
          color: var(--text-primary, #d4d4d4);
          font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace;
          font-size: 12px;
          line-height: 1.5;
          user-select: text;
          cursor: text;
        }
        .lw-codeblock pre {
          margin: 0;
          padding: 8px 10px;
          white-space: pre-wrap;
          word-break: break-word;
          overflow-x: auto;
          font: inherit;
          color: inherit;
          user-select: text;
        }
        .lw-detail-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
          color: var(--text-secondary, #aaa);
          font-size: 12px;
        }
        /* Detail drawer — one per grid cell. Each is wrapped in a cell-sized
           overlay, so the drawer slides in from ITS OWN cell's right edge (not
           the grid's) and is clipped to that cell, never spilling into
           neighboring columns. Spans 80% of the cell's width. It overlays the
           cell's tab bar, so it carries a top bar matching the tab bar's 35px
           height (title + close). */
        .lw-drawer-wrap {
          position: absolute;
          z-index: 100;
        }
        .lw-drawer-mask {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          animation: lw-drawer-fade 0.18s ease-out;
        }
        @keyframes lw-drawer-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .lw-drawer {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 80%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #d4d4d4);
          border-left: 1px solid var(--border-divider, #2d2d2d);
          box-shadow: -2px 0 12px rgba(0, 0, 0, 0.45);
          z-index: 101;
          animation: lw-drawer-in 0.18s ease-out;
        }
        @keyframes lw-drawer-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .lw-drawer-head {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          /* Matches the cell tab bar's height (35px tabs + 1px border). */
          height: 35px;
          box-sizing: border-box;
          padding: 0 0 0 12px;
          border-bottom: 1px solid var(--border-divider, #2d2d2d);
          background: var(--bg-surface, #161616);
          color: var(--text-primary, #d4d4d4);
          font-size: 12px;
        }
        .lw-drawer-head-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: var(--font-ui, sans-serif);
          font-weight: 600;
        }
        /* Empty bottom bar mirroring the top bar's 35px height and surface
           background (with a divider on its body-facing edge). */
        .lw-drawer-foot {
          flex-shrink: 0;
          height: 35px;
          box-sizing: border-box;
          border-top: 1px solid var(--border-divider, #2d2d2d);
          background: var(--bg-surface, #161616);
        }
        /* Square close button filling the head's full height, flush against the
           drawer's right edge. A left border separates it from the title. */
        .lw-drawer-close {
          position: relative;
          overflow: visible;
          flex-shrink: 0;
          align-self: stretch;
          box-sizing: border-box;
          width: 35px;
          height: 35px;
          display: grid;
          place-items: center;
          background: transparent;
          border: none;
          border-left: 1px solid var(--border-divider, #2d2d2d);
          border-radius: 0;
          color: var(--text-secondary, #999);
          cursor: pointer;
          padding: 0;
        }
        .lw-drawer-close:hover {
          background: rgba(255, 255, 255, 0.07);
          color: var(--text-primary, #fff);
        }
      </style>

      <div class="lw-root">
        <div class="lw-titlebar" style="padding-left: ${isMac ? "82px" : "10px"}">
          <span class="lw-spacer"></span>
          <!-- Right sidebar toggle (same button as the workspace titlebar) -->
          <div
            class="lw-sidebar-btn"
            title=${this._sidebarOpen ? "Close sidebar" : "Open sidebar"}
            data-testid="lw-sidebar-toggle"
            @click=${this._toggleSidebar}
          >
            <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
              <path
                d="${
                  this._sidebarOpen
                    ? "M300-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm440-80h120v-560H640v560Zm-80 0v-560H200v560h360Zm80 0h120-120Z"
                    : "M460-320v-320L300-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm440-80h120v-560H640v560Zm-80 0v-560H200v560h360Zm80 0h120-120Z"
                }"
              ></path>
            </svg>
          </div>
          ${
            isMac
              ? nothing
              : html`
                  <div class="lw-winbtn" @click=${() => window.openp41ge?.window.minimize()}>─</div>
                  <div class="lw-winbtn" @click=${() => window.openp41ge?.window.maximize()}>□</div>
                  <div class="lw-winbtn lw-close" @click=${() => window.openp41ge?.window.close()}>
                    ✕
                  </div>
                `
          }
        </div>

        <div class="lw-body">
          ${
            this._sidebarOpen && this._sidebarSide === "left"
              ? this._sidebarLayout("left")
              : nothing
          }
          <div class="lw-grid">
            <tab-grid
              .winId=${WIN_ID}
              .cols=${this._cols}
              .placements=${this._placements}
              .tabData=${this._tabData()}
              .activeTabIds=${this._activeTabIds}
              .barShowAdd=${false}
              .focusVisible=${this._windowFocused && !(this._sidebarOpen && this._sidebarFocused)}
              .edgeLeft=${!(this._sidebarSide === "left" && this._sidebarOpen)}
              .edgeRight=${!(this._sidebarSide === "right" && this._sidebarOpen)}
              @grid-activate=${this._onGridActivate}
              @grid-focus-col=${this._onGridFocusCol}
              @grid-move=${this._onGridMove}
              @grid-split=${this._onGridSplit}
              @grid-open-tab=${this._onGridOpenTab}
              @tab-bar-reorder=${this._onReorder}
              @tab-bar-move-cell=${this._onMoveCell}
            ></tab-grid>
            ${
              this._tabs.length === 0
                ? html`<div class="lw-empty" data-testid="lw-empty">
                    <span>No log streams open.</span>
                    <button
                      type="button"
                      class="lw-btn"
                      style="pointer-events:auto"
                      @click=${this._openSidebarStreams}
                    >
                      ＋ Open a stream
                    </button>
                  </div>`
                : nothing
            }
            ${this._drawers.map((d) => {
              const r = this._cellRectFor(d.cell);
              const wrapStyle = r
                ? `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`
                : "left:0;top:0;width:100%;height:100%;";
              return html`
                <div class="lw-drawer-wrap" data-testid="lw-drawer-wrap" style=${wrapStyle}>
                  <div class="lw-drawer-mask" @click=${() => this._closeDrawer(d.id)}></div>
                  <aside class="lw-drawer" data-testid="lw-detail-drawer">
                    <div class="lw-drawer-head">
                      <span class="lw-drawer-head-title" data-testid="lw-drawer-title"
                        >Log details</span
                      >
                      <button
                        type="button"
                        class="lw-drawer-close"
                        aria-label="Close details"
                        data-testid="lw-drawer-close"
                        @click=${() => this._closeDrawer(d.id)}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                        >
                          <path d="M3 3l10 10M13 3L3 13" />
                        </svg>
                      </button>
                    </div>
                    <div class="lw-detail-body">
                      <div class="lw-detail-meta">
                        <div>
                          <span class="lw-sec-title">Source </span
                          >${this._decodeEntities(d.detail.source)}
                        </div>
                        <div>
                          <span class="lw-sec-title">System </span
                          >${this._decodeEntities(d.detail.system)}
                        </div>
                        <div>
                          <span class="lw-sec-title">Process </span
                          >${this._decodeEntities(d.detail.process)}
                        </div>
                        <div>
                          <span class="lw-sec-title">Level </span
                          >${this._decodeEntities(d.detail.levelLabel)}
                        </div>
                        <div>
                          <span class="lw-sec-title">Time </span
                          >${new Date(d.detail.timestamp).toLocaleString()}
                        </div>
                      </div>
                      ${this._detailCodeblock({
                        key: "message",
                        title: "Message",
                        text: d.detail.message,
                        testid: "lw-codeblock-message",
                        buttonTestid: "lw-copy-message",
                        ariaLabel: "Copy message",
                      })}
                      ${
                        d.detail.stack
                          ? this._detailCodeblock({
                              key: "stack",
                              title: "Stack",
                              text: d.detail.stack,
                              testid: "lw-codeblock-stack",
                              buttonTestid: "lw-copy-stack",
                              ariaLabel: "Copy stack",
                            })
                          : nothing
                      }
                    </div>
                    <div class="lw-drawer-foot" data-testid="lw-drawer-foot"></div>
                  </aside>
                </div>
              `;
            })}
          </div>
          ${
            this._sidebarOpen && this._sidebarSide === "right"
              ? this._sidebarLayout("right")
              : nothing
          }
        </div>
      </div>
    `;
  }

  /** Sidebar panel markup. A mini tab-bar (Streams | Search) above a single
   *  body; lists the registered log streams (single click opens a preview, a
   *  drag onto the grid opens the stream permanently) or searches across all
   *  streams. */
  private _sidebarTemplate(): TemplateResult {
    const openTabs = this._sidebarOpenTabs;
    const active = this._sidebarTab;
    return html`
      <aside
        class="lw-sidebar ${this._sidebarSide === "left" ? "left" : "right"}"
        style="width: ${this._sidebarWidth}px"
        data-testid="lw-sidebar"
        data-side=${this._sidebarSide}
      >
        <div class="lw-sb-tabbar" data-testid="lw-sidebar-tabs">
          <div class="lw-sb-tabs" role="tablist" @scroll=${this._onLwSbTabBarScroll}>
            ${openTabs.map((id, idx) => {
              const def = SIDEBAR_TAB_BY_ID[id];
              // Drop the last tab's right divider while the strip overflows
              // (its edge slides under the shadow), mirroring the workspace.
              const isLast = idx === openTabs.length - 1;
              const border =
                isLast && this._lwSbHasOverflow
                  ? "none"
                  : "1px solid var(--border-divider, #2d2d2d)";
              return html`
                <div
                  class="lw-sb-tab ${id === active ? "active" : ""}"
                  role="tab"
                  data-testid=${`lw-sbtab-${id}`}
                  aria-selected=${id === active}
                  ?data-focused=${id === active && this._windowFocused && this._sidebarFocused}
                  style="border-right:${border}"
                  @click=${() => this._onLwSbTabClick(id)}
                >
                  <span class="lw-sb-tab-label">${def.title}</span>
                  <tab-close
                    class="lw-sb-tab-close"
                    data-testid=${`lw-sbtab-close-${id}`}
                    ?active=${id === active}
                    @click=${(e: Event) => this._closeSidebarTab(e, id)}
                  ></tab-close>
                </div>
              `;
            })}
          </div>
          <!-- Edge shadows: shown while the tab strip overflows, so tabs sliding
               under the edges read as cut off (mirrors the workspace sidebar). -->
          <div class="lw-sb-shadow left" style="opacity:${this._lwSbShowLeftShadow ? 1 : 0}"></div>
          <div
            class="lw-sb-shadow right"
            style="opacity:${this._lwSbShowRightShadow ? 1 : 0}"
          ></div>
          <button
            type="button"
            class="lw-sb-add"
            data-testid="lw-sb-add"
            aria-label="Open sidebar tab"
            @click=${this._onSidebarAddClick}
          >
            ＋
          </button>
        </div>
        <div class="lw-sidebar-body">
          ${
            openTabs.includes(active)
              ? this._paneFor(active)
              : openTabs[0]
                ? this._paneFor(openTabs[0])
                : html`<div class="lw-sidebar-empty">Open a sidebar tab (＋).</div>`
          }
        </div>
      </aside>
    `;
  }

  private _streamsPane(): TemplateResult {
    const streams = listLogStreams();
    return html`
      <div class="lw-sidebar-list" data-testid="lw-sidebar-list">
        ${
          streams.length === 0
            ? html`<div class="lw-sidebar-empty">No streams registered.</div>`
            : streams.map((s) => this._sidebarRow(s))
        }
      </div>
    `;
  }

  private _sidebarRow(s: LogStreamInfo): TemplateResult {
    return html`
      <div
        class="lw-sidebar-row"
        data-testid="lw-sidebar-row"
        data-system=${s.system}
        title="Click to preview · drag to the grid to open"
        @mousedown=${this._onStreamRowMouseDown}
        @click=${() => this._openStream(s.system, undefined, false)}
      >
        <span class="lw-sidebar-sys">${this._escape(s.system)}</span>
        <span class="lw-sidebar-count">${s.entryCount}</span>
      </div>
    `;
  }

  private _searchPane(): TemplateResult {
    const results = this._searchResults();
    return html`
      <div class="lw-search" data-testid="lw-search">
        <div class="lw-search-box">
          <input
            type="text"
            class="lw-search-input"
            placeholder="Search all streams…"
            data-testid="lw-search-input"
            .value=${this._searchQuery}
            @input=${(e: Event) => {
              this._searchQuery = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
        <div class="lw-sidebar-list lw-search-results" data-testid="lw-search-results">
          ${
            !this._searchQuery.trim()
              ? html`<div class="lw-sidebar-empty">Type to search all streams.</div>`
              : results.length === 0
                ? html`<div class="lw-sidebar-empty">No matches.</div>`
                : results.map((r) => this._searchResultRow(r))
          }
        </div>
      </div>
    `;
  }

  /** One cross-stream search result row. Single click opens the system's
   *  stream as a preview with the find bar focused on the hit. */
  private _searchResultRow(e: LogEntry): TemplateResult {
    return html`
      <div
        class="lw-search-row"
        data-testid="lw-search-row"
        data-system=${this._escape(e.system)}
        title="Open ${this._escape(e.system)} focused on this match"
        @click=${() => this._openSearchResult(e)}
      >
        <span class="lw-search-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
        <span class="lw-search-system">${this._escape(e.system)}</span>
        <span class="lw-search-msg">${this._escape(String(e.text ?? e.message))}</span>
      </div>
    `;
  }

  /**
   * Open the error `errorId`: its stream's tab, scrolled to the entry, with the
   * entry's detail drawer open. Resolves false (and opens nothing) when no log
   * file has the error.
   */
  async revealError(errorId: string): Promise<boolean> {
    const found = await window.openp41ge?.logs?.findError?.(errorId);
    if (!found) {
      log.warn(`logs window: no log entry has error id ${errorId}`);
      return false;
    }
    this._openStream(found.system);
    await this.updateComplete;
    const tab = this._tabs.find((t) => t.system === found.system);
    if (!tab) return false;
    // The viewer must be mounted (connected) before it loads and can reveal.
    await this._mountViewers();
    return (await this._ensureViewer(tab).revealError(errorId)) !== null;
  }

  /** Open the system's stream (preview) and focus the viewer's find bar on the
   *  search term so the matched line is highlighted/reachable. */
  private _openSearchResult(e: LogEntry): void {
    this._openStream(e.system, undefined, false);
    const tab = this._tabs.find((t) => t.system === e.system);
    if (!tab) return;
    const viewer = this._ensureViewer(tab);
    const q = this._searchQuery.trim();
    viewer.setFindQuery(q);
  }

  private _escape(text: string): string {
    return text.replace(
      /[&<>"']/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m] ?? m,
    );
  }

  /**
   * Decode the common HTML entities (named + numeric) that may appear in log
   * text, so e.g. `&quot;` renders as `"` rather than the literal entity. The
   * result is rendered through Lit's text interpolation (a text node, not
   * parsed HTML), so decoding remains XSS-safe — it only unescapes entities.
   */
  private _decodeEntities(text: string): string {
    return text.replace(
      /&(?:quot|amp|lt|gt|apos|nbsp|#(\d+)|#x([0-9a-fA-F]+));/g,
      (m, dec: string | undefined, hex: string | undefined) => {
        if (dec !== undefined) return String.fromCodePoint(Number(dec));
        if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
        switch (m) {
          case "&quot;":
            return '"';
          case "&amp;":
            return "&";
          case "&lt;":
            return "<";
          case "&gt;":
            return ">";
          case "&apos;":
            return "'";
          case "&nbsp;":
            return "\u00a0";
          default:
            return m;
        }
      },
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-logs-window": Openp41geLogsWindow;
  }
}
