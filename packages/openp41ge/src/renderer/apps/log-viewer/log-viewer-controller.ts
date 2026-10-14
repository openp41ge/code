/**
 * Log viewer controller — mounts <openp41ge-log-viewer> as a grid tab showing
 * one log stream (`system`).
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
 * Clicking a row opens the entry's detail drawer over the tab. The tab takes
 * requests for its stream (`log-tab-requests`): reveal an error, or point the
 * find bar at a query.
 */

import { Openp41geLogViewer } from "openp41ge-core-logger/viewer";
import type { LogViewEntry } from "openp41ge-core-logger";
import { createLogger } from "openp41ge-core-logger";
import { LogFilePageReader } from "../../services/log-file-page-reader";
import type { TabController } from "../../controllers/types";
import {
  logDetailFromEntry,
  type Openp41geLogDetailDrawer,
} from "../../components/openp41ge-log-detail-drawer";
import { attachLogTab, type LogTabRequest } from "./log-tab-requests";

const log = createLogger("openp41ge", "log-viewer-controller");

export class LogViewerController implements TabController {
  readonly tabId: string;
  readonly appType = "log-viewer";
  private _container: HTMLElement | null = null;
  private _viewer: Openp41geLogViewer | null = null;
  private _drawer: HTMLElement | null = null;
  private _detach: (() => void) | null = null;
  private _source: string | null = null;
  private _system: string | null = null;

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  get system(): string | null {
    return this._system;
  }

  mount(container: HTMLElement): void {
    this._container = container;
    // The detail drawer is positioned over the tab.
    if (!container.style.position) container.style.position = "relative";
    const viewer = document.createElement(Openp41geLogViewer.tagName) as Openp41geLogViewer;
    // restore() receives the tab config (`system`, and `source` from older
    // tabs). Read the persisted daily files (newest at the bottom, scrolling
    // up loads older history). If `log:read-backward` isn't available the
    // viewer owns the fallback to the in-memory bus.
    viewer.pageReader = new LogFilePageReader();
    if (this._source) viewer.source = this._source;
    if (this._system) viewer.system = this._system;
    container.appendChild(viewer);
    this._viewer = viewer;
    container.addEventListener("log-row-click", this._onRowClick);
    this._detach = attachLogTab(this);
  }

  unmount(): void {
    this._detach?.();
    this._detach = null;
    this._container?.removeEventListener("log-row-click", this._onRowClick);
    this._closeDrawer();
    this._viewer?.remove();
    this._viewer = null;
    this._container = null;
  }

  /** A request for this tab's stream. */
  apply(request: LogTabRequest): void {
    const viewer = this._viewer;
    if (!viewer) return;
    if (request.kind === "find") {
      viewer.setFindQuery(request.query);
      return;
    }
    // Revealing a row fires its `log-row-click`, which opens the drawer.
    viewer.revealError(request.errorId).catch((err: unknown) => {
      log.error("log tab reveal failed:", err, { skipToast: true });
    });
  }

  /** A clicked row: show its details (one drawer per tab, refreshed). */
  private readonly _onRowClick = (e: Event): void => {
    const entry = (e as CustomEvent<{ entry?: LogViewEntry }>).detail?.entry;
    if (!entry || !this._container) return;
    let drawer = this._drawer?.querySelector("openp41ge-log-detail-drawer") as
      Openp41geLogDetailDrawer | null | undefined;
    if (!drawer) {
      const wrap = document.createElement("div");
      wrap.className = "lw-drawer-wrap";
      wrap.style.inset = "0";
      drawer = document.createElement("openp41ge-log-detail-drawer") as Openp41geLogDetailDrawer;
      drawer.addEventListener("drawer-close", () => this._closeDrawer());
      wrap.appendChild(drawer);
      this._container.appendChild(wrap);
      this._drawer = wrap;
    }
    drawer.detail = logDetailFromEntry(entry);
  };

  private _closeDrawer(): void {
    this._drawer?.remove();
    this._drawer = null;
  }

  setVisible(_visible: boolean): void {
    // Do NOT move focus into the viewer here. Activating the Logs sidebar tab
    // (or a grid tab) must not steal focus to the log list — Cmd/Ctrl+F is
    // scoped to a *specific* log viewer, so it only opens search when focus is
    // already on that viewer (moved there by the viewer's own pointerdown
    // focus-grab or by the user tabbing/clicking into it). If activating a
    // sidebar tab focused the list, we could never tell which of several log
    // viewers a Cmd/Ctrl+F belongs to.
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
