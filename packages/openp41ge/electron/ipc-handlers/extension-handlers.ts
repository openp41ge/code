/**
 * Extension IPC handlers — bridge the renderer (component event routing
 * and bootstrap) to the main-process ExtensionHostManager.
 *
 *   - `extension:dispatch` — route a component/command event to an extension
 *     main handler (the renderer's plugin/event-router seams into this).
 *   - `extension:get-active` — the active extensions, which the renderer
 *     pulls at bootstrap.
 */

import { ipcMain } from "electron";
import type { HandlerCaller, HandlerPayload } from "openp41ge-sdk";
import type { ExtensionHostManager } from "../../src/main/services/extension-host-manager.js";

export function registerExtensionHandlers(
  manager: ExtensionHostManager,
  /** What the platform provides about the window that dispatched a call. */
  callerFor: (event: { sender: Electron.WebContents }) => HandlerCaller = () => ({}),
): void {
  ipcMain.handle("extension:dispatch", (event, commandId: string, payload: HandlerPayload) => {
    return manager.dispatch(commandId, payload ?? {}, callerFor(event));
  });

  ipcMain.handle("extension:get-active", () => manager.activeExtensions());
}
