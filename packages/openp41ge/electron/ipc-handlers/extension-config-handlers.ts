/**
 * Extension config IPC handlers — the renderer side of extension config
 * (AGENTS.md §2.9) over the main-process ExtensionConfigService.
 *
 *   - `extension-config:register-schema` — a renderer entry's
 *     `registerConfigSchema` (a backend entry's goes through the host).
 *   - `extension-config:get` — an extension's merged config.
 *   - `extension-config:describe` — schema, defaults and the user's values,
 *     for the config editor (null without a schema).
 *   - `extension-config:set` — replace the user's values (validated).
 *   - `extension-config:changed` (main → every window) —
 *     `{ extensionId, config }` whenever an extension's merged config changes.
 */

import { ipcMain } from "electron";
import type { ConfigSchema } from "openp41ge-sdk";
import type { ExtensionConfigService } from "../../src/main/services/extension-config-service.js";
import { openp41geWindows } from "../window-manager.js";

export function registerExtensionConfigHandlers(store: ExtensionConfigService): void {
  ipcMain.handle("extension-config:register-schema", (_event, id: string, schema: ConfigSchema) =>
    store.registerSchema(id, schema),
  );
  ipcMain.handle("extension-config:get", (_event, id: string) => store.get(id));
  ipcMain.handle("extension-config:describe", (_event, id: string) => store.describe(id));
  ipcMain.handle("extension-config:set", (_event, id: string, overrides: Record<string, unknown>) =>
    store.setOverrides(id, overrides),
  );

  store.onChange((extensionId, config) => {
    for (const [, bw] of openp41geWindows) {
      try {
        bw.webContents.send("extension-config:changed", { extensionId, config });
      } catch {
        // window may be closing
      }
    }
  });
}
