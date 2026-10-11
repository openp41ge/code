/**
 * Log IPC handlers — the log bus ⇄ main-process bridge.
 *
 *   log:append       (fire-and-forget)  renderer → main, batched persisted entries
 *   log:set-debug    (fire-and-forget)  renderer session-debug toggle → main capture level
 *   log:query        (handle)           persisted history query (agent / overlay)
 *   log:path         (handle)           logs directory path
 *   log:files        (handle)           list log files (+ sizes, mtimes)
 */

import { ipcMain, type IpcMainEvent } from "electron";
import { LogLevel, setMinLevel, subscribeLogs } from "openp41ge-core-logger";
import type { LogFileStore, LogBackCursor } from "../../src/main/services/log-file-store.js";
import type { StoredLogEntry } from "openp41ge-core-logger";

export function registerLogHandlers(logStore: LogFileStore): void {
  // Persist main-process log bus output directly to disk.
  subscribeLogs((entry) => {
    if (entry) logStore.append(entry);
  });

  ipcMain.on("log:append", (_event: IpcMainEvent, payload: unknown) => {
    try {
      const entries = payload as StoredLogEntry[];
      if (Array.isArray(entries)) {
        logStore.appendBatch(entries);
      }
    } catch {
      // never let persistence failures propagate to the renderer
    }
  });

  ipcMain.on("log:set-debug", (_event: IpcMainEvent, enabled: unknown) => {
    setMinLevel(enabled === true ? LogLevel.DEBUG : LogLevel.INFO);
  });

  ipcMain.handle("log:query", (_event, filter: unknown) => {
    try {
      return logStore.query((filter ?? {}) as Parameters<LogFileStore["query"]>[0]);
    } catch {
      return [];
    }
  });

  ipcMain.handle("log:path", () => {
    // Advertise which log features this main process supports. Older main
    // processes (started before log:read-backward) omit `capabilities`, which
    // lets the renderer's LogFilePageReader detect the staleness probe safely
    // and fall back to the in-memory bus instead of calling a missing IPC
    // that would flood the error overlay.
    return {
      logsDir: logStore.logsDir,
      capabilities: { readBackward: true },
    };
  });

  ipcMain.handle("log:files", () => {
    try {
      return logStore.listFiles();
    } catch {
      return [];
    }
  });

  ipcMain.handle("log:read-backward", (_event, payload: unknown) => {
    try {
      const { cursor, limit } = (payload ?? {}) as {
        cursor?: LogBackCursor | null;
        limit?: number;
      };
      return logStore.readLogsBackward(cursor ?? null, limit ?? 200);
    } catch {
      return { entries: [], hasOlder: false, cursor: null, nextDay: null };
    }
  });

  ipcMain.handle("log:find-error", (_event, errorId: unknown) => {
    try {
      return typeof errorId === "string" ? logStore.findError(errorId) : null;
    } catch {
      return null;
    }
  });
}
