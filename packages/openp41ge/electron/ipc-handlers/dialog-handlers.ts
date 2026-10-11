/**
 * Dialog IPC handlers — native file dialogs for workspace file management.
 */

import { ipcMain, dialog, shell } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "openp41ge-core-logger";
import { sortWorkspacesByLastActivated } from "../../src/layout/workspace-sort.js";
import type { WorkspaceFileData } from "../../src/layout/types.js";
import {
  migrateWorkspaceFileData,
  serializeWorkspaceFile,
} from "../../src/layout/workspace-file.js";

const log = createLogger("openp41ge", "dialog-handlers");

const WORKSPACE_EXT = "openp41ge-workspace";

/** Resolve a path starting with ~/ to the user's home directory. */
function resolveTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/** Read and parse a .openp41ge-workspace file, returning v2 data (migrated). */
function readWorkspaceFile(filePath: string): WorkspaceFileData {
  const raw = fs.readFileSync(filePath, "utf-8");
  return migrateWorkspaceFileData(JSON.parse(raw));
}

export function registerDialogHandlers(openp41geDir: string): void {
  // ── Open workspace file ──────────────────────────────────────────────

  ipcMain.handle("dialog:openWorkspaceFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "openp41ge Workspace", extensions: [WORKSPACE_EXT] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const data = readWorkspaceFile(filePath);
      return { filePath, data };
    } catch (err) {
      console.error("Failed to read workspace file:", err);
      return null;
    }
  });

  // ── Save workspace file ──────────────────────────────────────────────

  ipcMain.handle(
    "dialog:saveWorkspaceFile",
    async (_event, data: WorkspaceFileData, defaultPath?: string) => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultPath ?? path.join(openp41geDir, "workspaces"),
        filters: [{ name: "openp41ge Workspace", extensions: [WORKSPACE_EXT] }],
      });
      if (result.canceled || !result.filePath) return null;
      const filePath = result.filePath;
      // Ensure the extension is present
      const finalPath = filePath.endsWith(`.${WORKSPACE_EXT}`)
        ? filePath
        : `${filePath}.${WORKSPACE_EXT}`;
      try {
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        fs.writeFileSync(finalPath, serializeWorkspaceFile(data), "utf-8");
        return finalPath;
      } catch (err) {
        console.error("Failed to write workspace file:", err);
        return null;
      }
    },
  );

  // ── Pick folder (for data dir) ───────────────────────────────────────

  ipcMain.handle("dialog:pickFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ── Direct read (no dialog — known path) ───────────────────────────────

  ipcMain.handle("dialog:readWorkspaceFile", async (_event, filePath: string) => {
    try {
      const resolved = resolveTilde(filePath);
      const data = readWorkspaceFile(resolved);
      return { filePath, data };
    } catch (err) {
      console.error("Failed to read workspace file:", err);
      return null;
    }
  });

  // ── Direct write (no dialog — known path) ──────────────────────────────

  ipcMain.handle(
    "dialog:writeWorkspaceFile",
    async (_event, filePath: string, data: WorkspaceFileData) => {
      try {
        const resolved = resolveTilde(filePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, serializeWorkspaceFile(data), "utf-8");
        return true;
      } catch (err) {
        console.error("Failed to write workspace file:", err);
        return false;
      }
    },
  );

  // ── Create draft directory (create dataDir) ────────────────────────────

  ipcMain.handle("dialog:ensureDir", async (_event, dirPath: string) => {
    try {
      const resolved = resolveTilde(dirPath);
      fs.mkdirSync(resolved, { recursive: true });
      return true;
    } catch (err) {
      log.warn("ensureDir failed:", dirPath, err);
      return false;
    }
  });

  // ── Reveal in Finder ────────────────────────────────────────────────

  ipcMain.handle("dialog:revealInFinder", async (_event, filePath: string) => {
    try {
      const resolved = filePath.startsWith("~")
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;
      shell.showItemInFolder(resolved);
      return true;
    } catch (err) {
      log.warn("revealInFinder failed:", filePath, err);
      return false;
    }
  });

  // ── List all workspace files in the app-data workspaces dir ───────

  ipcMain.handle("dialog:listWorkspaces", async () => {
    const dir = path.join(openp41geDir, "workspaces");
    try {
      if (!fs.existsSync(dir)) return [];
      const files = fs.readdirSync(dir);
      const workspaces: Array<{ filePath: string; data: WorkspaceFileData }> = [];
      for (const file of files) {
        if (!file.endsWith(`.${WORKSPACE_EXT}`)) continue;
        const filePath = path.join(dir, file);
        try {
          const data = readWorkspaceFile(filePath);
          workspaces.push({ filePath, data });
        } catch (err) {
          log.warn("skipping unparseable workspace file:", filePath, err);
        }
      }
      // Sort by last activated (epoch fallback), tie-broken alphabetically by name.
      workspaces.sort((a, b) => sortWorkspacesByLastActivated(a.data, b.data));
      return workspaces;
    } catch (err) {
      log.error("listWorkspaces failed:", err);
      return [];
    }
  });

  // ── Delete workspace file (optionally incl. data dir) ─────────────

  ipcMain.handle(
    "dialog:deleteWorkspaceFile",
    async (_event, filePath: string, deleteData?: boolean) => {
      try {
        const resolved = resolveTilde(filePath);
        // Only delete files (guard against misdirected directory paths)
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return false;

        if (deleteData) {
          // Remove the workspace's data directory, derived from the file contents.
          try {
            const data = readWorkspaceFile(resolved);
            if (data.dataDir) {
              const dataDirResolved = resolveTilde(data.dataDir);
              if (fs.existsSync(dataDirResolved)) {
                fs.rmSync(dataDirResolved, { recursive: true, force: true });
              }
            }
          } catch (err) {
            console.error("Failed to remove workspace data dir:", err);
          }
        }

        fs.rmSync(resolved, { force: true });
        return true;
      } catch (err) {
        console.error("Failed to delete workspace file:", err);
        return false;
      }
    },
  );
}
