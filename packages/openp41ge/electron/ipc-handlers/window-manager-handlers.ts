/**
 * Window IPC handlers — open logs in a window, move a grid tab to another
 * window, list open windows, and open or focus a workspace's window.
 */

import { ipcMain, BrowserWindow } from "electron";
import {
  openLogs,
  getOpenWindowSummaries,
  openWorkspaceWindow,
  focusWorkspaceWindow,
  openp41geWindowMeta,
  resolveDispatcherFor,
} from "../window-manager.js";
import { moveTabAcrossWindows, type CrossWindowTabMove } from "../cross-window-tab-move.js";

export function registerWindowManagerHandlers(): void {
  ipcMain.on("logs:open", (event, target: unknown) => {
    const errorId = (target as { errorId?: unknown } | null)?.errorId;
    openLogs(
      BrowserWindow.fromWebContents(event.sender) ?? undefined,
      typeof errorId === "string" && errorId ? errorId : undefined,
    );
  });

  // A grid tab dropped on another window's grid.
  ipcMain.handle("tab:move-to-window", (_event, move: unknown, freeAppTypes: unknown) => {
    const m = move as CrossWindowTabMove | null;
    if (
      !m ||
      typeof m.sourceWinId !== "string" ||
      typeof m.tabId !== "string" ||
      typeof m.targetWinId !== "string" ||
      typeof m.col !== "number" ||
      typeof m.index !== "number" ||
      !Array.isArray(freeAppTypes)
    ) {
      return "refused";
    }
    return moveTabAcrossWindows(
      m,
      (winId) => {
        const meta = openp41geWindowMeta.get(winId);
        return meta ? resolveDispatcherFor(meta.workspacePath) : null;
      },
      freeAppTypes.filter((t): t is string => typeof t === "string"),
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
}
