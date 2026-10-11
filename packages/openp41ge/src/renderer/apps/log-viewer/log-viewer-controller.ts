/**
 * Log viewer controller — mounts <openp41ge-log-viewer> as a pane.
 *
 * The viewer reads the **persisted** daily log files under `<dataDir>/logs`
 * via `LogFilePageReader` (backward paging: newest at the bottom, older pages
 * loaded as the user scrolls up). Logs therefore survive dev hot-reloads and
 * app restarts instead of being reset on every reload.
 *
 * If the `log:read-backward` IPC isn't available (no preload bridge, or a
 * stale main process), `LogFilePageReader.loadLatest` throws and the viewer
 * falls back to the in-memory bus — so a stale main process can't flood the
 * error capture with toasts.
 *
 * A `system` config is passed through but the viewer shows all logs in
 * datetime order (no grouping).
 */

import { Openp41geLogViewer } from "openp41ge-core-logger/viewer";
import { LogFilePageReader } from "../../services/log-file-page-reader";
import type { TabController } from "../../controllers/types";

export class LogViewerController implements TabController {
  readonly tabId: string;
  readonly appType = "log-viewer";
  private _container: HTMLElement | null = null;
  private _viewer: Openp41geLogViewer | null = null;
  private _source: string | null = null;
  private _system: string | null = null;
  private _visible = false;

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  mount(container: HTMLElement): void {
    this._container = container;
    const viewer = document.createElement(Openp41geLogViewer.tagName) as Openp41geLogViewer;
    // restore() receives the tab config (including `source` + `system`). The
    // viewer shows all logs in datetime order (no system/source filter).
    //
    // Read the persisted daily files (newest at the bottom, scrolling up loads
    // older history). If `log:read-backward` isn't available the viewer owns
    // the fallback to the in-memory bus.
    viewer.pageReader = new LogFilePageReader();
    if (this._source) viewer.source = this._source;
    if (this._system) viewer.system = this._system;
    container.appendChild(viewer);
    this._viewer = viewer;
  }

  unmount(): void {
    if (this._viewer && this._container) {
      this._container.removeChild(this._viewer);
    }
    this._viewer = null;
    this._container = null;
  }

  setVisible(visible: boolean): void {
    // Do NOT move focus into the viewer here. Activating the Logs sidebar tab
    // (or a grid tab) must not steal focus to the log list — Cmd/Ctrl+F is
    // scoped to a *specific* log viewer, so it only opens search when focus is
    // already on that viewer (moved there by the viewer's own pointerdown
    // focus-grab or by the user tabbing/clicking into it). If activating a
    // sidebar tab focused the list, we could never tell which of several log
    // viewers a Cmd/Ctrl+F belongs to.
    this._visible = visible;
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (this._source) out.source = this._source;
    if (this._system) out.system = this._system;
    return out;
  }

  restore(state: Record<string, unknown>): void {
    this._source = typeof state.source === "string" ? state.source : null;
    this._system = typeof state.system === "string" ? state.system : null;
  }
}
