import * as ops from "../../layout/operations.js";
import { createWorkspace } from "../../layout/types.js";
import type { Workspace } from "../../layout/types.js";
import { cleanupWorkspace } from "../../layout/grid-operations.js";
import type { IOperationDispatcher, BroadcastFn } from "../interfaces/operation-dispatcher.js";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "operation-dispatcher");

/**
 * Dispatches layout operations and manages workspace state.
 *
 * Applies named operations from operations.ts and broadcasts state changes
 * to all windows.
 */
export class OperationDispatcher implements IOperationDispatcher {
  private _workspace: Workspace;
  private _broadcast: BroadcastFn | null = null;
  private _saveHandler: ((ws: Workspace) => void) | null = null;

  constructor(initialWorkspace?: Workspace) {
    this._workspace = initialWorkspace ?? createWorkspace("ws1");
  }

  apply(name: string, args: unknown[]): boolean {
    log.info(name, ...args);

    const fn = (ops as Record<string, Function>)[name];
    if (typeof fn !== "function") {
      log.error(`Unknown operation: ${name}`);
      return false;
    }
    try {
      this._workspace = fn(this._workspace, ...args);

      // Strip any empty placements from the workspace
      this._workspace = cleanupWorkspace(this._workspace);

      // After a successful mutation, invoke the save handler for persistence
      this._saveHandler?.(this._workspace);

      return true;
    } catch (err) {
      log.error(`Error applying operation ${name}:`, err);
      return false;
    }
  }

  getWorkspace(): Workspace {
    return this._workspace;
  }

  /**
   * Persist the current layout without mutating it. Used when the last window
   * of a workspace closes (so its grid stays in the file) and on app quit
   * (so all open windows are saved).
   */
  persist(): void {
    this._saveHandler?.(this._workspace);
  }

  setWorkspace(ws: Workspace): void {
    this._workspace = ws;
  }

  setBroadcast(fn: BroadcastFn): void {
    this._broadcast = fn;
  }

  /**
   * Register a callback invoked after every successful apply().
   * Used for state persistence (save to disk).
   */
  setSaveHandler(fn: (ws: Workspace) => void): void {
    this._saveHandler = fn;
  }

  /** Broadcast the current workspace state. */
  broadcast(): void {
    if (this._broadcast) {
      this._broadcast(JSON.stringify(this._workspace));
    }
  }
}
