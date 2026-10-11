/**
 * ManagerTabDragSource — drag source for the Application Management window's
 * tab bar (Workspaces / Settings / Welcome / Releases).
 *
 * Manager tabs behave like every other tab type: the visible drag element is a
 * pixel-accurate bitmap of the source tab captured by the main process
 * (webContents.capturePage) at the drag threshold and rendered in the
 * transparent always-on-top DragGhostManager BrowserWindow — the only thing
 * that can follow the cursor OUTSIDE the app window. The in-DOM ghost is
 * therefore invisible, and the source tab is dimmed (like grid/sidebar tabs)
 * so it reads as "picked up" while the bitmap stays a clean copy.
 *
 * Manager tabs are the only surface in the manager window that is draggable,
 * and they may ONLY be dropped on another management window's tab bar (or back
 * into the same bar to reorder). The ACTION is decided by the host
 * (init-drag-system): same-window reorder, cross-window move, or detach-to-new
 * window.
 */

import type { IDragSource, DragSourceData, DragResult } from "../../interfaces/drag-handler";

export interface ManagerTabDragData {
  tabId: string;
  winId: string;
  title: string;
}

export class ManagerTabDragSource implements IDragSource {
  readonly type = "manager-tab";

  private _el: HTMLElement;
  private _tabId: string;
  private _winId: string;
  private _title: string;
  private _ghost: HTMLElement | null = null;
  private _offsetX = 0;
  private _offsetY = 0;

  constructor(el: HTMLElement, tabId: string, winId: string, title: string) {
    this._el = el;
    this._tabId = tabId;
    this._winId = winId;
    this._title = title;
  }

  /** Set the cursor offset for the main-process ghost positioning. */
  setOffset(offsetX: number, offsetY: number): void {
    this._offsetX = offsetX;
    this._offsetY = offsetY;
  }

  get offsetX(): number {
    return this._offsetX;
  }

  get offsetY(): number {
    return this._offsetY;
  }

  getDragData(): DragSourceData {
    return {
      type: "manager-tab",
      tabId: this._tabId,
      winId: this._winId,
      title: this._title,
    };
  }

  /**
   * Create an invisible in-DOM ghost — the visible ghost is the main-process
   * BrowserWindow overlay (a captured bitmap of the source tab), so we don't
   * render a second in-DOM element that would double up and be clipped to
   * this window.
   */
  createGhost(): HTMLElement {
    const ghost = document.createElement("div");
    ghost.style.cssText =
      "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px;z-index:-1;";
    this._ghost = ghost;
    return ghost;
  }

  onDragStart(): void {
    // Dim the source tab so it reads as "picked up" (mirrors grid/sidebar tabs).
    this._el.style.opacity = "0.4";
  }

  onDragEnd(_result: DragResult): void {
    this._el.style.opacity = "";
    if (this._ghost && this._ghost.parentNode) {
      this._ghost.parentNode.removeChild(this._ghost);
    }
    this._ghost = null;
  }
}
