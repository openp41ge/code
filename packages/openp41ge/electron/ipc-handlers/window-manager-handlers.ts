/**
 * Window-manager IPC handlers — open/focus the Window Manager window, list open
 * windows, and open a workspace-bound window from the Window Manager.
 */

import { ipcMain, BrowserWindow } from "electron";
import { createLogger } from "openp41ge-core-logger";
import {
  openWindowManager,
  openLogsWindow,
  getOpenWindowSummaries,
  openWorkspaceWindow,
  focusWorkspaceWindow,
  createWindowManagerWindow,
  openp41geWindows,
  openp41geWindowMeta,
} from "../window-manager.js";

const log = createLogger("openp41ge", "window-manager-handlers");

const MANAGER_TAB_IDS = ["workspaces", "settings", "welcome", "releases"] as const;
type ManagerTab = (typeof MANAGER_TAB_IDS)[number];

function isManagerTabId(id: string): id is ManagerTab {
  return (MANAGER_TAB_IDS as readonly string[]).includes(id);
}

/** True if the BrowserWindow matching `id` is a live window-manager window. */
function _isLiveManagerWindow(id: string): BrowserWindow | null {
  const bw = openp41geWindows.get(id);
  if (!bw || bw.isDestroyed()) return null;
  if (openp41geWindowMeta.get(id)?.windowType !== "manager") return null;
  return bw;
}

export function registerWindowManagerHandlers(): void {
  ipcMain.on("window-manager:open", (event) => {
    openWindowManager(BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });

  ipcMain.on("logs-window:open", (event, target: unknown) => {
    const errorId = (target as { errorId?: unknown } | null)?.errorId;
    openLogsWindow(
      BrowserWindow.fromWebContents(event.sender) ?? undefined,
      typeof errorId === "string" && errorId ? errorId : undefined,
    );
  });

  ipcMain.handle("window-manager:open-window-summaries", () => {
    return getOpenWindowSummaries();
  });

  ipcMain.handle("window-manager:focus-workspace-window", (_event, workspacePath: string) => {
    if (typeof workspacePath !== "string" || workspacePath.length === 0) return false;
    return focusWorkspaceWindow(workspacePath);
  });

  ipcMain.on("window-manager:open-workspace-window", (event, workspacePath: string) => {
    if (typeof workspacePath !== "string" || workspacePath.length === 0) return;
    openWorkspaceWindow(workspacePath, BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });

  // ── Management-tab drag & drop ────────────────────────────────────────

  /** Move a management tab from one manager window to another (or reorder in
   *  place). Each manager window owns its own tab state (they are not part of
   *  the workspace layout), so the move is coordinated here: the target window
   *  receives the tab, the source window removes it. */
  ipcMain.on("window-manager:move-tab", (_event, data: string) => {
    let parsed: { sourceWinId?: string; targetWinId?: string; tabId?: string; dropIndex?: number };
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      log.warn("window-manager:move-tab received malformed JSON:", data, err);
      return;
    }
    const { sourceWinId, targetWinId, tabId } = parsed;
    const dropIndex = typeof parsed.dropIndex === "number" ? Math.max(0, parsed.dropIndex) : 0;
    if (!tabId || !isManagerTabId(tabId) || !targetWinId) return;
    const target = _isLiveManagerWindow(targetWinId);
    const source = _isLiveManagerWindow(sourceWinId ?? "");
    if (target) {
      target.webContents.send(
        "window-manager:receive-tab",
        JSON.stringify({ tabId, index: dropIndex }),
      );
    }
    // Move semantics: the source (unless it is the same window) drops the tab.
    if (source && source !== target && sourceWinId !== targetWinId) {
      source.webContents.send("window-manager:remove-tab", JSON.stringify({ tabId }));
    }
  });

  /** Detach a management tab out into a NEW management window containing that
   *  tab, positioned near the drop point, and remove it from the source. */
  ipcMain.on("window-manager:open-with-tab", (event, data: string) => {
    let parsed: {
      sourceWinId?: string;
      tabId?: string;
      dropScreenX?: number;
      dropScreenY?: number;
    };
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      log.warn("window-manager:open-with-tab received malformed JSON:", data, err);
      return;
    }
    const { sourceWinId, tabId, dropScreenX, dropScreenY } = parsed;
    if (!tabId || !isManagerTabId(tabId)) return;
    const source = BrowserWindow.fromWebContents(event.sender);
    createWindowManagerWindow(
      source ?? undefined,
      tabId,
      typeof dropScreenX === "number" ? dropScreenX : undefined,
      typeof dropScreenY === "number" ? dropScreenY : undefined,
    );
    const src = sourceWinId ? _isLiveManagerWindow(sourceWinId) : null;
    // Drag-out always removes the tab from the source (the sender is the source
    // window). Send to whichever BrowserWindow is the live source.
    const sourceBw = src ?? source;
    if (sourceBw && !sourceBw.isDestroyed()) {
      sourceBw.webContents.send("window-manager:remove-tab", JSON.stringify({ tabId }));
    }
  });
}
