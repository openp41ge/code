/**
 * Releases IPC handlers — the Releases tab reads which releases exist (the
 * background-checked list) and can ask for a check now. Changes are pushed as
 * `releases:changed`.
 */

import { ipcMain } from "electron";
import type { ReleasesFeed } from "../releases-feed.js";

export function registerReleasesHandlers(feed: ReleasesFeed): void {
  ipcMain.handle("releases:get", () => feed.snapshot());
  ipcMain.handle("releases:refresh", () => feed.refresh());
}
