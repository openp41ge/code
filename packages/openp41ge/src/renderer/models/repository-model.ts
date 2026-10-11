import type { WorktreeModel } from "./worktree-model.js";

export interface GitCloneProgress {
  percent: number;
  message: string;
}

export interface GitCloneSessionModel {
  readonly promise: Promise<RepositoryModel>;
  onProgress(callback: (progress: GitCloneProgress) => void): () => void;
  abort(): void;
}

/**
 * RepositoryModel represents a git repository in the worktree explorer.
 *
 * This is the top-level model for a cloned repository. It provides access
 * to worktrees (checked-out branches) and git operations.
 *
 * The tree component never knows whether it's backed by a real filesystem
 * (IpcRepositoryModel) or in-memory test data (TestRepositoryModel).
 */
export interface RepositoryModel {
  readonly name: string;
  readonly url: string;

  /** List all worktrees (checked-out branches) in this repo. */
  listWorktrees(): Promise<WorktreeModel[]>;

  /** Checkout a branch as a new worktree. Returns the new worktree model. */
  checkoutWorktree(branch: string): Promise<WorktreeModel>;

  /** Delete a worktree (does not delete the branch from the repo). */
  deleteWorktree(branch: string): Promise<void>;

  /** Pull latest changes for a branch, updating its worktree. */
  pullBranch(branch: string): Promise<void>;

  /** Fetch all remotes. */
  fetch(): Promise<void>;

  /** List all branches (local + remote). */
  listBranches(): Promise<string[]>;

  /** Get the default branch name (e.g., "main" or "master"). */
  getDefaultBranch(): Promise<string | null>;
}
