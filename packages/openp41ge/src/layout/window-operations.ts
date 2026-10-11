/**
 * Window operations — add, close, move, detach windows.
 */

import type { Workspace, Bounds, OverlayPosition, OverlayId, Tab, TabId } from "./types.js";
import { createWindow as makeWindow, createOverlayData as makeOverlay } from "./types.js";
import { mapWindow, findTabLocation } from "./common.js";
import { removeTabFromCell, addTabToCell, registerTab } from "./tab-operations.js";

export function addWindow(
  workspace: Workspace,
  id: string,
  bounds?: Bounds,
  monitor?: number,
): Workspace {
  const win = makeWindow(id, bounds, monitor);
  return { ...workspace, windows: [...workspace.windows, win] };
}

export function closeWindow(workspace: Workspace, windowId: string): Workspace {
  return {
    ...workspace,
    windows: workspace.windows.filter((w) => w.id !== windowId),
  };
}

export function moveWindow(
  workspace: Workspace,
  windowId: string,
  bounds: Bounds,
  monitor?: number,
): Workspace {
  return mapWindow(workspace, windowId, (win) => ({
    ...win,
    bounds,
    monitor: monitor ?? win.monitor,
  }));
}

export function detachTabToWindow(
  workspace: Workspace,
  windowId: string,
  tabId: string,
  bounds?: Bounds,
): Workspace {
  const source = findTabLocation(workspace, tabId);
  if (!source) return workspace;

  let result = removeTabFromCell(workspace, source.windowId, tabId);
  const tab = result.editorTabs[tabId as TabId];
  if (!tab) return workspace;

  const newWinId = `win-${tabId}`;
  result = addWindow(result, newWinId, bounds);

  return addTabToCell(result, newWinId, tab, 0, 0);
}

export function newWindow(workspace: Workspace): Workspace {
  const newWinId = `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return addWindow(workspace, newWinId);
}

// ─── Overlay operations ───────────────────────────────────────────────────

export function createOverlay(
  workspace: Workspace,
  windowId: string,
  tab: Tab,
  position: OverlayPosition = "bottom-right",
): Workspace {
  let result = workspace;
  if (!result.editorTabs[tab.id]) {
    result = registerTab(result, tab);
  }

  return mapWindow(result, windowId, (win) => {
    const overlayId = `overlay-${tab.id}` as OverlayId;
    const overlay = makeOverlay(overlayId, tab, position);
    return { ...win, overlays: [...win.overlays, overlay] };
  });
}

export function removeOverlay(
  workspace: Workspace,
  windowId: string,
  overlayId: string,
): Workspace {
  return mapWindow(workspace, windowId, (win) => ({
    ...win,
    overlays: win.overlays.filter((o) => o.id !== overlayId),
  }));
}

export function moveOverlay(
  workspace: Workspace,
  windowId: string,
  overlayId: string,
  position: { x: number; y: number },
): Workspace {
  return mapWindow(workspace, windowId, (win) => ({
    ...win,
    overlays: win.overlays.map((o) => (o.id === overlayId ? { ...o, position } : o)),
  }));
}
