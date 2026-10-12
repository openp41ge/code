/**
 * WorkspaceStateStore — persists the full workspace state (grid layouts,
 * openp41ge names, tabs, window positions) to disk as JSON.
 *
 * On each mutation, the entire workspace is serialized and written atomically.
 * On startup, the last saved state is restored.
 *
 * Stored under the resolved app-data root (~/.openp41ge-code release, ~/.openp41ge-code-dev dev).
 */

import fs from "fs";
import path from "path";
import type { Workspace } from "../../layout/types.js";
import { createWorkspace } from "../../layout/types.js";
import { serialize, deserialize } from "../../layout/serialization.js";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "WorkspaceStateStore");

import { WORKSPACE_STATE_FILENAME } from "openp41ge-core-constants";

export class WorkspaceStateStore {
  private readonly _filePath: string;
  private readonly _defaultWorkspace: () => Workspace;

  constructor(openp41geDir: string) {
    this._filePath = path.join(openp41geDir, WORKSPACE_STATE_FILENAME);
    this._defaultWorkspace = () => createWorkspace("ws1");
  }

  /**
   * Load saved workspace state from disk.
   * If a custom path is provided, load from there instead of the default.
   * Returns null if no saved state exists or the file is corrupt.
   */
  load(customPath?: string): Workspace | null {
    const filePath = customPath ?? this._filePath;
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const ws = deserialize(raw);
      log.info("Workspace state loaded from", filePath);
      return ws;
    } catch (err) {
      log.error("Failed to load workspace state:", err);
      return null;
    }
  }

  /**
   * Save workspace state to disk atomically.
   * If a custom path is provided, save there instead of the default.
   */
  save(workspace: Workspace, customPath?: string): void {
    const filePath = customPath ?? this._filePath;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = serialize(workspace);
      const tmpPath = filePath + ".tmp";
      fs.writeFileSync(tmpPath, serialized, "utf-8");
      fs.renameSync(tmpPath, filePath);
      log.info("Workspace state saved to", filePath);
    } catch (err) {
      log.error("Failed to save workspace state:", err);
    }
  }

  /**
   * Remove saved state (used between test scenarios for clean state).
   */
  clear(): void {
    try {
      if (fs.existsSync(this._filePath)) {
        fs.rmSync(this._filePath, { force: true });
      }
      if (fs.existsSync(this._filePath + ".tmp")) {
        fs.rmSync(this._filePath + ".tmp", { force: true });
      }
    } catch (err) {
      log.error("Failed to clear workspace state:", err);
    }
  }
}
