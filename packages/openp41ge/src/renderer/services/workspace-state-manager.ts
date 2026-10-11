import type { Workspace, Rect } from "../../layout/types";
import { computeLayout } from "../../layout/compute-layout";
import type { IWorkspaceStateManager } from "../interfaces/workspace-state-manager";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "workspace-state-manager");

/**
 * Observable workspace state manager.
 *
 * Wraps the module-level workspace state into an observable class.
 * Components subscribe to state changes instead of being called
 * by a central render() function.
 *
 * Layouts are stored as Map<windowId, Map<tabId, Rect>> to match
 * the legacy interface expected by components.
 */
export class WorkspaceStateManager implements IWorkspaceStateManager {
  private _workspace: Workspace | null = null;
  private _layouts = new Map<string, Map<string, Rect>>();
  private readonly _listeners = new Set<(ws: Workspace) => void>();

  setState(ws: Workspace): void {
    // DEBUG mutation summary: window/tab/grid shape, so workspace operations
    // (open/close/split/move) land in the log bus even though this manager is
    // only handed the resulting state (the operation itself lives upstream).
    log.debug("workspace-state", {
      windows: ws.windows.map((w) => ({
        id: w.id,
        cols: w.grid.cols,
        rows: w.grid.rows,
        placements: w.grid.placements.length,
        tabs: w.grid.placements.reduce((n, p) => n + p.tabIds.length, 0),
      })),
    });

    this._workspace = ws;

    // Recompute layouts
    const map = new Map<string, Map<string, Rect>>();
    for (const win of ws.windows) {
      const viewport: Rect = { x: 0, y: 0, width: win.bounds.width, height: win.bounds.height };
      const layout = computeLayout(win, viewport);
      map.set(win.id, layout);
    }
    this._layouts = map;

    // Notify all listeners
    for (const fn of this._listeners) {
      try {
        fn(ws);
      } catch (err) {
        log.error("listener error:", err, { skipToast: true });
      }
    }
  }

  getWorkspace(): Workspace | null {
    return this._workspace;
  }

  getLayouts(): Map<string, Map<string, Rect>> {
    return this._layouts;
  }

  subscribe(callback: (ws: Workspace) => void): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }
}
