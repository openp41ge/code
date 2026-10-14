/**
 * Data-migrations IPC — the Migrations tab reads a summary
 * of the data updates: the app's version, the data version, how many ran and
 * when, and whether the last run failed (not the journal's details).
 */

import { app, ipcMain } from "electron";
import {
  readDataVersion,
  readJournal,
} from "../../src/main/services/migrations/pending-migrations.js";
import { migrationsSummary } from "../../src/main/services/migrations/window-view.js";

export function registerDataMigrationsHandlers(dataDir: string): void {
  ipcMain.handle("data-migrations:status", () =>
    migrationsSummary(readJournal(dataDir), app.getVersion(), readDataVersion(dataDir)),
  );
}
