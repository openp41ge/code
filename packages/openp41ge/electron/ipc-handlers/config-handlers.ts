/**
 * Config IPC handlers — read/write user config via the main process ConfigService.
 */

import { ipcMain } from "electron";
import type { ConfigService } from "../../src/main/services/config-service.js";
import { openp41geWindows } from "../window-manager.js";

export function registerConfigHandlers(configService: ConfigService): void {
  ipcMain.handle("config:get", (_event, key?: string) => {
    return configService.get(key);
  });

  ipcMain.handle("config:set", (event, key: string, value: unknown) => {
    configService.set(key, value);
    // Broadcast the change to every OTHER window so each renderer's live config
    // cache and listeners (e.g. editors re-applying the editor font size) pick
    // it up. The sender window already handled it locally via its config
    // service `set`, so it is skipped to avoid a duplicate change event.
    const payload = JSON.stringify({ key, value });
    for (const [, bw] of openp41geWindows) {
      if (bw.webContents === event.sender) continue;
      try {
        bw.webContents.send("config:changed", payload);
      } catch {
        // window may be closing
      }
    }
  });

  ipcMain.handle("config:get-all", () => {
    return configService.getAll();
  });

  ipcMain.handle("config:get-defaults", () => {
    return configService.getDefaults();
  });

  ipcMain.handle("config:get-overrides", () => {
    return configService.getOverrides();
  });
}
