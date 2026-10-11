/**
 * Workspace IPC handlers — cloning, repos, worktrees, app reset.
 *
 * Repositories belong to a workspace: every call acts on the repositories of
 * the sender window's workspace.
 */

import { ipcMain } from "electron";
import type { OperationDispatcher } from "../../src/main/services/operation-dispatcher.js";
import { createWorkspace } from "../../src/layout/types.js";
import path from "path";
import type { DeletedTarget } from "../../src/layout/tabs-showing.js";
import { requireWorkspaceGit, type WorkspaceGitResolver } from "../workspace-of-sender.js";

/** Delete a workspace's clone (`workspaceFile` omitted: the sender's workspace). */
export type DeleteRepository = (
  event: { sender: Electron.WebContents },
  repoName: string,
  workspaceFile?: string,
) => Promise<{ ok: boolean; error?: string }>;

/**
 * Something was deleted from a workspace (`workspaceFile` omitted: the
 * sender's): close the tabs that showed it.
 */
export type OnDeleted = (
  event: { sender: Electron.WebContents },
  target: DeletedTarget,
  workspaceFile?: string,
) => void;

export function registerWorkspaceHandlers(
  gitFor: WorkspaceGitResolver,
  resolve?: (event: { sender: Electron.WebContents }) => OperationDispatcher | null,
  deleteRepository?: DeleteRepository,
  onDeleted?: OnDeleted,
): void {
  /** The sender's workspace services; throws in a window without one. */
  const service = (event: { sender: Electron.WebContents }) =>
    requireWorkspaceGit(gitFor, event).service;

  // `workspaceFile` names the workspace to clone for (the workspace editor
  // editing another workspace's file); omitted: the sender's workspace.
  // Progress carries `cloneId`: the channel is shared by every clone in
  // flight, so without it one clone's progress reaches the others.
  ipcMain.handle(
    "workspace:clone",
    async (event, url: string, workspaceFile?: string, cloneId?: string) => {
      const session = requireWorkspaceGit(gitFor, event, workspaceFile).service.clone(url);
      session.onProgress((progress: { percent: number; message: string }) => {
        event.sender.send("workspace:clone-progress", { ...progress, cloneId });
      });
      return session.promise;
    },
  );

  // Listings in a window without a workspace are empty.
  ipcMain.handle("workspace:listRepos", async (event) => {
    return gitFor(event)?.service.listRepos() ?? [];
  });

  ipcMain.handle("workspace:getRepo", async (event, name: string) => {
    return gitFor(event)?.service.getRepo(name) ?? null;
  });

  ipcMain.handle("workspace:listWorktrees", async (event, repoName: string) => {
    return gitFor(event)?.service.listWorktrees(repoName) ?? [];
  });

  ipcMain.handle("workspace:checkoutWorktree", async (event, repoName: string, branch: string) => {
    return service(event).checkoutWorktree(repoName, branch);
  });

  ipcMain.handle("workspace:removeWorktree", async (event, repoName: string, branch: string) => {
    const git = requireWorkspaceGit(gitFor, event);
    const removed = await git.service.removeWorktree(repoName, branch);
    if (removed.ok) {
      const folder = path.join(git.reposDir, repoName, branch.replace(/\//g, "--"));
      onDeleted?.(event, { repoName, branch, folder });
    }
    return removed;
  });

  ipcMain.handle("workspace:deleteWorktree", async (event, repoName: string, branch: string) => {
    await service(event).deleteWorktree(repoName, branch);
  });

  ipcMain.handle("workspace:fetch", async (event, repoName: string) => {
    await service(event).fetch(repoName);
  });

  ipcMain.handle("workspace:pullBranch", async (event, repoName: string, branch: string) => {
    await service(event).pullBranch(repoName, branch);
  });

  ipcMain.handle("workspace:listBranches", async (event, repoName: string) => {
    return gitFor(event)?.service.listBranches(repoName) ?? [];
  });

  // Never rejects: a failure (or a window without a workspace) is `error`.
  // `workspaceFile` names another workspace (the workspace editor's).
  ipcMain.handle(
    "workspace:repositoryState",
    async (event, repoName: string, workspaceFile?: string) => {
      const git = gitFor(event, workspaceFile);
      if (!git) return { repoName, branches: [], error: "this window has no workspace" };
      return git.git.repositoryState(repoName);
    },
  );

  // Deletes the clone and its worktrees; the renderer has asked the user.
  // Never rejects: { ok, error? }.
  ipcMain.handle(
    "workspace:deleteRepository",
    async (event, repoName: string, workspaceFile?: string) => {
      if (!deleteRepository) return { ok: false, error: "deleting is unavailable" };
      try {
        const deleted = await deleteRepository(event, repoName, workspaceFile);
        const git = deleted.ok ? gitFor(event, workspaceFile) : null;
        if (git) {
          onDeleted?.(
            event,
            { repoName, folder: path.join(git.reposDir, repoName) },
            workspaceFile,
          );
        }
        return deleted;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("workspace:getDefaultBranch", async (event, repoName: string) => {
    return service(event).getDefaultBranch(repoName);
  });

  // ── App state reset (for test fast-reset) ──────────────────────────────────

  ipcMain.on("workspace:reset", (event) => {
    const d = resolve?.(event);
    if (d) {
      const ws = createWorkspace("ws1");
      d.setWorkspace(ws);
      d.broadcast();
    }
    event.sender.send("workspace:do-reset");
  });
}
