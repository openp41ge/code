import type { CloneResult, CloneProgress, RepoInfo, WorktreeInfo } from "./types";

/**
 * Abstraction over git operations. Two implementations:
 * - IpcGitAdapter — delegates to window.openp41ge.workspaceController.* in production
 * - TestGitAdapter — pure in-memory for unit tests
 */
export interface GitAdapter {
  clone(url: string): {
    promise: Promise<CloneResult>;
    onProgress: (fn: (progress: CloneProgress) => void) => () => void;
    destroy: () => void;
  };

  listRepos(): Promise<RepoInfo[]>;
  getRepo(name: string): Promise<RepoInfo | null>;
  removeRepo(repoName: string): Promise<void>;

  listWorktrees(repoName: string): Promise<WorktreeInfo[]>;
  checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo>;
  addWorktree(repoName: string, branch: string): Promise<WorktreeInfo>;
  deleteWorktree(repoName: string, branch: string): Promise<void>;

  listBranches(repoName: string): Promise<string[]>;
  getDefaultBranch(repoName: string): Promise<string | null>;
  pullBranch(repoName: string, branch: string): Promise<void>;
  fetch(repoName: string): Promise<void>;
}
