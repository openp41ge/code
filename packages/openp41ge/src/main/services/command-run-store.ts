/**
 * command-run-store.ts — where a workspace's scoped-terminal runs are kept
 * (`CommandRunStore`): one JSON file per workspace, read back after a
 * restart, empty when missing or corrupt. A run saved while it was still
 * running reads back as ended (the app closed while it ran).
 */

import fs from "fs";
import path from "path";
import type { CommandRun, CommandRunStore } from "./command-service.js";

export class FileCommandRunStore implements CommandRunStore {
  /** `fileFor`: the runs file of a workspace (by id). */
  constructor(private readonly _fileFor: (workspaceId: string) => string) {}

  list(workspaceId: string): CommandRun[] {
    try {
      const data = JSON.parse(fs.readFileSync(this._fileFor(workspaceId), "utf-8")) as {
        runs?: unknown;
      };
      if (!Array.isArray(data.runs)) return [];
      return (data.runs as CommandRun[]).map((r) =>
        r.state === "running" ? { ...r, state: "done", error: "the app closed while it ran" } : r,
      );
    } catch {
      return [];
    }
  }

  save(workspaceId: string, runs: readonly CommandRun[]): void {
    const file = this._fileFor(workspaceId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, runs }), "utf-8");
  }
}
