/**
 * Terminal IPC handlers.
 */

import { ipcMain } from "electron";
import type { TerminalManager } from "../../src/main/index.js";
import { openp41geWindows } from "../window-manager.js";

export function registerTerminalHandlers(terminalManager: TerminalManager): void {
  ipcMain.on("terminal:spawn", (_event, paneId: string) => {
    terminalManager.spawn(paneId);
  });

  ipcMain.on("terminal:write", (_event, payload: string) => {
    const { paneId, data } = JSON.parse(payload);
    terminalManager.write(paneId, data);
  });

  ipcMain.on("terminal:resize", (_event, payload: string) => {
    const { paneId, cols, rows } = JSON.parse(payload);
    terminalManager.resize(paneId, cols, rows);
  });

  ipcMain.on("terminal:kill", (_event, paneId: string) => {
    terminalManager.kill(paneId);
  });

  // Set up terminal data forwarding to all windows
  terminalManager.onData((output) => {
    const payload = JSON.stringify(output);
    for (const bw of openp41geWindows.values()) {
      if (!bw.isDestroyed()) {
        bw.webContents.send("terminal:data", payload);
      }
    }
  });

  terminalManager.onExit((info) => {
    const payload = JSON.stringify(info);
    for (const bw of openp41geWindows.values()) {
      if (!bw.isDestroyed()) {
        bw.webContents.send("terminal:exit", payload);
      }
    }
  });
}
