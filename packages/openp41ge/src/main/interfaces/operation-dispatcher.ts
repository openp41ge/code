/**
 * Workspace operation dispatcher.
 *
 * Applies operations from operations.ts to the workspace state
 * and broadcasts changes to all open windows.
 */

import type { Workspace } from "../../layout/types.js";

export type BroadcastFn = (serialized: string) => void;

export interface IOperationDispatcher {
  /** Apply a named operation with arguments. Returns true on success. */
  apply(name: string, args: unknown[]): boolean;

  /**
   * Persist the current workspace layout without mutating it (used when the
   * workspace's last window closes, or on app quit, so the file keeps all
   * windows instead of the default behaviour of removing the closed one).
   */
  persist(): void;

  /** Get the current workspace state. */
  getWorkspace(): Workspace;

  /** Set the workspace state (used during initialization). */
  setWorkspace(ws: Workspace): void;

  /** Register a broadcast callback for state updates. */
  setBroadcast(fn: BroadcastFn): void;

  /** Register a callback invoked after every successful apply(). */
  setSaveHandler(fn: (ws: Workspace) => void): void;
}
