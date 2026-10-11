/**
 * DragOrchestrator — unified drag-and-drop coordinator.
 *
 * Manages the drag session (source, ghost, target resolution, mouse events).
 * Fires CustomEvents on `document` for cross-window operations so the host
 * application (openp41ge) can wire them to Electron IPC.
 *
 * Events on `document`:
 *   openp41ge-drag-position — { screenX, screenY }
 *   openp41ge-drag-end      — {}
 *   openp41ge-drag-detach   — { winId, tabId, bounds }
 *   openp41ge-drag-cross    — { data, screenX, screenY }  (to show ghost in other window)
 */

import type { IDragSource, IDropTarget, DragResult, IDragHandler } from "./interfaces";
import { GhostManager } from "./ghost-manager";
import { CursorManager } from "./cursor-manager";

// ─── Document-level CustomEvent names ─────────────────────────────────────

export const DRAG_EVENTS = {
  POSITION: "openp41ge-drag-position",
  END: "openp41ge-drag-end",
  DETACH: "openp41ge-drag-detach",
  CROSS: "openp41ge-drag-cross",
} as const;

// ─── Drag session state ──────────────────────────────────────────────────

interface DragSession {
  source: IDragSource;
  ghost: HTMLElement | null;
  startX: number;
  startY: number;
  thresholdMet: boolean;
  currentTarget: IDropTarget | null;
  /** True while the cursor sits over a tab bar (the resolved target's
   *  `onHover` feedback reports `overTabBar`). Drives ghost dimming. */
  overTabBar: boolean;
  initiated: boolean;
}

// ─── Drop target resolver ─────────────────────────────────────────────────

export type TargetResolver = (clientX: number, clientY: number) => IDropTarget | null;

/**
 * Default target resolver using elementFromPoint + closest selectors.
 */
export function defaultTargetResolver(clientX: number, clientY: number): IDropTarget | null {
  // Accept any Element (including SVG icons): elementFromPoint returns the
  // SVG element, and `closest` (on Element) still resolves the HTML ancestors.
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;

  // Check for tab bar
  const tabBarEl = el.closest?.(".cell-tab-bar");
  if (tabBarEl instanceof HTMLElement) {
    const cellEl = tabBarEl.closest?.(".openp41ge-grid-cell");
    const gridEl = cellEl?.closest?.("openp41ge-grid");
    if (cellEl && gridEl instanceof HTMLElement) {
      const cells = Array.from(gridEl.children).filter(
        (c) => c instanceof HTMLElement && c.classList.contains("openp41ge-grid-cell"),
      );
      const col = cells.indexOf(cellEl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { _kind: "tab-bar", element: tabBarEl, col, winId: (gridEl as any).winId } as any;
    }
  }

  // Check for grid
  const gridEl = el.closest?.("openp41ge-grid");
  if (gridEl instanceof HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { _kind: "grid", element: gridEl } as any;
  }

  return null;
}

// ─── DragOrchestrator ─────────────────────────────────────────────────────

export class DragOrchestrator implements IDragHandler {
  private _session: DragSession | null = null;
  private _ghostManager = new GhostManager();
  private _cursorManager = new CursorManager();
  private _resolveTarget: TargetResolver;
  private _targetCache = new Map<HTMLElement, IDropTarget>();
  private _lastCrossCheck = 0;

  get isDragging(): boolean {
    return this._session !== null;
  }

  constructor(
    resolveTarget?: TargetResolver,
    private readonly _onTargetChange?: (target: IDropTarget | null, overTabBar: boolean) => void,
  ) {
    this._resolveTarget = resolveTarget ?? defaultTargetResolver;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  startDrag(source: IDragSource, clientX: number, clientY: number): void {
    if (this._session) {
      this._cancel();
    }

    this._session = {
      source,
      ghost: null,
      startX: clientX,
      startY: clientY,
      thresholdMet: false,
      currentTarget: null,
      overTabBar: false,
      initiated: false,
    };

    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("mouseup", this._onMouseUp);
  }

  /**
   * Start the pending drag where the pointer is now, as if it had crossed the
   * movement threshold (a long-press). Returns false when there is no pending
   * drag, or it has already started.
   */
  engage(at: { clientX: number; clientY: number; screenX: number; screenY: number }): boolean {
    const s = this._session;
    if (!s || s.thresholdMet) return false;
    s.thresholdMet = true;
    this._onMouseMove(new MouseEvent("mousemove", at));
    return true;
  }

  async simulateDrag(source: IDragSource, target: IDropTarget): Promise<DragResult> {
    source.onDragStart();
    this._cursorManager.enable();
    try {
      const result = await target.onDrop(source, 0, 0);
      source.onDragEnd(result);
      this._cursorManager.disable();
      return result;
    } catch (err) {
      const result: DragResult = { success: false, reason: String(err) };
      source.onDragEnd(result);
      this._cursorManager.disable();
      return result;
    }
  }

  cancelDrag(): void {
    if (this._session) {
      if (this._session.initiated) {
        this._session.source.onDragEnd({ success: false, reason: "cancelled" });
      }
      this._cancel();
    }
  }

  dispose(): void {
    this.cancelDrag();
    this._targetCache.clear();
    this._ghostManager.dispose();
  }

  // ── Mouse handlers ──────────────────────────────────────────────────────

  private _onMouseMove = (ev: MouseEvent): void => {
    const s = this._session;
    if (!s) return;

    const dx = ev.clientX - s.startX;
    const dy = ev.clientY - s.startY;

    // Drag threshold: start once total (Manhattan) movement exceeds 3px.
    // Small enough to feel instant, large enough to ignore 1-2px click jitter.
    if (!s.thresholdMet && Math.abs(dx) + Math.abs(dy) > 3) {
      s.thresholdMet = true;
    }

    if (s.thresholdMet && !s.initiated) {
      this._initiateDrag(s, ev);
    }

    if (s.thresholdMet && s.ghost) {
      const gw = parseInt(s.ghost.dataset.dragGhostWidth || "160", 10);
      const gh = parseInt(s.ghost.dataset.dragGhostHeight || "32", 10);
      s.ghost.style.left = `${ev.clientX - gw / 2}px`;
      s.ghost.style.top = `${ev.clientY - gh / 2}px`;
      document.dispatchEvent(
        new CustomEvent(DRAG_EVENTS.POSITION, {
          detail: { screenX: ev.screenX, screenY: ev.screenY },
        }),
      );
    }

    const newTarget = s.thresholdMet ? this._resolveTarget(ev.clientX, ev.clientY) : null;
    const prevTarget = s.currentTarget;
    const prevOverTabBar = s.overTabBar;

    if (newTarget !== prevTarget) {
      if (prevTarget) {
        prevTarget.onLeave();
      }
      this._clearOverlays();
      s.currentTarget = newTarget;
      s.overTabBar = false;
    }

    if (s.currentTarget) {
      // `onHover` also returns whether the cursor is over a tab bar (vs the
      // cell/sidebar body) so the host can fade the drag ghost or soften the
      // drop box while a tab-bar insert line is under the cursor.
      const feedback = s.currentTarget.onHover(s.source, ev.clientX, ev.clientY);
      s.overTabBar = !!feedback?.overTabBar;
    } else {
      s.overTabBar = false;
    }

    // Notify the host when the resolved target OR the tab-bar hover state
    // changes (moving over a tab bar toggles the ghost dim / box framing even
    // though the resolved target stays the same).
    if (s.currentTarget !== prevTarget || s.overTabBar !== prevOverTabBar) {
      this._onTargetChange?.(s.currentTarget, s.overTabBar);
    }

    if (s.currentTarget) {
      s.currentTarget.onHover(s.source, ev.clientX, ev.clientY);
    } else if (s.thresholdMet && s.initiated) {
      // Cursor is not over any valid drop target in this window.
      // Fire CROSS event so the host can forward ghost position to
      // other windows for cross-window drag preview.
      // Throttled to ~100ms to avoid excessive IPC.
      const now = Date.now();
      if (now - this._lastCrossCheck > 100) {
        this._lastCrossCheck = now;
        const data = s.source.getDragData();
        document.dispatchEvent(
          new CustomEvent(DRAG_EVENTS.CROSS, {
            detail: {
              screenX: ev.screenX,
              screenY: ev.screenY,
              tabId: data.type === "tab" || data.type === "openp41ge-tab" ? data.tabId : undefined,
              winId: data.type === "tab" || data.type === "openp41ge-tab" ? data.winId : undefined,
              label:
                data.type === "tab" || data.type === "openp41ge-tab" ? data.title || "Tab" : "Drag",
            },
          }),
        );
      }
    }
  };

  private _onMouseUp = (ev: MouseEvent): void => {
    // Only the primary (left) button ends a drag — a right-button mouseup must
    // never be treated as a drop (and must not end a left-button drag).
    if (ev.button !== 0) return;

    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("mouseup", this._onMouseUp);

    const s = this._session;
    if (!s) return;

    if (!s.thresholdMet) {
      document.body.style.overflow = "";
      this._cancel();
      return;
    }

    this._cursorManager.disable();
    document.body.style.overflow = "";
    document.dispatchEvent(new CustomEvent(DRAG_EVENTS.END));

    const target = this._resolveTarget(ev.clientX, ev.clientY);
    if (target && "_kind" in target) {
      // Resolved by default resolver — in the full app, the host provides
      // a custom resolver that wraps elements in real IDropTarget instances.
      // The default resolver is a fallback for basic scenarios.
      this._session?.source.onDragEnd({ success: false, reason: "unresolved target" });
      this._cancel();
    } else if (target) {
      target
        .onDrop(s.source, ev.clientX, ev.clientY)
        .then((result) => {
          s.source.onDragEnd(result);
          this._cancel();
        })
        .catch((err) => {
          s.source.onDragEnd({ success: false, reason: String(err) });
          this._cancel();
        });
    } else {
      // No target — fire detach event for host to handle
      // Include screenX/screenY so the host can check for cross-window drops
      // before falling back to creating a new window.
      const data = s.source.getDragData();
      if (data.type === "tab" || data.type === "openp41ge-tab" || data.type === "manager-tab") {
        document.dispatchEvent(
          new CustomEvent(DRAG_EVENTS.DETACH, {
            detail: {
              winId: data.winId,
              tabId: data.tabId,
              // Manager tabs are window-local (not part of any workspace
              // layout Window), so they carry no workset/source-column id.
              sourceWorksetId: data.type === "manager-tab" ? undefined : data.worksetId,
              screenX: ev.screenX,
              screenY: ev.screenY,
              bounds: { x: ev.screenX - 50, y: ev.screenY - 50, width: 800, height: 600 },
            },
          }),
        );
      }
      s.source.onDragEnd({ success: false, reason: "no target" });
      this._cancel();
    }
  };

  // ── Visual feedback ─────────────────────────────────────────────────────

  private _clearOverlays(): void {
    document
      .querySelectorAll(
        ".openp41ge-ghost-overlay, .openp41ge-split-overlay, .openp41ge-cell-target-highlight",
      )
      .forEach((el) => el.remove());
  }

  // ── Initiation & Cleanup ────────────────────────────────────────────────

  private _initiateDrag(s: DragSession, ev: MouseEvent): void {
    const ghost = s.source.createGhost();
    document.body.appendChild(ghost);
    document.body.style.overflow = "hidden";

    const gw = ghost.offsetWidth || 160;
    const gh = ghost.offsetHeight || 32;
    ghost.dataset.dragGhostWidth = String(gw);
    ghost.dataset.dragGhostHeight = String(gh);
    ghost.style.left = `${ev.clientX - gw / 2}px`;
    ghost.style.top = `${ev.clientY - gh / 2}px`;
    s.ghost = ghost;

    s.source.onDragStart();
    this._cursorManager.enable();
    s.initiated = true;
  }

  private _cancel(): void {
    if (!this._session) return;

    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("mouseup", this._onMouseUp);
    this._cursorManager.disable();
    document.body.style.overflow = "";

    if (this._session.ghost && this._session.ghost.parentNode) {
      this._session.ghost.parentNode.removeChild(this._session.ghost);
    }

    const hadTarget = !!this._session.currentTarget;
    if (this._session.currentTarget) {
      this._session.currentTarget.onLeave();
    }
    this._clearOverlays();
    this._session = null;
    // A drag that was over a target (e.g. ended on a tab bar) must restore the
    // host's per-target ghost feedback to its default state. Nothing to restore
    // if no target was ever active.
    if (hadTarget) this._onTargetChange?.(null, false);
  }
}
