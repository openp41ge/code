/**
 * ClosedSidebarDropTarget — drop surface for dragging a sidebar tab onto the
 * OTHER sidebar while that sidebar is CLOSED.
 *
 * When the cursor comes close enough to the app-window edge on the closed
 * side, the resolver resolves to this target, which paints a thin vertical
 * line at that window edge as the drop indicator. The line only ever shows
 * while this target is the active target — when the sidebar is open, its own
 * tab bar is the drop surface instead and this target is never resolved.
 *
 * On drop, it fires the same `sidebar-tab-drop` CustomEvent as SidebarDropTarget
 * with `targetSide = this.side`, appending at the end of the (hidden) tab bar.
 * The host's `moveSystemTabToSidebar` op already flips the target sidebar's
 * `<side>SidebarOpen` flag, so the sidebar opens to reveal the moved tab.
 *
 * Fires on `document`:
 *   sidebar-tab-drop — { tabId, sourceSide, targetSide, dropIndex, winId }
 */

import type {
  IDragSource,
  IDropTarget,
  DragResult,
  TargetFeedback,
} from "../../openp41ge-tabs-adapter";
import { SIDEBAR_DROP_EVENT, TITLEBAR_HEIGHT } from "openp41ge-core-constants";
import { getTabButtonsInSidebarBar } from "./sidebar-drop-target";

/**
 * Vertical clearance (px) from the app window's bottom edge where the closed-
 * sidebar edge drop indicator stops. The window's bottom corners are rounded
 * by the OS (~10px on macOS standard windows); the indicator must not run into
 * that corner strip. A border-radius cap is not used here: on a 3px-wide line a
 * 10px radius is clamped to ~1.5px (invisible), so the indicator is a clean
 * square-ended line that simply stops above the corner — matching the existing
 * sidebar/tab-bar drop indicators.
 */
const WINDOW_BOTTOM_CLEARANCE = 12;

export class ClosedSidebarDropTarget implements IDropTarget {
  readonly type = "closed-sidebar-edge";
  readonly element: HTMLElement;

  readonly winId: string;
  readonly side: "left" | "right";
  private _barEl: HTMLElement | null;
  private _indicatorEl: HTMLElement | null = null;

  constructor(
    hostEl: HTMLElement,
    winId: string,
    side: "left" | "right",
    barEl: HTMLElement | null,
  ) {
    this.element = hostEl;
    this.winId = winId;
    this.side = side;
    this._barEl = barEl;
  }

  onHover(_source: IDragSource, _clientX: number, _clientY: number): TargetFeedback | null {
    this._showIndicator();
    return { indicatorKey: `closed-sidebar-${this.winId}-${this.side}` };
  }

  async onDrop(source: IDragSource, _clientX: number, _clientY: number): Promise<DragResult> {
    this._hideIndicator();

    const data = source.getDragData() as Record<string, unknown>;
    if (data.type !== "system-tab" || typeof data.tabId !== "string") {
      return { success: false, reason: "only system tabs can be dropped on a closed sidebar edge" };
    }

    const sourceSide = data.side as "left" | "right";
    const dropIndex = this._barEl ? getTabButtonsInSidebarBar(this._barEl).length : 0;

    document.dispatchEvent(
      new CustomEvent(SIDEBAR_DROP_EVENT, {
        bubbles: true,
        detail: {
          tabId: data.tabId,
          sourceSide,
          targetSide: this.side,
          dropIndex,
          winId: this.winId,
        },
      }),
    );
    return { success: true };
  }

  onLeave(): void {
    this._hideIndicator();
  }

  /**
   * Paint (once) a thin vertical line at the app-window edge on this side.
   * Fixed to the viewport so it draws over the grid and any panes.
   */
  private _showIndicator(): void {
    if (this._indicatorEl && document.body.contains(this._indicatorEl)) {
      this._indicatorEl.style.display = "block";
      return;
    }

    const el = document.createElement("drop-line");
    el.className = "closed-sidebar-edge-indicator";
    // Look (3px solid blue + glow) comes from <drop-line>; only the fixed
    // placement at the app-window edge is set here. Its stylesheet pins
    // `left: 0`, so the right edge must reset `left` too.
    el.style.cssText = [
      "position:fixed",
      this.side === "left" ? "left:0" : "left:auto;right:0",
      `top:${TITLEBAR_HEIGHT}px`,
      `bottom:${WINDOW_BOTTOM_CLEARANCE}px`,
      "pointer-events:none",
      "z-index:100000",
    ].join(";");
    document.body.appendChild(el);
    this._indicatorEl = el;
  }

  private _hideIndicator(): void {
    if (this._indicatorEl && this._indicatorEl.parentNode) {
      this._indicatorEl.parentNode.removeChild(this._indicatorEl);
    }
    this._indicatorEl = null;
  }
}
