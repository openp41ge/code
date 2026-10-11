/**
 * LogStreamDragSource — drag source for dragging a log system row from the
 * Logs sidebar into the grid.
 *
 * Reuses the generic `open-tab` payload so a drop (same- or cross-window)
 * opens a system-scoped `log-viewer` pane with `config.system`.
 *
 * The visual ghost is a pixel-accurate bitmap of the source row captured by
 * the main process (webContents.capturePage) at drag threshold and rendered
 * in the transparent always-on-top DragGhostManager BrowserWindow — the only
 * thing that can follow the cursor OUTSIDE the app window. The in-DOM ghost
 * is therefore invisible (as with tab/file drags), and the source row is left
 * untouched so the captured bitmap is not faded.
 */

import type { IDragSource, DragSourceData, DragResult } from "../../interfaces/drag-handler";

export class LogStreamDragSource implements IDragSource {
  readonly type = "open-tab";

  private _system: string;
  private _title: string;
  private _offsetX = 0;
  private _offsetY = 0;
  private _ghost: HTMLElement | null = null;

  constructor(system: string, title?: string) {
    this._system = system;
    this._title = title || system;
  }

  getDragData(): DragSourceData {
    return {
      type: "open-tab",
      appType: "log-viewer",
      title: this._title,
      tabConfig: { system: this._system },
    };
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

  /**
   * Create an invisible in-DOM ghost — the visible ghost is the main-process
   * BrowserWindow overlay (a captured bitmap of the source row), so we don't
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
    // The source row is intentionally NOT dimmed here: the ghost bitmap is
    // captured from it via capturePage after this fires, so it must stay at
    // full opacity. The row itself remains in place until a drop/end.
  }

  onDragEnd(_result: DragResult): void {
    if (this._ghost && this._ghost.parentNode) {
      this._ghost.parentNode.removeChild(this._ghost);
    }
    this._ghost = null;
  }
}
