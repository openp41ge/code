/**
 * extension-workspace-actions.ts — the platform side of `host.workspace`
 * (SDK `SurfaceWorkspaceHost`): workspace actions an extension asks the
 * platform to perform.
 *
 * Cloning and worktree checkout are platform work (git credentials, the
 * workspace's repositories), done through the preload git API. `addRepository`
 * and `addWorktree` then record the result in the open workspace file and
 * save it; `cloneRepository` only clones. Recording fires the
 * workspace file's change signal, which re-resolves every mounted surface's
 * context. Every failure resolves `ok: false` — the actions never throw.
 */

import {
  validateRepoUrl,
  type CloneProgress,
  type RepositoryAddition,
  type RepositoryState,
  type SurfaceWorkspaceHost,
  type WorkspaceFileChange,
} from "openp41ge-sdk";
import { deriveRepoName } from "./workspace-file-service";
import { branchWorkLines } from "./repository-work";

/** The slice of the preload git API (`workspaceController`) the actions use. */
export interface WorkspaceActionsGit {
  /** Clone for the workspace file `workspaceFile` (omitted: this window's). */
  clone(
    url: string,
    workspaceFile?: string,
  ): {
    promise: Promise<{
      success: boolean;
      path?: string;
      error?: string;
      transcript?: { command: string; output: string };
    }>;
    onProgress(fn: (progress: { percent: number; message: string }) => void): () => void;
    destroy(): void;
  };
  checkoutWorktree(
    repoName: string,
    branch: string,
  ): Promise<{ branch: string; path: string; exists: boolean }>;
  fetch(repoName: string): Promise<void>;
  removeWorktree(repoName: string, branch: string): Promise<{ ok: boolean; error?: string }>;
  repositoryState(repoName: string, workspaceFile?: string): Promise<RepositoryState>;
  /** A workspace file's manifest changed on disk. Returns unsubscribe. */
  onWorkspaceFileChanged(fn: (change: WorkspaceFileChange) => void): () => void;
  /** Delete the clone and its worktrees (no question asked). */
  deleteRepository(
    repoName: string,
    workspaceFile?: string,
  ): Promise<{ ok: boolean; error?: string }>;
}

/** The open workspace file: record a repo / worktree, then persist. */
export interface WorkspaceActionsStore {
  addRepo(url: string): boolean;
  addWorktree(repoName: string, branch: string): boolean;
  /** True when the worktree is already in the open workspace. */
  hasWorktree(repoName: string, branch: string): boolean;
  /** Remove a repo / worktree from the open workspace; false when it isn't there. */
  removeRepo(repoName: string): boolean;
  removeWorktree(repoName: string, branch: string): boolean;
  /** Something changed on disk outside the workspace file: refresh every
   *  surface's `context.workspaceRepos`. */
  refreshed(): void;
  save(): Promise<unknown>;
}

/** Ask the user (the app's confirm dialog); resolves whether they agreed. */
export type WorkspaceActionsConfirm = (options: {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
}) => Promise<boolean>;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The confirmation detail of deleting a repository in `state`: what is
 * deleted, and each branch's work that exists nowhere else.
 */
function deleteDetail(state: RepositoryState): string {
  const worktrees = state.branches.filter((b) => b.worktree).length;
  if (state.error) {
    return (
      "Its clone and its worktrees are deleted from disk.\n\n" +
      `Its state could not be read (${state.error}): uncommitted or unpushed work may be lost.`
    );
  }
  const deleted = `Its clone and ${plural(worktrees, "worktree", "worktrees")} are deleted from disk.`;
  const lines = branchWorkLines(state.branches).map((line) => `• ${line}`);
  if (lines.length === 0) return `${deleted} Nothing in it is uncommitted or unpushed.`;
  return `${deleted}\n\nNot saved anywhere else:\n${lines.join("\n")}`;
}

/** A clone that never started: settled `done`, inert progress/cancel. */
function failedAddition(error: string): RepositoryAddition {
  return {
    done: Promise.resolve({ ok: false, error }),
    onProgress: () => () => undefined,
    cancel: () => undefined,
  };
}

/**
 * Build the workspace actions. `git` is read per call (the preload API may
 * be absent, e.g. in a window without a workspace).
 */
export function createWorkspaceActions(
  git: () => WorkspaceActionsGit | undefined,
  store: WorkspaceActionsStore,
  confirm: WorkspaceActionsConfirm,
): SurfaceWorkspaceHost {
  /**
   * Clone `url` for `workspaceFile` (omitted: this window's workspace);
   * `record` (when given) runs after a successful clone.
   */
  function clone(
    url: string,
    workspaceFile?: string,
    record?: (repoUrl: string) => Promise<void>,
  ): RepositoryAddition {
    const repoUrl = url.trim();
    const invalid = validateRepoUrl(repoUrl);
    if (invalid) return failedAddition(invalid);
    const api = git();
    if (!api) return failedAddition("git is unavailable");

    const session = workspaceFile ? api.clone(repoUrl, workspaceFile) : api.clone(repoUrl);
    let cancelled = false;
    let settleCancelled!: (r: { ok: false; error: string }) => void;
    const cancelledResult = new Promise<{ ok: false; error: string }>((resolve) => {
      settleCancelled = resolve;
    });
    const cloned = session.promise.then(
      async (res) => {
        if (cancelled) return { ok: false, error: "cancelled" } as const;
        if (!res?.success) {
          return {
            ok: false,
            error: res?.error ?? "clone failed",
            ...(res?.transcript ? { transcript: res.transcript } : {}),
          } as const;
        }
        await record?.(repoUrl);
        return { ok: true, repoName: deriveRepoName(repoUrl) } as const;
      },
      (err: unknown) => ({ ok: false, error: errorText(err) }) as const,
    );
    return {
      done: Promise.race([cloned, cancelledResult]),
      onProgress(fn: (progress: CloneProgress) => void) {
        return session.onProgress((p) => fn({ percent: p.percent, message: p.message }));
      },
      cancel() {
        if (cancelled) return;
        cancelled = true;
        session.destroy();
        settleCancelled({ ok: false, error: "cancelled" });
      },
    };
  }

  return {
    cloneRepository: (url, workspaceFile) => clone(url, workspaceFile),

    addRepository: (url) =>
      clone(url, undefined, async (repoUrl) => {
        if (store.addRepo(repoUrl)) await store.save();
      }),

    async addWorktree(repoName, branch) {
      const name = repoName.trim();
      const ref = branch.trim();
      if (!name || !ref) return { ok: false, error: "a repository and branch are required" };
      if (store.hasWorktree(name, ref)) {
        return { ok: false, error: `${ref} is already a worktree of ${name}` };
      }
      const api = git();
      if (!api) return { ok: false, error: "git is unavailable" };
      try {
        const wt = await api.checkoutWorktree(name, ref);
        if (!wt?.path) return { ok: false, error: `no worktree was created for '${ref}'` };
        if (store.addWorktree(name, ref)) await store.save();
        return { ok: true, path: wt.path };
      } catch (err) {
        return { ok: false, error: errorText(err) };
      }
    },

    async fetchRepository(repoName) {
      const api = git();
      if (!api) return { ok: false, error: "git is unavailable" };
      try {
        await api.fetch(repoName);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorText(err) };
      } finally {
        // Re-read the list either way (worktrees may have changed on disk).
        store.refreshed();
      }
    },

    async deleteRepository(repoName, workspaceFile) {
      const api = git();
      if (!api) return { ok: false, error: "git is unavailable" };
      let state: RepositoryState;
      try {
        state = await api.repositoryState(repoName, workspaceFile);
      } catch (err) {
        state = { repoName, branches: [], error: errorText(err) };
      }
      const agreed = await confirm({
        title: "Delete repository",
        message: `Delete ${repoName}?`,
        detail: deleteDetail(state),
        confirmLabel: "Delete",
      });
      if (!agreed) return { ok: false, cancelled: true };
      try {
        const deleted = await api.deleteRepository(repoName, workspaceFile);
        if (!deleted.ok) return { ok: false, error: deleted.error ?? "the delete failed" };
      } catch (err) {
        return { ok: false, error: errorText(err) };
      }
      // A named workspace file records the removal itself (the editor's Save).
      if (workspaceFile) return { ok: true };
      if (store.removeRepo(repoName)) await store.save();
      else store.refreshed(); // not in the workspace file: the clone is gone though
      return { ok: true };
    },

    async deleteWorktree(repoName, branch) {
      const agreed = await confirm({
        title: "Delete worktree",
        message: `Delete worktree ${branch}?`,
        detail:
          "Its folder is deleted. Git refuses if it has uncommitted or untracked changes. " +
          "The branch is kept.",
        confirmLabel: "Delete",
      });
      if (!agreed) return { ok: false, cancelled: true };
      const api = git();
      if (!api) return { ok: false, error: "git is unavailable" };
      try {
        const removed = await api.removeWorktree(repoName, branch);
        if (!removed.ok) return { ok: false, error: removed.error ?? "git refused" };
      } catch (err) {
        return { ok: false, error: errorText(err) };
      }
      if (store.removeWorktree(repoName, branch)) await store.save();
      else store.refreshed(); // not in the workspace file: the folder is gone though
      return { ok: true };
    },

    async repositoryState(repoName) {
      const api = git();
      if (!api) return { repoName, branches: [], error: "git is unavailable" };
      try {
        return await api.repositoryState(repoName);
      } catch (err) {
        return { repoName, branches: [], error: errorText(err) };
      }
    },

    onWorkspaceFileChanged(fn) {
      return git()?.onWorkspaceFileChanged?.(fn) ?? (() => undefined);
    },
  };
}
