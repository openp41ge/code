/**
 * Dispatch handler — core workspace dispatch, state queries, confirm modals.
 *
 * Multi-workspace: each handler resolves the OperationDispatcher responsible
 * for the *sending window* (its bound workspace path), so several workspaces
 * can be open simultaneously with independent state.
 */

import { ipcMain, BrowserWindow, type IpcMainEvent } from "electron";
import type { OperationDispatcher } from "../../src/main/index.js";
import {
  openp41geWindows,
  createOpenp41geWindow,
  closeOrphanedWindows,
  workspacePathForSender,
} from "../window-manager.js";
import { showConfirm } from "../confirm-dialog-manager.js";

/** Resolve the dispatcher for the window that sent an IPC message. */
export type DispatcherResolver = (event: {
  sender: Electron.WebContents;
}) => OperationDispatcher | null;

export function registerDispatchHandlers(resolve: DispatcherResolver): void {
  ipcMain.handle("openp41ge:get-state", (event) => {
    const d = resolve(event);
    return JSON.stringify(d?.getWorkspace() ?? null);
  });

  ipcMain.on("openp41ge:dispatch", (event: IpcMainEvent, payload: string) => {
    const d = resolve(event);
    if (!d) return;
    const { fn, args } = JSON.parse(payload);
    if (d.apply(fn, args)) {
      d.broadcast();
      closeOrphanedWindows(workspacePathForSender(event));

      if (fn === "detachTabToWindow" || fn === "actionOpenFileInNewWindow") {
        const ws = d.getWorkspace();
        const existingIds = new Set<string>();
        for (const [id] of openp41geWindows) existingIds.add(id);
        const newWin = ws.windows.find((w) => !existingIds.has(w.id));
        if (newWin) {
          const src = BrowserWindow.fromWebContents(event.sender);
          // actionOpenFileInNewWindow carries [filePath, fileName, sourceWinId,
          // dropScreenX, dropScreenY] — coords are the last two args (indices 3/4).
          const dropScreenX =
            fn === "actionOpenFileInNewWindow" && args.length >= 5 ? Number(args[3]) : undefined;
          const dropScreenY =
            fn === "actionOpenFileInNewWindow" && args.length >= 5 ? Number(args[4]) : undefined;
          createOpenp41geWindow(
            newWin.id,
            false,
            src ?? undefined,
            dropScreenX !== undefined && isFinite(dropScreenX) ? dropScreenX : undefined,
            dropScreenY !== undefined && isFinite(dropScreenY) ? dropScreenY : undefined,
            // Bind the new window to the sender's workspace: its layout lives in
            // that workspace's dispatcher, so an unbound window would fall back
            // to the first window's state (no file, no workspace title).
            { workspacePath: workspacePathForSender(event) },
          );
        }
      }
    }
  });

  ipcMain.on("openp41ge:create-window", (event: IpcMainEvent, data: string) => {
    const d = resolve(event);
    if (!d) return;
    const {
      type: _type,
      windowId,
      _paneId,
      tabId,
      bounds,
      dropScreenX,
      dropScreenY,
    } = JSON.parse(data);
    d.apply("detachTabToWindow", [windowId, tabId, bounds]);
    const ws = d.getWorkspace();
    const newWin = ws.windows[ws.windows.length - 1];
    if (newWin) {
      d.broadcast();
      closeOrphanedWindows(workspacePathForSender(event));
      const src = BrowserWindow.fromWebContents(event.sender);
      // Use the true screen coordinates if provided, falling back to
      // bounds.x/y (which may have a -50px offset baked in).
      const sx = dropScreenX !== undefined && isFinite(dropScreenX) ? dropScreenX : bounds?.x;
      const sy = dropScreenY !== undefined && isFinite(dropScreenY) ? dropScreenY : bounds?.y;
      createOpenp41geWindow(newWin.id, false, src ?? undefined, sx, sy, {
        workspacePath: workspacePathForSender(event),
      });
    }
  });

  ipcMain.handle("openp41ge:confirm-remove-tab", async (event, data: string) => {
    const d = resolve(event);
    if (!d) return false;
    const { windowId, tabId } = JSON.parse(data);
    const ws = d.getWorkspace();
    const win = ws.windows.find((w) => w.id === windowId);
    const hasTab = win?.grid.placements.some((pl) => pl.tabIds.includes(tabId));

    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw || !hasTab) return false;
    const { confirmed } = await showConfirm(bw, {
      title: "Close tab?",
      message: "Are you sure you want to close this tab?",
      confirmLabel: "Close Tab",
    });

    if (confirmed) {
      d.apply("removeTabFromCell", [windowId, tabId]);
      d.broadcast();
      return true;
    }
    return false;
  });
}
