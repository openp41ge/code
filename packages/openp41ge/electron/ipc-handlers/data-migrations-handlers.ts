/**
 * Data-migrations IPC — the manager window's Migrations tab reads what the
 * data migrations did: the app's version, the data version, and the journal.
 */

import { app, ipcMain } from "electron";
import {
  readDataVersion,
  readJournal,
} from "../../src/main/services/migrations/pending-migrations.js";

export function registerDataMigrationsHandlers(dataDir: string): void {
  ipcMain.handle("data-migrations:status", () => {
    const journal = readJournal(dataDir);
    const dataVersion = readDataVersion(dataDir);
    return {
      appVersion: app.getVersion(),
      ...(dataVersion ? { dataVersion } : {}),
      applied: journal.applied,
      ...(journal.failed ? { failed: journal.failed } : {}),
    };
  });
}
