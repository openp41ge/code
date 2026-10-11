import type { ICommandBus } from "../interfaces/command-bus";
import type { Workspace } from "../../layout/types";
import { TabActivationHistory } from "./tab-activation-history";

/**
 * Command bus implementation — dispatches operations via the Electron preload bridge.
 *
 * It also keeps the tab activation history in sync:
 *   - `activateTabInCell` is the single canonical "make a tab active"
 *     operation, so recording here covers every source of a switch (clicking a
 *     tab, double-clicking an already-open file/commit/chat, opening from the
 *     tree, etc.) in one place. Because history playback (Back/Forward) sets
 *     the current tab *before* dispatching `activateTabInCell`, re-pushing is a
 *     safe no-op there.
 *   - `removeTabFromCell` is the single canonical "close a grid tab"
 *     operation, so on close we focus the PREVIOUS open entry in the
 *     activation log (instead of the layout's next tab). The chosen tab is
 *     injected as the operation's `focusTabId` so the grid activates it.
 */
export class CommandBus implements ICommandBus {
  private _getWorkspace: (() => Workspace | null) | null = null;

  /** Provide a live workspace getter so close-focus can be resolved. */
  setWorkspaceGetter(fn: () => Workspace | null): void {
    this._getWorkspace = fn;
  }

  dispatch(fn: string, ...args: unknown[]): void {
    if (fn === "activateTabInCell" && typeof args[0] === "string" && typeof args[1] === "string") {
      TabActivationHistory.pushActivation(args[0], args[1]);
    }

    let dispatchedArgs = args;
    if (fn === "removeTabFromCell" && typeof args[0] === "string" && typeof args[1] === "string") {
      const [winId, tabId] = args as [string, string];
      const prevTab = this._previousOpenInCell(winId, tabId);
      if (prevTab) dispatchedArgs = [winId, tabId, prevTab];
    }

    window.openp41ge.workspace.dispatch(fn, ...dispatchedArgs);
  }

  /**
   * Resolve the tab to focus when `tabId` is closed: the previous OPEN entry in
   * the activation log that lives in the SAME cell as the closed tab (so the
   * `focusTabId` is honoured by removeTabFromCell). Advances the history focus
   * position to that entry. Returns null when there is none.
   */
  private _previousOpenInCell(winId: string, tabId: string): string | null {
    const ws = this._getWorkspace?.();
    const win = ws?.windows.find((w) => w.id === winId);
    const cell = win?.grid.placements.find((p) => (p.tabIds as string[]).includes(tabId));
    if (!cell) return null;
    const isOpen = (t: string) => (cell.tabIds as string[]).includes(t);
    return TabActivationHistory.focusPreviousOpen(winId, tabId, isOpen);
  }
}
