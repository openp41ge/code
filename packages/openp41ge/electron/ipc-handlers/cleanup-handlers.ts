/**
 * Cleanup IPC — the manager window's Cleanup tab.
 *
 * The platform's repository cleanup deletes what no workspace uses and keeps
 * (lists) what holds work; the tab shows that list and lets the user delete
 * an item or show it in Finder. Delete / reveal accept only a listed item.
 */

import { ipcMain } from "electron";
import type { RepositoryCleanup } from "../../src/main/services/repository-cleanup.js";

export function registerCleanupHandlers(
  cleanup: RepositoryCleanup,
  reveal: (folder: string) => void,
): void {
  ipcMain.handle("cleanup:list", () => cleanup.list());

  ipcMain.handle("cleanup:run", async () => (await cleanup.run()).kept);

  // The renderer has asked the user.
  ipcMain.handle("cleanup:delete", (_event, folder: string) => cleanup.delete(folder));

  ipcMain.handle("cleanup:reveal", (_event, folder: string) => {
    if (!cleanup.list().some((item) => item.path === folder)) return false;
    reveal(folder);
    return true;
  });
}
