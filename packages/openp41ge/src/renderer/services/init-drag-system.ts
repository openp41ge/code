/**
 * init-drag-system — Initializes the openp41ge-core-tabs drag-and-drop system.
 *
 * Cross-window drag:
 *   - Main process broadcasts drag-state (active/inactive) to all windows
 *   - When drag-state=active, every window tracks _remoteDragActive
 *   - On mousemove, if _remoteDragActive and cursor is over a drop target,
 *     show grid ghost overlay locally (no IPC per frame needed)
 *   - On mouseup, if no local drag and _remoteDragActive, query main process
 *     for drag data, resolve local target, dispatch workspace operation
 */

import {
  DragOrchestrator,
  TabDragSource,
  GhostManager,
  DRAG_EVENTS,
  computeDropTarget,
  type IDragSource,
  type IDropTarget,
  type DragResult,
  type DragSourceData,
  type PayloadDragData,
  setPayloadOpenResolver,
} from "../openp41ge-tabs-adapter";

import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "cross-window-drag");

import { PayloadDragSource } from "./drag-sources/payload-drag-source";
import type { DragEngagePoint, PayloadDragRequest } from "./extension-drag-service";
import { extensionDrag } from "./extension-drag";
import { resolveCrossWindowPayloadDrop } from "./payload-cross-window";
import { LogStreamDragSource } from "./drag-sources/log-stream-drag-source";
import { ManagerTabDragSource } from "./drag-sources/manager-tab-drag-source";
import { MANAGER_GRID_WIN_ID } from "./manager-grid-layout";
import { ClosedSidebarDropTarget } from "./drop-targets/closed-sidebar-drop-target";
import {
  SidebarDropTarget,
  setSidebarDropFeedbackSuppressed,
} from "./drop-targets/sidebar-drop-target";
import {
  ManagerTabBarDropTarget,
  managerDropIndex,
} from "./drop-targets/manager-tab-bar-drop-target";
import { SIDEBAR_DROP_EVENT } from "openp41ge-core-constants";

// ─── SidebarTabDragSource — drag source for sidebar system tabs ──────────

class SidebarTabDragSource implements IDragSource {
  readonly type = "sidebar-tab";

  private _el: HTMLElement;
  private _tabId: string;
  private _side: string;
  private _winId: string;
  private _title: string;
  private _ghost: HTMLElement | null = null;
  private _ghostFactory?: () => HTMLElement;

  constructor(
    el: HTMLElement,
    tabId: string,
    side: string,
    winId: string,
    title: string,
    ghostFactory?: () => HTMLElement,
  ) {
    this._el = el;
    this._tabId = tabId;
    this._side = side;
    this._winId = winId;
    this._title = title;
    this._ghostFactory = ghostFactory;
  }

  createGhost(): HTMLElement {
    // Like grid tabs/files, the in-DOM ghost is invisible — the visible drag
    // element is the main-process bitmap ghost (DragGhostManager).
    if (this._ghostFactory) {
      const ghost = this._ghostFactory();
      this._ghost = ghost;
      return ghost;
    }

    const ghost = document.createElement("div");
    ghost.classList.add("openp41ge-drag-ghost");
    const label = document.createElement("span");
    label.textContent = this._title;
    ghost.appendChild(label);

    const w = this._el.offsetWidth || 120;
    const h = this._el.offsetHeight || 28;

    ghost.style.cssText = [
      "position:fixed",
      `height:${h}px`,
      `width:${w}px`,
      "padding:4px 14px",
      "display:block",
      "line-height:14px",
      "font-size:12px",
      "color:#e0e0e0",
      "background:#2a2a2a",
      "border-radius:4px",
      "outline:2px solid rgba(74,158,255,0.60)",
      "outline-offset:2px",
      "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
      "z-index:99999",
      "pointer-events:none",
      "opacity:0.85",
      "overflow:hidden",
      "white-space:nowrap",
      "text-overflow:ellipsis",
      "box-sizing:border-box",
    ].join(";");

    ghost.dataset.dragGhostWidth = String(w);
    ghost.dataset.dragGhostHeight = String(h);
    this._ghost = ghost;
    return ghost;
  }

  getDragData(): DragSourceData {
    return {
      type: "system-tab",
      tabId: this._tabId,
      side: this._side,
      winId: this._winId,
      title: this._title,
    };
  }

  onDragStart(): void {
    this._el.style.opacity = "0.4";
  }

  onDragEnd(_result: DragResult): void {
    this._el.style.opacity = "1";
    if (this._ghost && this._ghost.parentNode) {
      this._ghost.parentNode.removeChild(this._ghost);
    }
    this._ghost = null;
  }
}

let _orchestrator: DragOrchestrator | null = null;
let _currentSource: IDragSource | null = null;
let _ghostManager = new GhostManager();

// ─── Drag-ghost dimming over tab bars ──────────────────────────────────────
// While the cursor hovers a tab bar, a drop indicator bar is drawn there under
// the floating drag ghost. The ghost would otherwise cover it, so we fade the
// ghost to a low opacity to let the drop indicator show through. The opacity is
// animated in the main-process DragGhostManager (IPC `drag:setOpacity`). The
// resolved target's `onHover` feedback reports `overTabBar`, so the ghost is
// dimmed ONLY while the cursor is actually over a tab bar — not over the
// sidebar/cell body beneath it.
const DRAG_GHOST_DIM_OPACITY = 0.33;
let _dragGhostDimmed = false;

function _setDragGhostDimmed(_target: IDropTarget | null, overTabBar: boolean): void {
  if (overTabBar === _dragGhostDimmed) return;
  _dragGhostDimmed = overTabBar;
  // The drag bridge may be absent (e.g. unit tests / non-Electron renderer).
  window.openp41ge?.drag?.setOpacity?.(overTabBar ? DRAG_GHOST_DIM_OPACITY : 1);
}

/** Whether another Electron window has an active drag. */
let _remoteDragActive = false;
/** Drag source type of the remote (other-window) drag, from the drag-state broadcast. */
let _remoteDragType: string | null = null;
/** Whether our window has an active local drag. */
let _localDragActive = false;

/**
 * Set when a drag's drop was handled — on a grid target (grid-open-tab), an
 * extension drop target, or by another window (end-session) — so a
 * cross-window payload release doesn't also run its outside-window path.
 */
let _dropHandled = false;

/** Last screen position from POSITION events — used for new-window positioning. */
let _lastScreenPos = { screenX: 0, screenY: 0 };

/** Deferred drag:start params for tab drags, captured on mousedown, fired on first POSITION event. */
let _pendingDragStart: {
  label: string;
  screenX: number;
  screenY: number;
  tabId: string;
  winId: string;
  worksetId: string;
  tabWidth: number;
  tabHeight: number;
  offsetX: number;
  offsetY: number;
  /** Source tab button rect (viewport coords) for the main-process capturePage snapshot. */
  captureRect: { x: number; y: number; width: number; height: number };
} | null = null;

/**
 * Ghost capture inset (px) applied to the tab-button rect. Trims the tab's 1px
 * separator border (and any drop-indicator line clipped at the edge) so the
 * bitmap ghost is a clean copy of the tab interior.
 */
const TAB_GHOST_CAPTURE_INSET = 2;

/**
 * Deferred drag:start params for sidebar tab drags — captured on mousedown,
 * fired on the first POSITION event (like grid tabs, so the sidebar tab gets
 * the same pixel-accurate bitmap ghost).
 */
let _pendingSidebarDragStart: {
  label: string;
  screenX: number;
  screenY: number;
  tabId: string;
  side: string;
  winId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Source sidebar-tab rect (viewport coords), trimmed by TAB_GHOST_CAPTURE_INSET. */
  captureRect: { x: number; y: number; width: number; height: number };
} | null = null;

/**
 * Source sidebar side of the most recent sidebar-tab drag.
 *
 * Survives drag teardown: the orchestrator fires DRAG_EVENTS.END (which makes
 * the host tear down and null _currentSource) BEFORE it resolves the drop
 * target on mouseup, so the final resolve can't see the live source. This flag
 * lets the resolver still know the drag was a system-tab (and from which side)
 * for that final resolve. Cleared when any non-sidebar drag starts (grid tab /
 * file) or when a drag is interrupted, so it never leaks into another gesture.
 */
let _sidebarTabDragSide: "left" | "right" | null = null;

/**
 * Set once a manager-tab drag engages. The orchestrator fires DRAG_EVENTS.END
 * (which makes the host tear down and null _currentSource) BEFORE it resolves
 * the drop target on mouseup, so the final resolve can't see the live source.
 * This flag lets the resolver still know the drag was a manager-tab for that
 * final resolve. Cleared when any other drag starts or the drag is torn down.
 */
let _managerTabDragActive = false;

/** Suppress the trailing browser click on the source manager tab after a drag
 *  (the manager tab's @click activates it) so a release that stayed within the
 *  click slop doesn't re-activate it as if it were a plain click. */
let _suppressManagerTabClick = false;

/** Deferred drag:start params for manager-tab drags — captured on mousedown,
 *  fired on the first POSITION event (threshold met), so the main process
 *  captures a pixel-accurate bitmap of the source tab. */
let _pendingManagerTabDragStart: {
  label: string;
  screenX: number;
  screenY: number;
  tabId: string;
  winId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Source manager-tab rect (viewport coords), trimmed by TAB_GHOST_CAPTURE_INSET. */
  captureRect: { x: number; y: number; width: number; height: number };
} | null = null;

/**
 * The Application Management window's tab-bar element and its drop target,
 * registered by <openp41ge-window-manager> via registerManagerTabBar(). Only
 * one manager window exists per renderer process, so these are singletons.
 */
let _managerBarEl: HTMLElement | null = null;
let _managerBarDropTarget: ManagerTabBarDropTarget | null = null;

/**
 * Deferred drag:start params for extension payload drags (`startPayloadDrag`),
 * captured on mousedown and fired on the first POSITION event.
 */
let _pendingPayloadDragStart: {
  label: string;
  screenX: number;
  screenY: number;
  winId: string;
  offsetX: number;
  offsetY: number;
  elementWidth: number;
  elementHeight: number;
  captureRect: { x: number; y: number; width: number; height: number };
  data: PayloadDragData;
} | null = null;

/**
 * The payload of the current local (or incoming cross-window) payload drag.
 * Kept past DRAG_EVENTS.END because the orchestrator resolves the final drop
 * target AFTER the host's teardown nulls `_currentSource`. Cleared by the next
 * gesture's capture-phase mousedown.
 */
let _activePayloadDrag: PayloadDragData | null = null;
/** Source element whose native draggable was disabled for a payload drag. */
let _payloadRowSuppressedDrag: HTMLElement | null = null;
/** That element's original `draggable` attribute (null = absent). */
let _payloadRowPrevDraggable: string | null = null;
/** Set once a payload drag engages, so the trailing click on the source is swallowed. */
let _suppressPayloadRowClick = false;

/**
 * Deferred drag:start params for log-stream (Logs sidebar row) drags — captured
 * on mousedown, fired on the first POSITION event exactly like file/tab/git
 * backlog. The open-tab payload rides `openTabData` so a TARGET window's
 * cross-window drop can open a stream-scoped log-viewer pane.
 */
let _pendingLogStreamDragStart: {
  label: string;
  screenX: number;
  screenY: number;
  system: string;
  winId: string;
  offsetX: number;
  offsetY: number;
  elementWidth: number;
  elementHeight: number;
  /** Source row rect (viewport coords) for the main-process capturePage snapshot. */
  captureRect: { x: number; y: number; width: number; height: number };
} | null = null;

/** Set to true when a log-stream drag engages so the trailing browser `click`
 * on the source row can be suppressed — otherwise releasing back over the
 * sidebar after a drag is seen as a click and re-opens the stream as if it
 * were a plain click. A stream should only open on an explicit grid drop (or
 * a plain click that never became a drag). */
let _suppressLogStreamRowClick = false;

/**
 * The window ID of this renderer, resolved lazily.
 * Cannot be cached at init time because openp41ge:init (which sets
 * _windowId in the preload) arrives after bootstrap runs. Use
 * _resolveMyWinId() instead for cross-window drops.
 */
let _myWinId: string | null = null;

function _resolveMyWinId(): string {
  if (_myWinId) return _myWinId;
  _myWinId = window.openp41ge.workspace.getWindowId();
  return _myWinId || "";
}

/** Restore native draggable on a payload source element (Lit re-render guard). */
function _restorePayloadRowDraggable(): void {
  if (_payloadRowSuppressedDrag) {
    if (_payloadRowSuppressedDrag.getAttribute("draggable") === "false") {
      if (_payloadRowPrevDraggable === null) _payloadRowSuppressedDrag.removeAttribute("draggable");
      else _payloadRowSuppressedDrag.setAttribute("draggable", _payloadRowPrevDraggable);
    }
    _payloadRowSuppressedDrag = null;
    _payloadRowPrevDraggable = null;
  }
}

/** A cross-window `file-path` payload released outside every window opens a new window. */
function _payloadDetachPath(data: PayloadDragData): string | null {
  if (!data.crossWindow || data.payload.kind !== "openp41ge/file-path") return null;
  const filePath = (data.payload as { filePath?: unknown }).filePath;
  return typeof filePath === "string" ? filePath : null;
}

/**
 * A payload drag released without a local drop: hit-test the release point
 * and open the payload in another window of the same workspace, or — for a
 * cross-window file released outside every window — in a new window.
 */
async function _completePayloadRelease(
  data: PayloadDragData,
  screenX: number,
  screenY: number,
): Promise<void> {
  try {
    const myWinId = _resolveMyWinId();
    const check = await window.openp41ge.drag.check(screenX, screenY).catch(() => null);
    const windows = check
      ? await window.openp41ge.windowManager.openWindowSummaries().catch(() => [])
      : [];
    const decision = resolveCrossWindowPayloadDrop({
      check,
      myWinId,
      windows,
      data,
      resolve: (d) => {
        const open = extensionDrag.registry.resolve(
          d.payload as Parameters<typeof extensionDrag.registry.resolve>[0],
          "grid",
        );
        return open ? { appType: open.appType, tabConfig: open.tabConfig } : null;
      },
    });
    if (decision.kind === "open") {
      document.dispatchEvent(new CustomEvent("grid-open-tab", { detail: decision.detail }));
      return;
    }
    if (decision.kind === "outside") {
      const filePath = _payloadDetachPath(data);
      if (!filePath) return;
      const fileName = filePath.split("/").filter(Boolean).pop() || "file";
      window.openp41ge.workspace.dispatch(
        "actionOpenFileInNewWindow",
        filePath,
        fileName,
        myWinId,
        screenX,
        screenY,
      );
    }
  } catch (err) {
    log.error("payload drop release failed:", err, { skipToast: true });
  }
}

/**
 * Start a platform drag for an extension's typed payload. This is the
 * `PayloadDragPipeline` the extension drag service hands drags to: same
 * gesture/threshold, deferred bitmap ghost and click suppression as the
 * built-in row drags, with a `payload` drag type.
 */
export function startPayloadDrag(req: PayloadDragRequest): void {
  if (!_orchestrator) return;
  const { element: el, event: e, source, payload } = req;
  if (e.button !== 0) return;

  _suppressPayloadRowClick = false;
  // The custom pipeline owns the gesture: stop Chromium starting a native
  // HTML5 drag that could race it (restored on end).
  _restorePayloadRowDraggable();
  _payloadRowSuppressedDrag = el;
  _payloadRowPrevDraggable = el.getAttribute("draggable");
  el.setAttribute("draggable", "false");

  const label = el.textContent?.trim() || source.label;
  const data: PayloadDragData = {
    type: "payload",
    payload,
    sourceId: source.id,
    contexts: [...source.contexts],
    crossWindow: source.crossWindow,
    title: label,
  };
  _activePayloadDrag = data;

  const rect = el.getBoundingClientRect();
  const offsetX = e.screenX - (window.screenX + rect.left);
  const offsetY = e.screenY - (window.screenY + rect.top);
  const dragSource = new PayloadDragSource(data);
  _currentSource = dragSource;
  _sidebarTabDragSide = null;
  _orchestrator.startDrag(dragSource, e.clientX, e.clientY);

  _pendingPayloadDragStart = {
    label,
    screenX: e.screenX,
    screenY: e.screenY,
    winId: _resolveMyWinId(),
    offsetX,
    offsetY,
    elementWidth: el.offsetWidth,
    elementHeight: el.offsetHeight,
    captureRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    data,
  };
}

/** Start the pending drag in place (a long-press on an extension source). */
export function engageDrag(at: DragEngagePoint): boolean {
  return _orchestrator?.engage(at) ?? false;
}

/** `elementFromPoint` that descends into open shadow roots. */
function _deepElementFromPoint(clientX: number, clientY: number): Element | null {
  let el: Element | null = document.elementFromPoint(clientX, clientY);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(clientX, clientY);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** `closest` that continues past shadow roots into their hosts: the element
 *  under the cursor may be inside one (e.g. a <tab-close>'s ✕). */
function _closestComposed(el: Element, selector: string): Element | null {
  let node: Element | null = el;
  while (node) {
    const hit = node.closest(selector);
    if (hit) return hit;
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** Stable IDropTarget adapters per extension drop-target element. */
const _extensionDropTargets = new WeakMap<HTMLElement, IDropTarget>();

/**
 * Resolve an extension in-place drop target (`data-drop-target-id`) under the
 * cursor that accepts the payload, or null to fall through to the grid.
 */
function _resolveExtensionDropTarget(
  clientX: number,
  clientY: number,
  data: PayloadDragData,
): IDropTarget | null {
  const el = _deepElementFromPoint(clientX, clientY);
  if (!el) return null;
  let hit: ReturnType<typeof extensionDrag.service.findDropTarget>;
  try {
    hit = extensionDrag.service.findDropTarget(
      el,
      data.payload as Parameters<typeof extensionDrag.service.findDropTarget>[1],
    );
  } catch (err) {
    log.error("payload drop target resolve failed:", err, { skipToast: true });
    return null;
  }
  if (!hit) return null;
  const element = hit.element;
  let target = _extensionDropTargets.get(element);
  if (!target) {
    target = {
      type: "extension-drop-target",
      element,
      onHover: () => {
        element.setAttribute("data-drop-active", "");
        return { showGhost: false };
      },
      onDrop: async (source) => {
        element.removeAttribute("data-drop-active");
        const d = source.getDragData() as PayloadDragData;
        const current = extensionDrag.service.findDropTarget(
          element,
          d.payload as Parameters<typeof extensionDrag.service.findDropTarget>[1],
        );
        if (!current) return { success: false, reason: "drop target no longer accepts payload" };
        current.deliver({ sourceId: d.sourceId });
        _dropHandled = true;
        return { success: true };
      },
      onLeave: () => element.removeAttribute("data-drop-active"),
    };
    _extensionDropTargets.set(element, target);
  }
  return target;
}

// ─── Mousedown: initiate log-stream (Logs sidebar row) drags ─────────────
// Module-level so the synthetic Mousedown test hooks can drive it directly.
function onLogStreamMouseDown(e: MouseEvent): void {
  // Only the primary (left) button engages drags — right/middle clicks must
  // never start a drag or interrupt an existing one.
  if (e.button !== 0) return;

  // Log-stream sidebar rows (retired Logs system tab) were built in the light DOM.
  const row = e
    .composedPath()
    .find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-log-system"),
    );
  if (!row) return;

  // New gesture — clear any unconsumed suppression flag from a previous drag.
  _suppressLogStreamRowClick = false;

  // Prevent text-selection / native text drag on the row during the gesture.
  e.preventDefault();

  const system = row.getAttribute("data-log-system") || "";
  if (!system) return;
  const title = system;
  const winId = _resolveMyWinId();

  // Calculate offset from cursor to element's top-left corner (screen coords).
  const rect = row.getBoundingClientRect();
  const elScreenX = window.screenX + rect.left;
  const elScreenY = window.screenY + rect.top;
  const offsetX = e.screenX - elScreenX;
  const offsetY = e.screenY - elScreenY;

  const dragSource = new LogStreamDragSource(system, title);
  dragSource.setOffset(offsetX, offsetY);
  _currentSource = dragSource;
  _sidebarTabDragSide = null; // not a sidebar-tab drag
  _orchestrator?.startDrag(dragSource, e.clientX, e.clientY);

  // Defer drag:start until the first POSITION event (after threshold met),
  // mirroring the file/tab/git pattern so the main process captures a
  // pixel-accurate bitmap of the source row.
  _pendingLogStreamDragStart = {
    label: title,
    screenX: e.screenX,
    screenY: e.screenY,
    system,
    winId,
    offsetX,
    offsetY,
    elementWidth: row.offsetWidth,
    elementHeight: row.offsetHeight,
    captureRect: {
      x: rect.x + TAB_GHOST_CAPTURE_INSET,
      y: rect.y + TAB_GHOST_CAPTURE_INSET,
      width: Math.max(1, rect.width - TAB_GHOST_CAPTURE_INSET * 2),
      height: Math.max(1, rect.height - TAB_GHOST_CAPTURE_INSET * 2),
    },
  };
}

// ─── Mousedown: initiate manager-tab (Application Management tab bar) drags ─
// Module-level so the synthetic Mousedown test hooks can drive it directly.
function onManagerTabMouseDown(e: MouseEvent): void {
  // Only the primary (left) button engages drags — right/middle clicks must
  // never start a drag or interrupt an existing one.
  if (e.button !== 0) return;

  // The management window's tab bar lives in <openp41ge-window-manager>'s
  // shadow root, so at the document boundary e.target retargets to the host.
  // Walk composedPath() to find the actual tab carrying data-manager-tab.
  const tabEl = e
    .composedPath()
    .find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-manager-tab"),
    );
  if (!tabEl) return;

  // Don't initiate a drag from the tab's close button — it stays click-only.
  if (
    e
      .composedPath()
      .some((el) => el instanceof HTMLElement && el.classList.contains("wm-tab-close"))
  ) {
    return;
  }

  // New gesture — clear any unconsumed suppression flag from a previous drag.
  _suppressManagerTabClick = false;

  e.preventDefault();

  const tabId = tabEl.getAttribute("data-manager-tab") || "";
  if (!tabId) return;
  const title =
    (tabEl.querySelector(".wm-tab-title")?.textContent ?? tabEl.textContent ?? "").trim() || tabId;
  const winId = _resolveMyWinId();

  // Calculate the cursor offset from the tab's top-left corner so the bitmap
  // ghost hangs from where the user actually grabbed it (screen coords).
  const rect = tabEl.getBoundingClientRect();
  const elScreenX = window.screenX + rect.left;
  const elScreenY = window.screenY + rect.top;
  const offsetX = e.screenX - elScreenX;
  const offsetY = e.screenY - elScreenY;

  const dragSource = new ManagerTabDragSource(tabEl, tabId, winId, title);
  dragSource.setOffset(offsetX, offsetY);
  _currentSource = dragSource;
  _sidebarTabDragSide = null; // not a sidebar-tab drag
  _managerTabDragActive = true;
  _orchestrator?.startDrag(dragSource, e.clientX, e.clientY);

  // Defer drag:start until the first POSITION event (after threshold met),
  // mirroring the grid/sidebar tab pattern so the main process captures a
  // pixel-accurate bitmap of the source tab.
  _pendingManagerTabDragStart = {
    label: title,
    screenX: e.screenX,
    screenY: e.screenY,
    tabId,
    winId,
    width: tabEl.offsetWidth,
    height: tabEl.offsetHeight,
    offsetX,
    offsetY,
    captureRect: {
      x: rect.x + TAB_GHOST_CAPTURE_INSET,
      y: rect.y + TAB_GHOST_CAPTURE_INSET,
      width: Math.max(1, rect.width - TAB_GHOST_CAPTURE_INSET * 2),
      height: Math.max(1, rect.height - TAB_GHOST_CAPTURE_INSET * 2),
    },
  };
}

// ─── Dummy drag source for cross-window ghost preview ────────────────────

/**
 * Initialize the drag system. Call once during startup.
 * Returns a cleanup function.
 */
export function initDragSystem(): () => void {
  const cleanups: (() => void)[] = [];

  // Cache window ID for local drag session tracking (getWindowId may return
  // null if openp41ge:init hasn't arrived yet — _resolveMyWinId handles lazily)
  _myWinId = window.openp41ge.workspace.getWindowId();

  // ── Create the orchestrator ──────────────────────────────────────────
  _orchestrator = new DragOrchestrator(openp41geTargetResolver, _setDragGhostDimmed);

  // Extension payload drags over a grid resolve kind → consumer here.
  setPayloadOpenResolver(extensionDrag.resolveGridOpen);
  cleanups.push(() => setPayloadOpenResolver(null));
  cleanups.push(() => {
    _orchestrator?.dispose();
    _orchestrator = null;
    _dragGhostDimmed = false;
  });

  // ── Mousedown: initiate tab drags ────────────────────────────────────
  //
  // Found through the event's composed path: a grid may be inside shadow roots
  // (the manager window's is), where `e.target` is the outermost host. A
  // window that drags its own tabs (the Logs window) marks its host
  // `data-own-tab-drags` and is left alone.
  const onMouseDown = (e: MouseEvent) => {
    const path = e.composedPath().filter((el): el is HTMLElement => el instanceof HTMLElement);
    const tabBtn = path.find((el) => el.hasAttribute("data-tab-id"));
    if (!tabBtn) return;
    if (path.some((el) => el.classList.contains("tab-close"))) return;
    if (path.some((el) => el.hasAttribute("data-own-tab-drags"))) return;

    e.preventDefault();

    const tabId = tabBtn.getAttribute("data-tab-id") || "";
    const tabBarEl = tabBtn.closest?.("tab-bar");
    if (!tabBarEl) return;

    const tabBar = tabBarEl as HTMLElement & { winId?: string; col?: number };
    const winId = tabBar.winId || "";
    const col = tabBar.col ?? 0;
    const label = tabBtn.textContent?.trim() || "Tab";

    // Calculate offset from cursor to tab's top-left (in screen coordinates)
    const tabRect = tabBtn.getBoundingClientRect();
    const tabScreenX = window.screenX + tabRect.left;
    const tabScreenY = window.screenY + tabRect.top;
    const tabWidth = tabBtn.offsetWidth;
    const tabHeight = tabBtn.offsetHeight;
    const offsetX = e.screenX - tabScreenX;
    const offsetY = e.screenY - tabScreenY;

    // Use a ghostFactory that returns an invisible element — we only want the
    // main-process BrowserWindow ghost (DragGhostManager), not the in-DOM floating ghost.
    const dragSource = new TabDragSource(tabBtn, tabId, winId, col.toString(), label, () => {
      const ghost = document.createElement("div");
      ghost.style.cssText =
        "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px;z-index:-1;";
      return ghost;
    });
    _currentSource = dragSource;
    _sidebarTabDragSide = null; // not a sidebar-tab drag
    _orchestrator?.startDrag(dragSource, e.clientX, e.clientY);

    // Defer drag:start until the POSITION event fires (after threshold met).
    // Store params for the deferred call.
    _pendingDragStart = {
      label,
      screenX: e.screenX,
      screenY: e.screenY,
      tabId,
      winId,
      worksetId: col.toString(),
      tabWidth,
      tabHeight,
      offsetX,
      offsetY,
      captureRect: {
        x: tabRect.x + TAB_GHOST_CAPTURE_INSET,
        y: tabRect.y + TAB_GHOST_CAPTURE_INSET,
        width: Math.max(1, tabRect.width - TAB_GHOST_CAPTURE_INSET * 2),
        height: Math.max(1, tabRect.height - TAB_GHOST_CAPTURE_INSET * 2),
      },
    };
  };

  document.addEventListener("mousedown", onMouseDown);
  cleanups.push(() => document.removeEventListener("mousedown", onMouseDown));

  // ── Mousedown: initiate log-stream (Logs sidebar row) drags ──────────
  document.addEventListener("mousedown", onLogStreamMouseDown);
  cleanups.push(() => document.removeEventListener("mousedown", onLogStreamMouseDown));

  // ── Mousedown: initiate manager-tab (Application Management bar) drags ──
  document.addEventListener("mousedown", onManagerTabMouseDown);
  cleanups.push(() => document.removeEventListener("mousedown", onManagerTabMouseDown));

  // ── Suppress the trailing click after a log-stream drag ──────────────
  // Once a log-stream drag engages (threshold met -> _suppressLogStreamRowClick
  // true), the browser may still synthesize a `click` on the source row if press
  // and release stayed within the click slop. That click would re-open the stream
  // via the sidebar's @click handler. Capture phase, consumed once.
  const onLogStreamRowClickSuppress = (e: MouseEvent) => {
    if (!_suppressLogStreamRowClick) return;
    _suppressLogStreamRowClick = false;
    const hasLogRow = e
      .composedPath()
      .some((el) => el instanceof HTMLElement && el.hasAttribute("data-log-system"));
    if (hasLogRow) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  document.addEventListener("click", onLogStreamRowClickSuppress, true);
  cleanups.push(() => document.removeEventListener("click", onLogStreamRowClickSuppress, true));

  // ── Suppress the trailing click after a manager-tab drag ──────────────
  // The management window's tab bar @click activates the tab. A drag that
  // releases within the click slop would be seen as a click and activate the
  // tab as if it had never been dragged. Capture phase runs before the shadow
  // host's bubble-phase handler, so stopImmediatePropagation blocks it.
  const onManagerTabClickSuppress = (e: MouseEvent) => {
    if (!_suppressManagerTabClick) return;
    _suppressManagerTabClick = false;
    const isManagerTab = e
      .composedPath()
      .some((el) => el instanceof HTMLElement && el.hasAttribute("data-manager-tab"));
    if (isManagerTab) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  document.addEventListener("click", onManagerTabClickSuppress, true);
  cleanups.push(() => document.removeEventListener("click", onManagerTabClickSuppress, true));

  // ── Mousedown: initiate sidebar tab drags ────────────────────────────
  const onSidebarTabMouseDown = (e: MouseEvent) => {
    const sidebarTab = (e.target as HTMLElement).closest?.("[data-sidebar-tab-id]");
    if (!sidebarTab || !(sidebarTab instanceof HTMLElement)) return;

    // Don't initiate drag on close/pin button clicks
    if ((e.target as HTMLElement).closest?.(".sidebar-tab-close")) return;
    if ((e.target as HTMLElement).closest?.(".sidebar-tab-pin")) return;

    e.preventDefault();

    const tabId = sidebarTab.getAttribute("data-sidebar-tab-id") || "";
    const side = sidebarTab.getAttribute("data-sidebar-side") || "";
    const title =
      sidebarTab.getAttribute("data-tab-title") || sidebarTab.textContent?.trim() || "Tab";
    const winId = _resolveMyWinId();

    const sidebarEl = sidebarTab.closest?.("openp41ge-sidebar");
    if (!sidebarEl) return;

    const dragSource = new SidebarTabDragSource(
      sidebarTab,
      tabId,
      side,
      winId,
      title,
      // Invisible in-DOM ghost — the visible drag element is the main-process
      // bitmap ghost captured from this sidebar tab (captureRect below).
      () => {
        const ghost = document.createElement("div");
        ghost.style.cssText =
          "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px;z-index:-1;";
        return ghost;
      },
    );
    _currentSource = dragSource;
    _sidebarTabDragSide = side === "left" || side === "right" ? side : null;
    _orchestrator?.startDrag(dragSource, e.clientX, e.clientY);

    // Defer drag:start until the first POSITION event — store the sidebar
    // tab's dims/offset so the bitmap ghost lines up under the cursor exactly
    // like the source tab (frame the capture with TAB_GHOST_CAPTURE_INSET to
    // trim the 1px separator border).
    const rect = sidebarTab.getBoundingClientRect();
    const elScreenX = window.screenX + rect.left;
    const elScreenY = window.screenY + rect.top;
    _pendingSidebarDragStart = {
      label: title,
      screenX: e.screenX,
      screenY: e.screenY,
      tabId,
      side,
      winId,
      width: sidebarTab.offsetWidth,
      height: sidebarTab.offsetHeight,
      offsetX: e.screenX - elScreenX,
      offsetY: e.screenY - elScreenY,
      captureRect: {
        x: rect.x + TAB_GHOST_CAPTURE_INSET,
        y: rect.y + TAB_GHOST_CAPTURE_INSET,
        width: Math.max(1, rect.width - TAB_GHOST_CAPTURE_INSET * 2),
        height: Math.max(1, rect.height - TAB_GHOST_CAPTURE_INSET * 2),
      },
    };
  };

  document.addEventListener("mousedown", onSidebarTabMouseDown);
  cleanups.push(() => document.removeEventListener("mousedown", onSidebarTabMouseDown));

  // ── Click: activate tab (short clicks that don't become drags) ────────
  const onClick = (e: MouseEvent) => {
    const tabBtn = (e.target as HTMLElement).closest?.("[data-tab-id]");
    if (!tabBtn || !(tabBtn instanceof HTMLElement)) return;

    if ((e.target as HTMLElement).closest?.(".tab-close")) return;

    const tabId = tabBtn.getAttribute("data-tab-id") || "";
    const tabBarEl = tabBtn.closest?.("tab-bar");
    if (!tabBarEl) return;

    const winId = (tabBarEl as HTMLElement & { winId?: string }).winId || "";

    tabBtn.dispatchEvent(
      new CustomEvent("grid-activate", {
        bubbles: true,
        detail: { winId, tabId },
      }),
    );
  };

  document.addEventListener("click", onClick);
  cleanups.push(() => document.removeEventListener("click", onClick));

  // ── Mousemove: update grid ghost or show cross-window ghost ───────────
  let _focusedOnEntry = false;
  const onMouseMove = (e: MouseEvent) => {
    log.debug("mousemove", {
      x: e.clientX,
      y: e.clientY,
      localDragActive: _localDragActive,
      remoteDragActive: _remoteDragActive,
    });
    if (_localDragActive) {
      updateGridGhost(e.clientX, e.clientY);
      return;
    }
    if (_remoteDragActive) {
      if (!_focusedOnEntry) {
        _focusedOnEntry = true;
        window.focus();
      }
      _updateCrossWindowGhost(e.clientX, e.clientY);
    }
  };

  document.addEventListener("mousemove", onMouseMove);
  cleanups.push(() => document.removeEventListener("mousemove", onMouseMove));

  // ── Mouseup: handle cross-window drops ───────────────────────────────
  const onMouseUp = async (e: MouseEvent) => {
    _pendingDragStart = null;
    _pendingPayloadDragStart = null;
    _pendingSidebarDragStart = null;
    _pendingLogStreamDragStart = null;
    _pendingManagerTabDragStart = null;
    if (_localDragActive) {
      clearGridGhost();

      // Payload drags: complete a release over ANOTHER window from here (the
      // source keeps focus, so the target never sees the mouseup), or open a
      // new window for a cross-window file released outside every window.
      // Deferred (setTimeout(0)) so the orchestrator's synchronous mouseup
      // handler runs first and can mark the drop handled.
      if (_activePayloadDrag?.crossWindow) {
        const payloadData = _activePayloadDrag;
        const dropScreenX =
          typeof e.screenX === "number" && e.screenX !== 0 && isFinite(e.screenX)
            ? e.screenX
            : _lastScreenPos.screenX;
        const dropScreenY =
          typeof e.screenY === "number" && e.screenY !== 0 && isFinite(e.screenY)
            ? e.screenY
            : _lastScreenPos.screenY;
        setTimeout(() => {
          const handled = _dropHandled;
          _dropHandled = false;
          if (!handled) void _completePayloadRelease(payloadData, dropScreenX, dropScreenY);
        }, 0);
      }
      _localDragActive = false;
      _currentSource = null;
      _restorePayloadRowDraggable();
      return;
    }
    if (_remoteDragActive) {
      await _handleCrossWindowDrop(e.clientX, e.clientY, e.screenX, e.screenY);
    }
  };

  document.addEventListener("mouseup", onMouseUp);
  cleanups.push(() => document.removeEventListener("mouseup", onMouseUp));

  // ── Orchestrator position events → move main-process ghost ───────────
  // Also broadcasts drag-active to other windows on the FIRST position event
  // (which fires after the drag threshold is met), not on mousedown.
  let _dragActivated = false;
  document.addEventListener(DRAG_EVENTS.POSITION, (e: Event) => {
    const detail = (e as CustomEvent).detail as { screenX: number; screenY: number };
    if (detail) {
      _lastScreenPos = { screenX: detail.screenX, screenY: detail.screenY };
      window.openp41ge.drag.move(detail.screenX, detail.screenY);
      if (!_dragActivated) {
        _dragActivated = true;
        _localDragActive = true;
        log.info("drag-start", {
          sourceType: _currentSource?.type ?? "unknown",
          label:
            _pendingDragStart?.label ??
            _pendingSidebarDragStart?.label ??
            _pendingLogStreamDragStart?.label,
        });
        // Payload drags: swallow the trailing click on the source element.
        _suppressPayloadRowClick = !!_pendingPayloadDragStart;
        // And for log-stream rows: releasing back over the Logs sidebar must not
        // re-open the stream as if it were a plain click.
        _suppressLogStreamRowClick = !!_pendingLogStreamDragStart;
        // And for manager tabs: releasing back over the tab bar must not
        // activate the source tab as if it were a plain click.
        _suppressManagerTabClick = !!_pendingManagerTabDragStart;

        // First POSITION event fires after the drag threshold is met — now
        // it's safe to show the main-process BrowserWindow ghost and broadcast
        // drag-active to other windows.
        if (_pendingDragStart) {
          const p = _pendingDragStart;
          // Hide any tab-bar drop indicator before the async capturePage run, so
          // the captured frame is a clean tab (no blue insert line). The
          // orchestrator re-shows the indicator on the next mousemove's onHover.
          document.querySelectorAll(".tab-drop-indicator").forEach((el) => {
            (el as HTMLElement).style.display = "none";
          });
          // Tab ghost: like files, the main process captures a pixel-accurate
          // bitmap of the actual tab button and swaps it into the DragGhostManager
          // window in-place, so the drag element is an exact copy of the tab — the
          // pill is only a brief fallback while capture resolves.
          window.openp41ge.drag.start(
            p.label,
            p.screenX,
            p.screenY,
            undefined,
            p.tabId,
            p.winId,
            p.worksetId,
            p.tabWidth,
            p.tabHeight,
            p.offsetX,
            p.offsetY,
            "tab",
            undefined,
            p.captureRect,
            TAB_GHOST_CAPTURE_INSET,
          );
          _pendingDragStart = null;
        } else if (_pendingSidebarDragStart) {
          const p = _pendingSidebarDragStart;
          _pendingSidebarDragStart = null;
          // Suppress the sidebar-wide ghost overlay + drop indicator during the
          // capture: SidebarDropTarget.onHover re-creates them synchronously later
          // in the SAME mousemove, so a one-shot removal would be re-added before
          // capturePage samples — the sidebar wash covers the whole tab interior
          // and the capture inset can't clip it (unlike the grid's edge line).
          setSidebarDropFeedbackSuppressed(true);
          document
            .querySelectorAll(".sidebar-drop-zone-box, .sidebar-drop-indicator")
            .forEach((el) => el.remove());
          document.querySelectorAll(".tab-drop-indicator").forEach((el) => {
            (el as HTMLElement).style.display = "none";
          });
          // Sidebar tab ghost: same pixel-accurate bitmap treatment as grid tabs
          // — capture the actual sidebar tab and render it in the DragGhostManager
          // window at the tab's exact size, trimmed by the capture inset.
          window.openp41ge.drag.start(
            p.label,
            p.screenX,
            p.screenY,
            undefined,
            p.tabId,
            p.winId,
            p.side,
            p.width,
            p.height,
            p.offsetX,
            p.offsetY,
            "sidebar-tab",
            undefined,
            p.captureRect,
            TAB_GHOST_CAPTURE_INSET,
          );
          // Re-enable sidebar drop feedback shortly after the capture samples.
          window.setTimeout(() => setSidebarDropFeedbackSuppressed(false), 60);
        } else if (_pendingPayloadDragStart) {
          const p = _pendingPayloadDragStart;
          // Payload ghost: bitmap of the source element, like file rows. The
          // typed payload rides `payloadData` so a TARGET window's cross-window
          // drop can resolve it without seeing the source element.
          window.openp41ge.drag.start(
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
            "payload",
            undefined,
            p.captureRect,
            undefined,
            undefined,
            p.data,
          );
          _pendingPayloadDragStart = null;
        } else if (_pendingLogStreamDragStart) {
          const p = _pendingLogStreamDragStart;
          // Log-stream ghost: identical bitmap treatment to files/git entries
          // — the main process captures the source sidebar row and renders it
          // in the DragGhostManager window at the row's exact dimensions. The
          // open-tab payload (appType/tabConfig) rides `openTabData` so a
          // TARGET window's cross-window drop can open a stream-scoped
          // log-viewer pane without seeing the source row.
          window.openp41ge.drag.start(
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
            TAB_GHOST_CAPTURE_INSET,
            { appType: "log-viewer", tabConfig: { system: p.system } },
          );
          _pendingLogStreamDragStart = null;
        } else if (_pendingManagerTabDragStart) {
          const p = _pendingManagerTabDragStart;
          // Manager-tab ghost: identical pixel-accurate bitmap treatment to grid
          // tabs — the main process captures the source tab (captureRect) and
          // renders it in the DragGhostManager window at the tab's exact size.
          // Hide any drop indicator before the async capture so the frame is a
          // clean tab (no blue insert line); the orchestrator re-shows it on the
          // next mousemove's onHover.
          document
            .querySelectorAll(".wm-tab-drop-indicator")
            .forEach((el) => ((el as HTMLElement).style.display = "none"));
          window.openp41ge.drag.start(
            p.label,
            p.screenX,
            p.screenY,
            undefined,
            p.tabId,
            p.winId,
            undefined,
            p.width,
            p.height,
            p.offsetX,
            p.offsetY,
            "manager-tab",
            undefined,
            p.captureRect,
            TAB_GHOST_CAPTURE_INSET,
          );
          _pendingManagerTabDragStart = null;
        }
        window.openp41ge.drag.activate();
      }
    }
  });

  // ── Orchestrator end event → hide main-process ghost ─────────────────
  // Full local-drag teardown: hide the main-process ghost, clear the DOM grid
  // ghost, drop all drag flags and restore the source row's native draggable.
  // Used by the END event AND the interruption safety-net (any unexpected
  // mousedown/right-click during a drag) so no interrupted drag can ever leave
  // a floating ghost behind.
  const teardownLocalDrag = () => {
    _dragActivated = false;
    _focusedOnEntry = false;
    _lastScreenPos = { screenX: 0, screenY: 0 };
    window.openp41ge.drag.end();
    clearGridGhost();
    _clearSidebarDropTargetCache();
    setSidebarDropFeedbackSuppressed(false);
    _localDragActive = false;
    _dropHandled = false;
    _pendingSidebarDragStart = null;
    _pendingLogStreamDragStart = null;
    _pendingManagerTabDragStart = null;
    _suppressLogStreamRowClick = false;
    _pendingPayloadDragStart = null;
    _currentSource = null;
    _restorePayloadRowDraggable();
  };

  const onDragEnd = () => {
    teardownLocalDrag();
  };

  document.addEventListener(DRAG_EVENTS.END, onDragEnd);
  cleanups.push(() => document.removeEventListener(DRAG_EVENTS.END, onDragEnd));

  // ── Interruption safety-net ───────────────────────────────────────────
  // Any new mousedown while a local drag is active is an interruption
  // (right/middle click, a second gesture, a tab click, …). Fully tear the
  // drag down (including hiding the main-process ghost) BEFORE any other
  // handler can react — so no interrupted drag ever leaves a floating ghost.
  // Capture phase so it runs before the bubble-phase drag/click handlers.
  const onInterruptMousedown = () => {
    if (_localDragActive) {
      _orchestrator?.cancelDrag();
      teardownLocalDrag();
      // Interrupted (no pending drop resolve) — clear the remembered side so it
      // can't leak into a subsequent drag.
      _sidebarTabDragSide = null;
      // Same for the manager-tab drag flag + click suppression: an interrupted
      // gesture has no final resolve and no follow-up click to suppress.
      _managerTabDragActive = false;
      _suppressManagerTabClick = false;
      _managerBarDropTarget?.onLeave();
    }
  };
  document.addEventListener("mousedown", onInterruptMousedown, true);
  cleanups.push(() => document.removeEventListener("mousedown", onInterruptMousedown, true));

  // ── Payload drag state reset (capture phase) ─────────────────────────
  // `_activePayloadDrag` outlives END so the final drop resolve can see it; a
  // new gesture clears it before any source handler runs (startPayloadDrag
  // sets it again for a new payload drag), so it never leaks into a tab drag.
  const onPayloadFlagReset = () => {
    _activePayloadDrag = null;
  };
  document.addEventListener("mousedown", onPayloadFlagReset, true);
  cleanups.push(() => document.removeEventListener("mousedown", onPayloadFlagReset, true));

  // ── Suppress the trailing click after a payload drag ─────────────────
  const onPayloadRowClickSuppress = (e: MouseEvent) => {
    if (!_suppressPayloadRowClick) return;
    _suppressPayloadRowClick = false;
    const onSource = e
      .composedPath()
      .some((el) => el instanceof HTMLElement && el.hasAttribute("data-drag-source-id"));
    if (onSource) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  document.addEventListener("click", onPayloadRowClickSuppress, true);
  cleanups.push(() => document.removeEventListener("click", onPayloadRowClickSuppress, true));

  // ── Manager-tab drag flag reset (capture phase) ────────────────────────
  // After a manager-tab drag ends, _managerTabDragActive stays set so the
  // orchestrator's FINAL mouseup resolve can still see it was a manager-tab
  // drag before the drop target is resolved. A new gesture must clear it unless
  // it is itself a manager-tab drag — otherwise the stale flag would make the
  // next (non-manager) drag's final resolve read as a manager-tab drag.
  const onManagerTabFlagReset = (e: MouseEvent) => {
    if (!_managerTabDragActive) return;
    const isManagerTab = e
      .composedPath()
      .some((el) => el instanceof HTMLElement && el.hasAttribute("data-manager-tab"));
    if (!isManagerTab) _managerTabDragActive = false;
  };
  document.addEventListener("mousedown", onManagerTabFlagReset, true);
  cleanups.push(() => document.removeEventListener("mousedown", onManagerTabFlagReset, true));

  // ── Orchestrator detach event → check cross-window, then create window ──
  const onDetach = async (e: Event) => {
    const detail = (e as CustomEvent).detail as {
      winId: string;
      tabId: string;
      screenX?: number;
      screenY?: number;
      sourceWorksetId?: string;
      bounds: { x: number; y: number; width: number; height: number };
    };
    if (!detail) return;

    const screenX = detail.screenX ?? detail.bounds.x + 50;
    const screenY = detail.screenY ?? detail.bounds.y + 55;

    // A manager grid tab is not a workspace tab: dropped outside its window it
    // is not detached or moved to another window (cancelled).
    if (detail.winId === MANAGER_GRID_WIN_ID) return;

    // ── Manager-tab detach: only manager windows are valid destinations. ──
    if (_managerTabDragActive) {
      _managerTabDragActive = false;
      const managerDragData = JSON.stringify({
        tabId: detail.tabId,
        winId: detail.winId,
        type: "manager-tab",
      });
      try {
        const check = await window.openp41ge.drag
          .check(screenX, screenY, managerDragData)
          .catch(() => null);
        if (check?.target?.type === "manager-tab-bar") {
          const target = check.target as { dropIndex?: number };
          const targetWinId = (check as { windowId?: string }).windowId ?? detail.winId;
          window.openp41ge.windowManager.moveTab(
            detail.winId,
            targetWinId,
            detail.tabId,
            Math.max(0, target.dropIndex ?? 0),
          );
          return;
        }
        // `check === null` means the cursor is over NO openp41ge window — a
        // drag-out onto the desktop (or another app). Open a new management
        // window with the tab. If `check` resolved but found no manager bar
        // (e.g. cursor over a workspace window, or the non-bar part of another
        // manager window), the drop is a cancel — manager tabs can only land on
        // other management tab bars.
        if (!check) {
          window.openp41ge.windowManager.openWithTab(detail.winId, detail.tabId, screenX, screenY);
        }
      } catch (err) {
        // On any error, conservatively treat the release as a drag-out.
        log.debug("drag release probe failed; treating as drag-out:", err);
        window.openp41ge.windowManager.openWithTab(detail.winId, detail.tabId, screenX, screenY);
      }
      return;
    }

    const dragData = JSON.stringify({
      tabId: detail.tabId,
      winId: detail.winId,
      worksetId: detail.sourceWorksetId ?? detail.winId,
      type: "tab",
    });

    try {
      const resolved = await _tryCrossWindowDrop(
        detail.winId,
        detail.tabId,
        screenX,
        screenY,
        dragData,
      );
      if (resolved) return;
    } catch (err) {
      log.debug("drag target resolve failed; falling through:", err);
    }

    window.openp41ge.workspace.detachTab(
      detail.winId,
      detail.tabId,
      detail.bounds,
      screenX,
      screenY,
    );
  };

  document.addEventListener(DRAG_EVENTS.DETACH, onDetach);
  cleanups.push(() => document.removeEventListener(DRAG_EVENTS.DETACH, onDetach));

  // ── Orchestrator cross event → forward cursor to other windows ──────────
  // The source window always receives mousemove events (it has focus). When
  // the cursor leaves the grid, the orchestrator fires CROSS with screen
  // coordinates. We forward them so other windows can update their ghost.
  const onCross = (e: Event) => {
    const detail = (e as CustomEvent).detail as { screenX: number; screenY: number } | undefined;
    if (detail && _localDragActive) {
      window.openp41ge.drag.ghostForward(detail.screenX, detail.screenY);
    }
  };
  document.addEventListener(DRAG_EVENTS.CROSS, onCross);
  cleanups.push(() => document.removeEventListener(DRAG_EVENTS.CROSS, onCross));

  // ── Sidebar tab drop → dispatch workspace operation ────────────────
  const onSidebarTabDrop = (e: Event) => {
    const detail = (e as CustomEvent).detail as {
      tabId: string;
      sourceSide: string;
      targetSide: string;
      dropIndex: number;
      winId: string;
    };
    if (!detail) return;

    window.openp41ge.workspace.dispatch(
      "moveSystemTabToSidebar",
      detail.winId,
      detail.tabId,
      detail.targetSide,
      detail.dropIndex,
    );
  };
  document.addEventListener(SIDEBAR_DROP_EVENT, onSidebarTabDrop);
  cleanups.push(() => document.removeEventListener(SIDEBAR_DROP_EVENT, onSidebarTabDrop));

  // ── Listen for grid-open-tab to mark a file drop handled ────────────
  // When a file payload is dropped on a valid grid target (same window), the
  // orchestrator fires grid-open-tab. Mark it handled so the deferred
  // payload release in onMouseUp doesn't also open a new window.
  const onGridOpenTab = (e: Event) => {
    const detail = (e as CustomEvent).detail as { tabConfig?: { filePath?: string } };
    if (detail?.tabConfig?.filePath) {
      _dropHandled = true;
    }
  };
  document.addEventListener("grid-open-tab", onGridOpenTab);
  cleanups.push(() => document.removeEventListener("grid-open-tab", onGridOpenTab));

  // ── Incoming ghost position from main process poll ───────────────────
  // The main process polls screen.getCursorScreenPoint() at ~20fps during
  // an active drag and broadcasts to ALL windows — including the SOURCE
  // window. A source window is already dragging locally (main-process bitmap
  // ghost + local updateGridGhost preview), so it must ignore these poll
  // updates; otherwise it would set _remoteDragActive and paint a grid ghost
  // via _updateCrossWindowGhost based purely on grid-relative coords (which
  // even extend under an overlaid sidebar).
  type GhostShowData = { screenX: number; screenY: number; label?: string; clear?: boolean };
  window.openp41ge.drag.onGhostShow((data: GhostShowData) => {
    if (_localDragActive) return;
    const screenX = data.screenX;
    const screenY = data.screenY;
    if (typeof screenX !== "number" || typeof screenY !== "number") return;

    _remoteDragActive = true;

    // A `clear` payload means the cursor is over another window (usually the
    // source) — this window must not paint a cross-window drop indicator. Hide
    // any stale indicator left from a previous position.
    if (data.clear) {
      _hideCrossWindowGhost();
      return;
    }

    // Convert screen → viewport coordinates and show ghost
    const cx = screenX - window.screenX;
    const cy = screenY - window.screenY;
    log.debug("ipc-ghost", { screenX, screenY, clientX: cx, clientY: cy });
    _updateCrossWindowGhost(cx, cy);
  });

  // ── Remote drag state tracking ───────────────────────────────────────
  // Main process broadcasts drag-state (active/inactive) to all windows.
  window.openp41ge.drag.onDragState((state) => {
    _remoteDragActive = state.active;
    _remoteDragType = state.active ? state.type : null;
    if (!state.active) {
      _hideCrossWindowGhost();
    }
  });

  // ── Incoming end-session event (source window cleanup) ────────────────
  window.openp41ge.drag.onEndSession(() => {
    // Mark the drop handled — this tells the deferred payload release in
    // onMouseUp NOT to run (the target window handled the drop).
    _dropHandled = true;
    _dragActivated = false;
    _focusedOnEntry = false;
    _localDragActive = false;
    _pendingLogStreamDragStart = null;
    _suppressLogStreamRowClick = false;
    _orchestrator?.cancelDrag();
    window.openp41ge.drag.end();
    clearGridGhost();
    _pendingPayloadDragStart = null;
    _currentSource = null;
    _restorePayloadRowDraggable();
  });

  return () => {
    _ghostManager.dispose();
    _clearSidebarDropTargetCache();
    for (const fn of cleanups) fn();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-window drop handling
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle a cross-window drop: mouseup in this window with an active remote
 * drag. Queries the main process for drag data, resolves local target,
 * dispatches the workspace operation, and ends the remote session.
 */
async function _handleCrossWindowDrop(
  clientX: number,
  clientY: number,
  _screenX: number,
  _screenY: number,
): Promise<void> {
  try {
    const active = await window.openp41ge.drag.getActive();
    if (!active) {
      log.warn("cross-window-drop-ignored", { reason: "no-active-drag", x: clientX, y: clientY });
      return;
    }

    // ── Payload drop: in-place extension target, else the grid's consumer. ──
    if (active.dragData.type === "payload") {
      const payloadData = active.dragData as unknown as PayloadDragData;
      try {
        if (!payloadData.crossWindow) return;
        _activePayloadDrag = payloadData;
        const payloadTarget = openp41geTargetResolver(clientX, clientY);
        if (payloadTarget) {
          await payloadTarget.onDrop(new PayloadDragSource(payloadData), clientX, clientY);
        }
      } finally {
        _activePayloadDrag = null;
        window.openp41ge.drag.endSession();
      }
      return;
    }

    const target = openp41geTargetResolver(clientX, clientY);
    if (!target) {
      log.warn("cross-window-drop-no-target", { x: clientX, y: clientY });
      return;
    }

    const data = active.dragData;
    const sourceWinId = active.sourceWinId;
    log.debug("drop", {
      targetType: target.type,
      x: clientX,
      y: clientY,
      sourceWinId,
      tabId: (data as { tabId?: string }).tabId,
      dragType: data.type,
    });

    // ── Manager-tab drop: only another management window's tab bar is valid. ──
    if (data.type === "manager-tab") {
      const tabId = (data as { tabId?: string }).tabId;
      if (tabId && _isOverManagerBar(clientX, clientY) && _managerBarEl && _managerBarDropTarget) {
        const dropIndex = managerDropIndex(_managerBarEl, clientX, clientY);
        window.openp41ge.windowManager.moveTab(sourceWinId, _resolveMyWinId(), tabId, dropIndex);
      }
      window.openp41ge.drag.endSession();
      return;
    }

    // Open-tab drops (log streams) open their pane in the target
    // window/grid; a boundary drop splits a new column.
    if (data.type === "open-tab") {
      const tabConfig = (data as { tabConfig?: Record<string, unknown> }).tabConfig ?? {};
      const appType = (data as { appType?: string }).appType;

      // ── Log-system drop: open a system-scoped log-viewer pane ────────────
      if (appType === "log-viewer") {
        const system = (tabConfig as { system?: string }).system;
        if (!system) {
          window.openp41ge.drag.endSession();
          return;
        }
        const gridEl = (target as IDropTarget & { element: HTMLElement }).element.closest(
          "tab-grid",
        ) as HTMLElement | null;
        if (gridEl) {
          const gridRect = gridEl.getBoundingClientRect();
          const relX = clientX - gridRect.left;
          const cols = (gridEl as HTMLElement & { cols?: number }).cols || 1;
          const pos = computeDropTarget(gridEl, relX, gridRect.width, cols);
          const targetCol = pos.col;
          const winId = (gridEl as HTMLElement & { winId?: string }).winId || _resolveMyWinId();
          const tabName = system;

          if (pos.isBoundary) {
            const splitLeft =
              pos.boundaryIndex === 0
                ? true
                : pos.boundaryIndex >= cols
                  ? false
                  : targetCol >= pos.boundaryIndex;
            const splitCol =
              pos.boundaryIndex === 0 ? 0 : pos.boundaryIndex >= cols ? cols - 1 : targetCol;
            window.openp41ge.workspace.dispatch(
              "splitFileOpen",
              winId,
              "log-viewer",
              tabName,
              undefined,
              splitCol,
              splitLeft,
              { system },
            );
          } else {
            window.openp41ge.workspace.dispatch(
              "actionOpenFile",
              winId,
              "log-viewer",
              tabName,
              undefined,
              targetCol,
              true,
              { system },
            );
          }
        }
        window.openp41ge.drag.endSession();
        return;
      }

      // Any other app type has no cross-window open.
      window.openp41ge.drag.endSession();
      return;
    }

    // Any other drag type (e.g. sidebar-tab) must not trigger a grid tab
    // move/split cross-window — sidebar tabs are window-local. End the remote
    // session and ignore, matching the pre-bitmap behaviour where a sidebar
    // drag had no session to act on.
    if (data.type !== "tab") {
      window.openp41ge.drag.endSession();
      return;
    }

    if (target.type === "tab-bar") {
      const tabBarTarget = target as IDropTarget & { winId: string; element: HTMLElement };
      const targetWinId = tabBarTarget.winId || _resolveMyWinId();

      // Check if cursor is near a grid boundary — even when over the tab bar,
      // the drop should create a new column if at the grid edge.
      const gridEl = tabBarTarget.element.closest("tab-grid") as HTMLElement | null;
      if (gridEl) {
        const gridRect = gridEl.getBoundingClientRect();
        const gridRelX = clientX - gridRect.left;
        const cols = (gridEl as HTMLElement & { cols?: number }).cols || 1;
        const gridPos = computeDropTarget(gridEl, gridRelX, gridRect.width, cols);

        if (gridPos.isBoundary) {
          const splitLeft =
            gridPos.boundaryIndex === 0
              ? true
              : gridPos.boundaryIndex >= cols
                ? false
                : gridPos.col >= gridPos.boundaryIndex;
          const splitCol =
            gridPos.boundaryIndex === 0
              ? 0
              : gridPos.boundaryIndex >= cols
                ? cols - 1
                : gridPos.col;
          _dispatchCrossWindowSplit(sourceWinId, data.tabId, targetWinId, splitCol, splitLeft);
          window.openp41ge.drag.endSession();
          return;
        }
      }

      const barEl = tabBarTarget.element;
      const barRect = barEl.getBoundingClientRect();
      const barRelX = clientX - barRect.left;
      const tabButtons = barEl.querySelectorAll("[data-tab-id]");
      let dropIndex = tabButtons.length;
      for (let i = 0; i < tabButtons.length; i++) {
        const btnRect = tabButtons[i].getBoundingClientRect();
        const btnMid = btnRect.left - barRect.left + btnRect.width / 2;
        if (barRelX < btnMid) {
          dropIndex = i;
          break;
        }
      }

      const colStr = tabBarTarget.element.closest(".grid-cell")?.getAttribute("data-cell-col");
      const dropCol = colStr ? parseInt(colStr, 10) : 0;

      _dispatchCrossWindowMove(sourceWinId, data.tabId, targetWinId, dropCol, dropIndex);
      window.openp41ge.drag.endSession();
      return;
    }

    if (target.type === "grid") {
      const gridTarget = target as IDropTarget & { winId: string };
      const targetWinId = gridTarget.winId || _resolveMyWinId();
      const gridEl = target.element;
      const gridRect = gridEl.getBoundingClientRect();
      const relX = clientX - gridRect.left;
      const cols = (gridEl as HTMLElement & { cols?: number }).cols || 1;

      const pos = computeDropTarget(gridEl, relX, gridRect.width, cols);
      const mouseCol = pos.col;
      log.debug("drop-grid", {
        col: mouseCol,
        isBoundary: pos.isBoundary,
        boundaryIndex: pos.boundaryIndex ?? -1,
        cols,
      });

      if (pos.isBoundary) {
        const splitLeft =
          pos.boundaryIndex === 0
            ? true
            : pos.boundaryIndex >= cols
              ? false
              : mouseCol >= pos.boundaryIndex;
        const splitCol =
          pos.boundaryIndex === 0 ? 0 : pos.boundaryIndex >= cols ? cols - 1 : mouseCol;
        _dispatchCrossWindowSplit(sourceWinId, data.tabId, targetWinId, splitCol, splitLeft);
      } else {
        _dispatchCrossWindowMove(sourceWinId, data.tabId, targetWinId, mouseCol, -1);
      }

      window.openp41ge.drag.endSession();
      return;
    }
  } catch (err) {
    // Cross-window drop failed
    log.warn("cross-window-drop-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Try cross-window drop from a DETACH event (mouseup in source window).
 * Returns true if handled, false otherwise.
 */
async function _tryCrossWindowDrop(
  sourceWinId: string,
  tabId: string,
  screenX: number,
  screenY: number,
  dragData: string,
): Promise<boolean> {
  try {
    const result = await window.openp41ge.drag.check(screenX, screenY, dragData);
    if (!result || !result.target) return false;

    const target = result.target as Record<string, unknown>;
    const type = target.type as string;
    const targetWinId = (target.winId || result.windowId) as string;

    if (type === "tab-bar") {
      const col = typeof target.col === "number" ? target.col : 0;
      const dropIndex = typeof target.dropIndex === "number" ? target.dropIndex : -1;
      _dispatchCrossWindowMove(sourceWinId, tabId, targetWinId, col, dropIndex);
      return true;
    }

    if (type === "grid-move") {
      const col = typeof target.col === "number" ? target.col : 0;
      _dispatchCrossWindowMove(sourceWinId, tabId, targetWinId, col, -1);
      return true;
    }

    if (type === "grid-split") {
      const splitCol = typeof target.splitCol === "number" ? target.splitCol : 0;
      const splitLeft = typeof target.splitLeft === "boolean" ? target.splitLeft : true;
      _dispatchCrossWindowSplit(sourceWinId, tabId, targetWinId, splitCol, splitLeft);
      return true;
    }

    return false;
  } catch (err) {
    log.debug("drag hit-test failed:", err);
    return false;
  }
}

// ── Cross-window dispatch helpers ────────────────────────────────────────

function _dispatchCrossWindowMove(
  sourceWinId: string,
  tabId: string,
  targetWinId: string,
  targetCol: number,
  dropIndex: number,
): void {
  // dispatch uses (fn, ...args) rest params — pass individual arguments, NOT an array
  window.openp41ge.workspace.dispatch(
    "moveTabBetweenCells",
    sourceWinId,
    tabId,
    targetWinId,
    0,
    targetCol,
    dropIndex,
  );
}

function _dispatchCrossWindowSplit(
  sourceWinId: string,
  tabId: string,
  targetWinId: string,
  splitCol: number,
  splitLeft: boolean,
): void {
  window.openp41ge.workspace.dispatch(
    "splitCrossWindowTab",
    sourceWinId,
    tabId,
    targetWinId,
    splitCol,
    splitLeft,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Test hooks (exposed for AI / manual testing via DevTools)
// ═══════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>)["__openp41geTestHooks"] = {
    setRemoteDragActive: (active: boolean) => {
      _remoteDragActive = active;
      if (!active) _hideCrossWindowGhost();
    },
    setRemoteDragType: (type: string | null) => {
      _remoteDragType = type;
    },
    getRemoteDragType: () => _remoteDragType,
    isRemoteDragActive: () => _remoteDragActive,
    isLocalDragActive: () => _localDragActive,
    getGridGhostOverlay: () =>
      _crossGhostGrid ? _crossGhostGrid.querySelector(".openp41ge-ghost-overlay") : null,
    getLocalGhostOverlay: () =>
      _ghostShownGrid ? _ghostShownGrid.querySelector(".openp41ge-ghost-overlay") : null,
    getOrchestrator: () => _orchestrator,
    setGridCols: (gridEl: HTMLElement, cols: number) => {
      (gridEl as HTMLElement & { cols: number }).cols = cols;
    },
    callUpdateCrossWindowGhost: (cx: number, cy: number) => _updateCrossWindowGhost(cx, cy),
    callHandleCrossWindowDrop: async (cx: number, cy: number, sx: number, sy: number) => {
      await _handleCrossWindowDrop(cx, cy, sx, sy);
    },
    forceCrossWindowGhostCleanup: () => _hideCrossWindowGhost(),
    gridEl: () => document.querySelector("tab-grid") as HTMLElement | null,
    getLogStreamPendingStart: () => _pendingLogStreamDragStart,
    getCurrentDragSourceType: () => _currentSource?.type ?? null,
    getCurrentDragData: () => _currentSource?.getDragData() ?? null,
    resetTestDragState: () => {
      _orchestrator?.cancelDrag();
      _currentSource = null;
      _pendingDragStart = null;
      _pendingSidebarDragStart = null;
      _pendingLogStreamDragStart = null;
      _pendingManagerTabDragStart = null;
      _suppressLogStreamRowClick = false;
      _suppressManagerTabClick = false;
      _localDragActive = false;
      _sidebarTabDragSide = null;
      _managerTabDragActive = false;
      _managerBarDropTarget?.onLeave();
    },
    getManagerTabPendingStart: () => _pendingManagerTabDragStart,
    getManagerTabBarDropTarget: () => _managerBarDropTarget,
    isManagerTabDragActive: () => _managerTabDragActive,
    registerManagerTabBarForTest: (barEl: HTMLElement) =>
      registerManagerTabBar(barEl, _resolveMyWinId()),
    callUpdateManagerBarGhost: (cx: number, cy: number) => _updateManagerBarGhost(cx, cy),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-window ghost overlay
// ═══════════════════════════════════════════════════════════════════════════

/** Track the grid element that currently has a cross-window ghost overlay. */
let _crossGhostGrid: HTMLElement | null = null;

/**
 * Cached reference to the <tab-grid> element in this window. Found once on
 * first call and reused — avoids elementFromPoint + closest, which can fail
 * silently if the DOM underneath the cursor changes or shadow boundaries
 * prevent closest() from reaching the grid.
 */
let _crossWindowGrid: HTMLElement | null = null;
let _crossWindowGridCols = 1;

/**
 * Show a grid ghost overlay in this window for a cross-window drag preview.
 * Called from mousemove when _remoteDragActive is true.
 *
 * Uses a cached grid reference (found once, not per-frame) to avoid
 * elementFromPoint + closest issues with shadow DOM or pointer-events.
 * Cursor position relative to the grid's bounding rect drives the
 * split/cell-center classification via computeDropTarget.
 */
function _updateCrossWindowGhost(clientX: number, clientY: number): void {
  // Sidebar-tab drags are sidebar-only, and workspace-skeleton drags open a
  // workspace window on drop — neither may light up a central grid as a drop
  // zone, so skip the grid ghost preview entirely. Manager-tab drags may only
  // land on another management window's tab bar, never on a central grid.
  if (_remoteDragType === "sidebar-tab" || _remoteDragType === "workspace") {
    _hideCrossWindowGhost();
    return;
  }

  // Manager-tab drag: show the blue insertion line on this window's management
  // tab bar when the cursor is over it (this is the only valid target). A
  // workspace window has no manager bar, so the indicator never appears there.
  if (_remoteDragType === "manager-tab") {
    _updateManagerBarGhost(clientX, clientY);
    return;
  }

  // Find and cache the grid ONCE
  if (!_crossWindowGrid || !document.contains(_crossWindowGrid)) {
    _crossWindowGrid = document.querySelector("tab-grid") as HTMLElement | null;
    if (!_crossWindowGrid) return;
    _crossWindowGridCols = (_crossWindowGrid as HTMLElement & { cols?: number }).cols ?? 1;
  }

  const rect = _crossWindowGrid.getBoundingClientRect();

  // Hide ghost if cursor leaves the grid bounds
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    _hideCrossWindowGhost();
    return;
  }

  const relX = clientX - rect.left;
  const pos = computeDropTarget(_crossWindowGrid, relX, rect.width, _crossWindowGridCols);
  const mouseCol = pos.col;
  log.debug("compute-drop-target", {
    x: clientX,
    y: clientY,
    cols: _crossWindowGridCols,
    col: mouseCol,
    isBoundary: pos.isBoundary,
    boundaryIndex: pos.boundaryIndex ?? -1,
    relX,
  });

  if (pos.isBoundary) {
    const splitLeft =
      pos.boundaryIndex === 0
        ? true
        : pos.boundaryIndex >= _crossWindowGridCols
          ? false
          : mouseCol >= pos.boundaryIndex;
    const splitCol =
      pos.boundaryIndex === 0
        ? 0
        : pos.boundaryIndex >= _crossWindowGridCols
          ? _crossWindowGridCols - 1
          : mouseCol;
    _ghostManager.showGhost(_crossWindowGrid, {
      cols: _crossWindowGridCols,
      boundaryIndex: pos.boundaryIndex,
      splitCol,
      splitLeft,
      activeCol: mouseCol,
    });
  } else {
    _ghostManager.showGhost(_crossWindowGrid, {
      cols: _crossWindowGridCols,
      activeCol: mouseCol,
    });
  }
  log.debug("ghost-update", {
    x: clientX,
    y: clientY,
    cols: _crossWindowGridCols,
    isBoundary: pos.isBoundary,
    mouseCol,
  });
  _crossGhostGrid = _crossWindowGrid;
}

function _hideCrossWindowGhost(): void {
  if (_crossGhostGrid) {
    _ghostManager.hideGhost(_crossGhostGrid);
    _crossGhostGrid = null;
  }
  _crossWindowGrid = null;
  _managerBarDropTarget?.onLeave();
}

/** Show/hide the management tab-bar insertion line for a cross-window drag. */
function _updateManagerBarGhost(clientX: number, clientY: number): void {
  if (_isOverManagerBar(clientX, clientY) && _managerBarDropTarget) {
    _managerBarDropTarget.showIndicator(clientX, clientY);
  } else {
    _managerBarDropTarget?.onLeave();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Target resolver
// ═══════════════════════════════════════════════════════════════════════════

// Cache sidebar drop targets by side to avoid creating new instances on every mousemove
let _sidebarDropTargetLeft: SidebarDropTarget | null = null;
let _sidebarDropTargetRight: SidebarDropTarget | null = null;

// Cache the closed-sidebar edge targets (one per side) for the same reason.
let _closedSidebarEdgeTargetLeft: ClosedSidebarDropTarget | null = null;
let _closedSidebarEdgeTargetRight: ClosedSidebarDropTarget | null = null;

/**
 * How close (in viewport px) the cursor must be to the app-window edge on the
 * closed side before the closed-sidebar edge drop indicator appears.
 */
const CLOSED_SIDEBAR_EDGE_THRESHOLD = 160;

function _isSidebarOpen(side: "left" | "right"): boolean {
  const host = document.querySelector(`openp41ge-sidebar[side="${side}"]`);
  return (
    host instanceof HTMLElement &&
    host.offsetHeight > 0 &&
    !host.classList.contains("sidebar-element-hidden")
  );
}

function _getClosedSidebarDropTarget(side: "left" | "right"): ClosedSidebarDropTarget | null {
  if (side === "left" && _closedSidebarEdgeTargetLeft) return _closedSidebarEdgeTargetLeft;
  if (side === "right" && _closedSidebarEdgeTargetRight) return _closedSidebarEdgeTargetRight;

  const hostEl = document.querySelector(`openp41ge-sidebar[side="${side}"]`);
  if (!(hostEl instanceof HTMLElement)) return null;
  const barEl = document.querySelector(`[data-sidebar-tab-bar="${side}"]`);
  const target = new ClosedSidebarDropTarget(
    hostEl,
    _resolveMyWinId(),
    side,
    barEl instanceof HTMLElement ? barEl : null,
  );
  if (side === "left") _closedSidebarEdgeTargetLeft = target;
  else _closedSidebarEdgeTargetRight = target;
  return target;
}

/**
 * When the cursor is within CLOSED_SIDEBAR_EDGE_THRESHOLD of the app-window
 * edge on the CLOSED other side, resolve to the closed-sidebar edge target — a
 * vertical-line drop indicator at the window edge; dropping moves the tab to
 * that sidebar (auto-opening it). Returns null when the cursor is elsewhere or
 * the other sidebar is open.
 */
function _resolveClosedSidebarEdgeTarget(clientX: number, sourceSide: string): IDropTarget | null {
  if (sourceSide !== "left" && sourceSide !== "right") return null;

  const otherSide: "left" | "right" = sourceSide === "left" ? "right" : "left";

  // If the other sidebar is open, its tab bar is the drop surface — the edge
  // line must never show for an open sidebar.
  if (_isSidebarOpen(otherSide)) return null;

  const nearLeft = clientX <= CLOSED_SIDEBAR_EDGE_THRESHOLD;
  const nearRight = clientX >= window.innerWidth - CLOSED_SIDEBAR_EDGE_THRESHOLD;

  if (otherSide === "left") {
    if (!nearLeft) return null;
  } else if (!nearRight) {
    return null;
  }

  return _getClosedSidebarDropTarget(otherSide);
}

function _getSidebarDropTarget(side: "left" | "right"): SidebarDropTarget | null {
  if (side === "left" && _sidebarDropTargetLeft) return _sidebarDropTargetLeft;
  if (side === "right" && _sidebarDropTargetRight) return _sidebarDropTargetRight;

  const barEl = document.querySelector(`[data-sidebar-tab-bar="${side}"]`);
  if (!(barEl instanceof HTMLElement)) return null;

  const winId = _resolveMyWinId();
  const target = new SidebarDropTarget(barEl, winId, side);
  if (side === "left") _sidebarDropTargetLeft = target;
  else _sidebarDropTargetRight = target;
  return target;
}

function _clearSidebarDropTargetCache(): void {
  // Any live edge indicator must be removed before the cached targets are dropped.
  _closedSidebarEdgeTargetLeft?.onLeave();
  _closedSidebarEdgeTargetRight?.onLeave();
  _sidebarDropTargetLeft = null;
  _sidebarDropTargetRight = null;
  _closedSidebarEdgeTargetLeft = null;
  _closedSidebarEdgeTargetRight = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Application Management tab bar registration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register the Application Management window's tab bar (`.wm-tabbar`) with the
 * drag system so manager-tab drags can resolve it as a drop target and
 * cross-window drops can land on it. Called by <openp41ge-window-manager>
 * after its first render. Returns an unregister function.
 */
export function registerManagerTabBar(barEl: HTMLElement, _winId: string): () => void {
  // A new registration replaces an old one (e.g. a re-render, or a second
  // window-manager window in the unlikely event of more than one per process).
  _managerBarDropTarget?.onLeave();
  _managerBarEl = barEl;
  _managerBarDropTarget = new ManagerTabBarDropTarget(barEl);
  return () => {
    if (_managerBarEl === barEl) {
      _managerBarDropTarget?.onLeave();
      _managerBarDropTarget = null;
      _managerBarEl = null;
    }
  };
}

/** Resolve to the manager tab-bar target when the cursor is over the bar. */
function _getManagerTabBarTarget(clientX: number, clientY: number): IDropTarget | null {
  if (!_managerBarDropTarget || !_managerBarEl) return null;
  const rect = _managerBarEl.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  return _managerBarDropTarget;
}

/** Internal: whether the cursor is over the registered manager bar. */
function _isOverManagerBar(clientX: number, clientY: number): boolean {
  return _getManagerTabBarTarget(clientX, clientY) !== null;
}

export function openp41geTargetResolver(clientX: number, clientY: number): IDropTarget | null {
  // Manager-tab drags may ONLY land on the Application Management tab bar. The
  // bar is inside a shadow root so document.elementFromPoint below can't see
  // it — resolve via the registered singleton (the manager bar's rect), and
  // never fall through to grid/sidebar surfaces. `_managerTabDragActive` lets
  // the final mouseup resolve still recognize a manager-tab drag after the
  // host nulls `_currentSource` (the orchestrator fires END before resolving).
  if (_currentSource?.type === "manager-tab" || _managerTabDragActive) {
    return _getManagerTabBarTarget(clientX, clientY);
  }

  // Accept any Element (including SVG): the tab icon is an inline <svg>, and
  // elementFromPoint returns the SVG element (not an HTMLElement), which would
  // otherwise fail the instanceof guard and break target resolution — hiding
  // every drop indicator when the cursor crosses a tab icon. Element.closest
  // works on SVG too, and every selector below resolves to an HTMLElement.
  //
  // Descend into shadow roots: the manager window's grid is inside two
  // (<openp41ge-window-manager> → <openp41ge-manager-grid> → <tab-grid>), where
  // document.elementFromPoint only sees the outermost host. Then look up with
  // _closestComposed, which climbs back out of any shadow root the cursor's
  // element is in.
  const el = _deepElementFromPoint(clientX, clientY);
  if (!el) return null;

  // The sidebar side of the current drag, if it is a sidebar-tab drag. Read from
  // the live source during moves, or from _sidebarTabDragSide for the final
  // mouseup resolve (the orchestrator fires DRAG_EVENTS.END — host teardown
  // nulls _currentSource — BEFORE it resolves the drop target). Both must agree
  // so the drop indicator and the drop land on the same target.
  let sidebarDragSide: string | null = null;
  if (_currentSource) {
    const d = _currentSource.getDragData() as { side?: string };
    sidebarDragSide = d.side === "left" || d.side === "right" ? d.side : null;
  } else {
    sidebarDragSide = _sidebarTabDragSide;
  }

  // When dragging a sidebar tab, only sidebar surfaces are valid targets.
  // Skip grid tab bars and grid cells entirely.
  if (sidebarDragSide) {
    const sidebarBarEl = _closestComposed(el, "[data-sidebar-tab-bar]");
    if (sidebarBarEl instanceof HTMLElement) {
      const side = sidebarBarEl.getAttribute("data-sidebar-tab-bar") as "left" | "right";
      if (side === "left" || side === "right") {
        return _getSidebarDropTarget(side);
      }
    }
    // Also allow drop on sidebar content area (appends to end of tab bar)
    const sidebarContentEl = _closestComposed(el, "[data-sidebar-content]");
    if (sidebarContentEl instanceof HTMLElement) {
      const side = sidebarContentEl.getAttribute("data-sidebar-content") as "left" | "right";
      if (side === "left" || side === "right") {
        return _getSidebarDropTarget(side);
      }
    }
    // No real sidebar surface under the cursor. If the OTHER sidebar is closed
    // and the cursor is close enough to that window edge, resolve to the
    // closed-sidebar edge target so the drop can still land there.
    return _resolveClosedSidebarEdgeTarget(clientX, sidebarDragSide);
  }

  // Payload drags: an extension in-place drop target under the cursor wins
  // (innermost first); otherwise fall through to the grid like a file drag.
  const payloadDrag =
    _currentSource?.type === "payload"
      ? (_currentSource.getDragData() as PayloadDragData)
      : _currentSource
        ? null
        : _activePayloadDrag;
  if (payloadDrag) {
    const extTarget = _resolveExtensionDropTarget(clientX, clientY, payloadDrag);
    if (extTarget) return extTarget;
  }

  // Normal (non-sidebar) drag: check grid tab bars and grid cells
  const isFileDrag = !!payloadDrag || _currentSource?.type === "open-tab";
  const tabBarEl = _closestComposed(el, "tab-bar");
  if (tabBarEl instanceof HTMLElement) {
    // Payload drags use the tab bar's own target: it shows the insert line and
    // opens the payload AT that position (TabBarDropTarget → insertAt).
    if (isFileDrag && !payloadDrag) {
      // TabBarDropTarget rejects non-tab sources, so a file dropped on a cell's
      // tab bar must resolve to the enclosing grid — GridDropTarget then computes
      // the column under the cursor (cell-center/boundary), matching the native
      // path and cross-window file drops.
      const gridEl = _closestComposed(tabBarEl, "tab-grid");
      if (gridEl instanceof HTMLElement) {
        const gridTarget = (gridEl as HTMLElement & { dropTarget?: IDropTarget }).dropTarget;
        if (gridTarget) return gridTarget;
      }
    } else {
      const dropTarget = (tabBarEl as HTMLElement & { dropTarget?: IDropTarget }).dropTarget;
      if (dropTarget) return dropTarget;
    }
  }

  const tabGridEl = _closestComposed(el, "tab-grid");
  if (tabGridEl instanceof HTMLElement) {
    const dropTarget = (tabGridEl as HTMLElement & { dropTarget?: IDropTarget }).dropTarget;
    if (dropTarget) return dropTarget;
  }

  // Sidebar surfaces are ONLY targets for sidebar-tab (system-tab) drags, which
  // are handled exclusively by the sidebar branch above (during moves via the
  // live source, at the final mouseup via _sidebarTabDragSide). Grid-tab and file
  // drags must never resolve the sidebar as a drop target — grid tabs can't be
  // dropped there (SidebarDropTarget rejects non-system-tab sources), so the
  // sidebar drop indicator must not light up for them.

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Local ghost overlay (same-window drag)
// ═══════════════════════════════════════════════════════════════════════════

let _ghostShownGrid: HTMLElement | null = null;

function updateGridGhost(clientX: number, clientY: number): void {
  const target = openp41geTargetResolver(clientX, clientY);
  if (!target) {
    clearGridGhost();
    return;
  }

  // Cursor over a grid cell's tab bar: the TabBarDropTarget owns the reorder /
  // insert line, but the landing cell's drop box keeps its WASH with the
  // border suppressed, so the insert line reads clearly (the wash still marks
  // the landing cell).
  if (target.type === "tab-bar") {
    const barEl = target.element as HTMLElement;
    const gridEl = barEl.closest("tab-grid");
    const col = (target as unknown as { col?: number }).col;
    if (!(gridEl instanceof HTMLElement) || col === undefined || col < 0) {
      clearGridGhost();
      return;
    }
    // Re-showing on the SAME grid reuses the overlay (see the grid branch
    // below); only tear it down when switching to a DIFFERENT grid.
    if (_ghostShownGrid && _ghostShownGrid !== gridEl) {
      _ghostManager.hideGhost(_ghostShownGrid);
      _ghostShownGrid = null;
    }
    const gridCols = (gridEl as unknown as { cols?: number }).cols ?? 1;
    _ghostManager.showGhost(gridEl, { cols: gridCols, activeCol: col, suppressFrame: true });
    _ghostShownGrid = gridEl;
    return;
  }

  if (target.type !== "grid") {
    clearGridGhost();
    return;
  }

  const source = _currentSource;
  if (!source) {
    clearGridGhost();
    return;
  }

  const feedback = target.onHover(source, clientX, clientY);
  if (!feedback || !feedback.showGhost || !feedback.ghostConfig) {
    clearGridGhost();
    return;
  }

  // Re-showing on the SAME grid must NOT tear down and rebuild the ghost
  // overlay on every mousemove. clearGridGhost() (hideGhost) + showGhost()
  // would destroy and recreate the <drop-box> on every frame, so the accent
  // would re-fade-in from opacity 0 and flicker/appear-and-disappear over and
  // over. showGhost() reuses the existing overlay while it is still attached,
  // so only tear the previous overlay down when the new ghost is on a
  // DIFFERENT grid (so the old grid's overlay is actually removed).
  if (_ghostShownGrid && _ghostShownGrid !== target.element) {
    _ghostManager.hideGhost(_ghostShownGrid);
    _ghostShownGrid = null;
  }

  const cfg = feedback.ghostConfig as Record<string, unknown>;
  _ghostManager.showGhost(target.element, {
    cols: (cfg.cols as number) ?? 1,
    boundaryIndex: cfg.boundaryIndex as number | undefined,
    splitCol: cfg.splitCol as number | undefined,
    splitLeft: cfg.splitLeft as boolean | undefined,
    // GridDropTarget.onHover returns `mouseCol` in split config,
    // but `col` in cell-center config — handle both.
    activeCol: (cfg.mouseCol ?? cfg.col ?? 0) as number,
  });
  _ghostShownGrid = target.element;
}

function clearGridGhost(): void {
  if (_ghostShownGrid) {
    _ghostManager.hideGhost(_ghostShownGrid);
    _ghostShownGrid = null;
  }
}
