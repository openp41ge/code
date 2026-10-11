/**
 * WorkspaceRowDragSource — drag source for dragging a row of the Window
 * Manager's sidebar into the manager grid: a workspace row (its workspace
 * editor) or a Settings row (its settings editor).
 *
 * Uses the generic `open-tab` payload so a drop on the manager grid opens a
 * workspace-editor cell with `tabConfig = { path, dir }` — the same mechanism
 * git-entry and log-stream rows use to open app panes. The grid's built-in
 * `GridDropTarget` turns the drop into a `grid-open-tab` event; the manager
 * grid's owning component (openp41ge-manager-grid) opens the cell.
 *
 * The visual ghost is a pixel-accurate bitmap of the source row captured by
 * the main process (webContents.capturePage) and rendered in the transparent
 * always-on-top `DragGhostManager` BrowserWindow — the only thing that can
 * follow the cursor outside the app window. The in-DOM ghost is therefore
 * invisible (as with tab/file/log drags), and the source row is left untouched
 * so the captured bitmap is not faded.
 */

import type { IDragSource, DragSourceData, DragResult } from "../../interfaces/drag-handler";

export class WorkspaceRowDragSource implements IDragSource {
  readonly type = "open-tab";

  constructor(
    private readonly _appType: string,
    private readonly _title: string,
    private readonly _config: Record<string, unknown>,
  ) {}

  getDragData(): DragSourceData {
    return {
      type: "open-tab",
      appType: this._appType,
      title: this._title,
      tabConfig: this._config,
    };
  }

  /** Create an invisible in-DOM ghost — the visible ghost is the main-process
   *  BrowserWindow overlay (a captured bitmap of the source row). */
  createGhost(): HTMLElement {
    const ghost = document.createElement("div");
    ghost.style.cssText =
      "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px;z-index:-1;";
    return ghost;
  }

  onDragStart(): void {
    // The source row stays at full opacity: the ghost bitmap is captured from
    // it via capturePage after this fires.
  }

  onDragEnd(_result: DragResult): void {
    // Nothing to clean up — the ghost is owned by the campaign in the manager.
  }
}
