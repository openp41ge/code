/**
 * WorkspaceSessionStore — persists a workspace's layout session to its own
 * `.openp41ge-workspace` file.
 *
 * A `.openp41ge-workspace` file is the single source of truth for a workspace:
 * its manifest (name, repos) and its layout session (windows, grids, sidebars).
 * This store merges the current in-memory layout `Workspace` into the file's
 * manifest and writes it back, and reads a file back into a layout `Workspace`.
 *
 * Backed by an interface so tests can inject an in-memory store (SOLID "D").
 */

import fs from "fs";
import path from "path";
import {
  migrateWorkspaceFileData,
  workspaceToFileData,
  fileDataToWorkspace,
  serializeWorkspaceFile,
} from "../../layout/workspace-file.js";
import { createLogger } from "openp41ge-core-logger";
import type { WorkspaceFileData } from "../../layout/types.js";
import type { Workspace } from "../../layout/types.js";

const log = createLogger("openp41ge", "workspace-session-store");

export interface WorkspaceSessionStore {
  /** A path was bound to a window (so saves go to that file). */
  setCurrentWorkspacePath(workspacePath: string | null): void;
  /** The path currently bound, or null when no window shows a workspace. */
  getCurrentWorkspacePath(): string | null;
  /** Save the layout session into a specific workspace's file. */
  save(workspacePath: string, workspace: Workspace): void;
  /** Load the layout session from a workspace file, or null when unreadable. */
  load(workspacePath: string): Workspace | null;
}

/**
 * File-backed store. `serializeWorkspaceFile`/`deserializeWorkspaceFile` are
 * passed in (with a `splitWorkspaceFileData` helper for tests) so the store is
 * pure-ish and testable without touching disk.
 */
export class FileWorkspaceSessionStore implements WorkspaceSessionStore {
  private _currentWorkspacePath: string | null = null;

  constructor(
    private readonly readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf-8"),
    private readonly writeFile: (p: string, data: string) => void = (p, data) =>
      fs.writeFileSync(p, data, "utf-8"),
    private readonly exists: (p: string) => boolean = (p) => fs.existsSync(p),
  ) {}

  setCurrentWorkspacePath(workspacePath: string | null): void {
    this._currentWorkspacePath = workspacePath;
  }

  getCurrentWorkspacePath(): string | null {
    return this._currentWorkspacePath;
  }

  save(workspacePath: string, workspace: Workspace): void {
    if (!workspacePath) return; // No bound workspace → nothing to save (window-manager).
    const path = workspacePath;
    let base: WorkspaceFileData;
    try {
      base = migrateWorkspaceFileData(JSON.parse(this.readFile(path)));
    } catch {
      // File missing / unparseable — start from an empty manifest; the
      // session fields are rebuilt from the layout anyway.
      base = { id: "", version: 2, createdAt: new Date().toISOString(), dataDir: "", repos: [] };
    }
    const fileData = workspaceToFileData(workspace, base);
    this._writeAtomic(path, serializeWorkspaceFile(fileData));
  }

  load(workspacePath: string): Workspace | null {
    try {
      const data = migrateWorkspaceFileData(JSON.parse(this.readFile(workspacePath)));
      return fileDataToWorkspace(data);
    } catch (err) {
      log.warn("Failed to load workspace session; treating as no session:", workspacePath, err);
      return null;
    }
  }

  private _writeAtomic(target: string, contents: string): void {
    const dir = path.dirname(target);
    if (!this.exists(dir)) {
      // Create the directory if needed (defensive; normally exists).
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // Fall through — write may still succeed on an existing dir.
      }
    }
    const tmp = `${target}.tmp`;
    this.writeFile(tmp, contents);
    try {
      fs.renameSync(tmp, target);
    } catch (err) {
      // Fallback: write directly if rename fails.
      log.warn("Atomic rename failed; writing workspace session directly:", target, err);
      this.writeFile(target, contents);
    }
  }
}
