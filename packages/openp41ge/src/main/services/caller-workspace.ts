/**
 * caller-workspace.ts — the calling window's workspace as extension backends
 * see it (`ctx.workspace`, through the host): its id, the repositories its
 * workspace file lists and their checked-out worktrees, checking out a new
 * worktree (recorded in the workspace file, as the explorer does), and a
 * folder per extension inside its data folder
 * (`<data>/extensions/<extensionId>/`).
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { CallerWorkspace, WorkspaceRepository, WorkspaceRoot } from "openp41ge-sdk";
import type { WorktreeInfo } from "../interfaces/git-service.js";
import type { WorkspaceDataDir } from "./workspace-repositories.js";

/** The folder in a workspace's data folder that holds extensions' folders. */
export const EXTENSIONS_DATA_DIR = "extensions";

export interface CallerWorkspaceOptions {
  readonly workspace: WorkspaceDataDir;
  /** The repositories its workspace file lists (read when roots are asked for). */
  repoNames(): readonly string[];
  /** Whether a repository is cloned (in the workspace's repositories folder). */
  isCloned(repoName: string): Promise<boolean>;
  /** A repository's worktrees (in the workspace's repositories folder). */
  listWorktrees(repoName: string): Promise<WorktreeInfo[]>;
  /** Check out a branch's worktree (the platform's checkout). */
  checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo>;
  /** Add a branch to the repository's worktrees in the workspace file. */
  recordWorktree(repoName: string, branch: string): void;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** An extension id usable as one folder name. */
function isFolderName(id: string): boolean {
  return id !== "" && id !== "." && id !== ".." && !/[\\/]/.test(id);
}

export function callerWorkspace(options: CallerWorkspaceOptions): CallerWorkspace {
  const { workspace } = options;
  const worktreesOf = async (repoName: string): Promise<WorkspaceRoot[]> =>
    (await options.listWorktrees(repoName))
      .filter((wt) => wt.exists)
      .map((wt) => ({ repoName, branch: wt.branch, path: wt.path }));
  return {
    id: workspace.id,
    async roots() {
      const out: WorkspaceRoot[] = [];
      for (const repoName of options.repoNames()) out.push(...(await worktreesOf(repoName)));
      return out;
    },
    async repositories() {
      const out: WorkspaceRepository[] = [];
      for (const repoName of options.repoNames()) {
        const cloned = await options.isCloned(repoName);
        out.push({ repoName, cloned, worktrees: cloned ? await worktreesOf(repoName) : [] });
      }
      return out;
    },
    async addWorktree(repoName, branch) {
      const name = repoName.trim();
      const ref = branch.trim();
      if (!name || !ref) return { ok: false, error: "a repository and branch are required" };
      if (!options.repoNames().includes(name)) {
        return { ok: false, error: `${name} is not a repository of this workspace` };
      }
      if (!(await options.isCloned(name))) {
        return { ok: false, error: `${name} is not cloned yet` };
      }
      try {
        const wt = await options.checkoutWorktree(name, ref);
        options.recordWorktree(name, ref);
        return { ok: true, path: wt.path };
      } catch (err) {
        return { ok: false, error: errorText(err) };
      }
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
