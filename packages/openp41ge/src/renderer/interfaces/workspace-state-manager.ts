import type { Workspace, Rect } from "../../layout/types";

/**
 * Observable workspace state manager.
 *
 * Wraps the module-level `workspace` and `computedLayouts` state
 * from app.ts into an observable class.
 *
 * Components subscribe to state changes instead of being called
 * by a central render() function.
 */
export interface IWorkspaceStateManager {
  /** Set the workspace state and recompute layouts. Triggers notifications. */
  setState(ws: Workspace): void;

  /** Get the current workspace state. */
  getWorkspace(): Workspace | null;

  /** Get the current computed layouts (Map<windowId, Map<tabId, Rect>>). */
  getLayouts(): Map<string, Map<string, Rect>>;

  /** Subscribe to workspace state changes. Returns unsubscribe function. */
  subscribe(callback: (ws: Workspace) => void): () => void;
}
