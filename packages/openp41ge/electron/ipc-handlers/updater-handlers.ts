/**
 * Updater IPC handlers — let the renderer trigger an update check and observe
 * the auto-updater's status, so a Settings surface can surface update state.
 */

import { ipcMain } from "electron";
import type { AutoUpdaterService } from "../auto-updater-service.js";

export function registerUpdaterHandlers(updaterService: AutoUpdaterService): void {
  ipcMain.handle("updater:get-status", () => updaterService.getStatus());
  ipcMain.handle("updater:check", () => updaterService.checkForUpdates());
  ipcMain.handle("updater:get-current-version", () => updaterService.getCurrentVersion());
  ipcMain.handle("updater:download", () => updaterService.downloadUpdate());
  ipcMain.handle("updater:quit-and-install", () => updaterService.quitAndInstall());
}
