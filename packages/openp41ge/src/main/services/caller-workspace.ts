/**
 * caller-workspace.ts — the calling window's workspace as extension backends
 * see it (`ctx.workspace`, through the host): its id, the checked-out
 * worktrees of the repositories its workspace file lists, and a folder per
 * extension inside its data folder (`<data>/extensions/<extensionId>/`).
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { CallerWorkspace, WorkspaceRoot } from "openp41ge-sdk";
import type { WorktreeInfo } from "../interfaces/git-service.js";
import type { WorkspaceDataDir } from "./workspace-repositories.js";

/** The folder in a workspace's data folder that holds extensions' folders. */
export const EXTENSIONS_DATA_DIR = "extensions";

export interface CallerWorkspaceOptions {
  readonly workspace: WorkspaceDataDir;
  /** The repositories its workspace file lists (read when roots are asked for). */
  repoNames(): readonly string[];
  /** A repository's worktrees (in the workspace's repositories folder). */
  listWorktrees(repoName: string): Promise<WorktreeInfo[]>;
}

/** An extension id usable as one folder name. */
function isFolderName(id: string): boolean {
  return id !== "" && id !== "." && id !== ".." && !/[\\/]/.test(id);
}

export function callerWorkspace(options: CallerWorkspaceOptions): CallerWorkspace {
  const { workspace } = options;
  return {
    id: workspace.id,
    async roots() {
      const out: WorkspaceRoot[] = [];
      for (const repoName of options.repoNames()) {
        for (const wt of await options.listWorktrees(repoName)) {
          if (wt.exists) out.push({ repoName, branch: wt.branch, path: wt.path });
        }
      }
      return out;
    },
    async dataDirFor(extensionId) {
      if (!isFolderName(extensionId)) {
        throw new Error(`'${extensionId}' is not a valid extension id`);
      }
      const dir = path.join(workspace.dataDir, EXTENSIONS_DATA_DIR, extensionId);
      await mkdir(dir, { recursive: true });
      return dir;
    },
  };
}
