/**
 * Manager-grid IPC — the manager window's open grid tabs, kept between
 * launches in the app-data root (`~/.openp41ge` release, `~/.openp41ge-dev`
 * dev): the manager is not bound to a workspace, so this is not under
 * `workspaces/`. The renderer owns the shape (and checks it on reading); this
 * stores it whole.
 */

import { ipcMain } from "electron";
import fs from "fs";
import path from "path";

/** The file, under the app-data root. */
export const MANAGER_GRID_FILE = "manager-grid.json";

/** The saved grid, or null when there is none or it cannot be read. */
export function readManagerGrid(openp41geDir: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(openp41geDir, MANAGER_GRID_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** Save the grid (written to a temporary file, then renamed into place). */
export function writeManagerGrid(openp41geDir: string, grid: unknown): void {
  fs.mkdirSync(openp41geDir, { recursive: true });
  const file = path.join(openp41geDir, MANAGER_GRID_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(grid, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function registerManagerGridHandlers(openp41geDir: string): void {
  ipcMain.handle("manager-grid:load", () => readManagerGrid(openp41geDir));
  ipcMain.handle("manager-grid:save", (_event, grid: unknown) => {
    writeManagerGrid(openp41geDir, grid);
  });
}
