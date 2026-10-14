/**
 * RegisterTabActivationRecorderStep — records *new* tab activations into
 * TabActivationHistory.
 *
 * Tab clicks and "activate an existing tab" actions are recorded at the point
 * of dispatch (grid-activate in Openp41geTabsEventHandler, and activateTabInCell
 * in CommandBus). This step covers the one activation that cannot be known at
 * dispatch time: opening a **brand-new** tab, because the new tab id is only
 * generated in the main process and only becomes visible once the workspace
 * state updates.
 *
 * It observes the workspace state and records tabs that newly appear. Crucially
 * it does NOT record active-tab *switches* — closing a tab sets the survivor
 * active, and back/forward navigation also changes the active tab, neither of
 * which is a fresh activation. The very first state observation is used as a
 * baseline and seeds only the grid's currently-active tab as the history's
 * current position (not a navigation chain), so Cmd+W and Back/Forward have a
 * correct starting point for a restored workspace.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import type { Workspace } from "../../../layout/types";
import { TabActivationHistory } from "../../services/tab-activation-history";
import { Openp41geTabsEventHandler } from "../../services/openp41ge-tabs-event-handler";

export class RegisterTabActivationRecorderStep implements IStartupStep {
  readonly name = "register-tab-activation-recorder";

  private _knownTabs = new Set<string>();
  private _initialised = false;

  async run(context: StartupContext): Promise<void> {
    context.workspaceState.subscribe((ws) => {
      this._observe(context, ws);
    });
  }

  private _windowId(context: StartupContext): string | null {
    return context.windowId ?? window.openp41ge?.workspace?.getWindowId?.() ?? null;
  }

  private _observe(context: StartupContext, ws: Workspace): void {
    const winId = this._windowId(context);
    if (!winId) return;

    const win = ws.windows.find((w) => w.id === winId);
    if (!win) return;

    const openTabs = new Set<string>();
    for (const pl of win.grid.placements) {
      for (const id of pl.tabIds) openTabs.add(id as string);
    }

    const isFirst = !this._initialised;
    this._initialised = true;

    // Baseline on first observation. A restored workspace is not seeded as a
    // *navigation chain* (no user activations have happened yet), but the
    // currently-active tab is still tracked as the history's current position
    // so Cmd+W closes the tab the user is actually looking at rather than the
    // rightmost, and Back/Forward have a correct starting point.
    if (isFirst) {
      this._knownTabs = openTabs;
      const activeTab = this._activeTabFor(win, winId);
      if (activeTab) TabActivationHistory.pushActivation(winId, activeTab);
      return;
    }

    // The activation log is append-only and immutable: closing a tab does NOT
    // remove its entries (Back/Forward simply skip closed tabs).

    // Record newly-appeared tabs (user-opened). A new tab is never a side
    // effect of a close, so this is always a genuine activation.
    for (const tabId of openTabs) {
      if (!this._knownTabs.has(tabId)) {
        TabActivationHistory.pushActivation(winId, tabId);
      }
    }

    this._knownTabs = openTabs;
  }

  /**
   * Resolve the grid's currently-active tab (focused column, defaulting to
   * col 0) for the history baseline. Returns the placement's `activeTabId`
   * (or its first tab) so Cmd+W targets the tab that is actually visible.
   */
  private _activeTabFor(win: Workspace["windows"][number], winId: string): string | null {
    const focusedCol = Openp41geTabsEventHandler.getLastFocusedCol(winId);
    const placements = [...win.grid.placements].sort((a, b) => a.position.col - b.position.col);
    const placement =
      placements.find((pl) => pl.position.col === focusedCol) ??
      placements.find((pl) => pl.position.col === 0) ??
      placements[0];
    if (!placement) return null;
    return (placement.activeTabId ?? placement.tabIds[0]) as string;
  }
}
