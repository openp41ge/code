/**
 * Cmd+W target resolution — deterministic from the workspace + window id.
 *
 * Cmd+W closes the grid tab the user is CURRENTLY focused on (the active tab
 * of the focused column). Only tabs that live in the window's grid placements
 * are ever candidates — sidebar (system) tabs are never closed by Cmd+W. When
 * no grid tabs remain, the action is to close the window.
 *
 * (Back/Forward navigation is driven separately by TabActivationHistory, which
 * tracks the activation log; Cmd+W itself just closes the focused tab.)
 */

import type { Workspace } from "../../layout/types";
import { Openp41geTabsEventHandler } from "./openp41ge-tabs-event-handler";

export type CmdWTarget = { kind: "close-tab"; tabId: string } | { kind: "close-window" };

/**
 * Resolve the Cmd+W action for a workspace window.
 *
 * Closes the grid's ACTIVE tab in the focused column (defaulting to col 0,
 * then the first placement), so Cmd+W honours where the user is actually
 * looking instead of always closing the rightmost tab. Returns `null` when the
 * workspace or window is unknown (nothing to do).
 */
export function resolveCmdWTarget(ws: Workspace | null, windowId: string): CmdWTarget | null {
  if (!ws) return null;
  const win = ws.windows.find((w) => w.id === windowId);
  if (!win) return null;

  // The focused cell drives which tab is closed.
  const focusedCol = Openp41geTabsEventHandler.getLastFocusedCol(windowId);
  const placements = [...win.grid.placements].sort((a, b) => a.position.col - b.position.col);
  const placement =
    placements.find((pl) => pl.position.col === focusedCol) ??
    placements.find((pl) => pl.position.col === 0) ??
    placements[0];
  const activeTab = placement ? (placement.activeTabId ?? placement.tabIds[0]) : undefined;
  if (activeTab) return { kind: "close-tab", tabId: activeTab };

  return { kind: "close-window" };
}
