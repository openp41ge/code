/**
 * Git operations for the worktree explorer.
 *
 * All methods return plain data objects — no Electron or DOM types.
 * Implementations run in the main (Node.js) process.
 */

export interface RepoInfo {
  /** Absolute path to the bare repository directory. */
  path: string;
  /** Repository name derived from the clone URL. */
  name: string;
  /** Clone URL. */
  url: string;
}

export interface WorktreeInfo {
  /** Branch name (e.g., "main", "feature/fix"). */
  branch: string;
  /** Absolute path to the worktree directory. */
  path: string;
  /** Whether the worktree currently has a working directory on disk. */
  exists: boolean;
}

export interface GitCloneProgress {
  /** 0–100 percent complete. */
  percent: number;
  /** Human-readable progress message (e.g., "Receiving objects: 67%"). */
  message: string;
}

export interface GitCloneResult {
  success: boolean;
  /** Absolute path to the cloned repo directory (on success). */
  path?: string;
  /** Error message (on failure): git's own `fatal:` / `error:` line when it gave one. */
  error?: string;
  /** What ran and what git printed, as a terminal would have shown it. */
  transcript?: GitTranscript;
}

/** A git command and its output (stdout + stderr, raw — progress uses \r). */
export interface GitTranscript {
  command: string;
  output: string;
}

export interface GitCloneSession {
  /** Promise that resolves when the clone completes or fails. */
  promise: Promise<GitCloneResult>;
  /** Subscribe to progress events. Returns unsubscribe function. */
  onProgress: (callback: (progress: GitCloneProgress) => void) => () => void;
  /** Abort the clone operation. */
  abort: () => void;
}

export interface IGitService {
  /**
   * Clone a repository by URL into the repos directory as a bare clone.
   * Returns a GitCloneSession with progress events.
   * The promise resolves when the clone completes or fails.
   */
  clone(url: string): GitCloneSession;

  /**
   * List all bare repositories in the repos directory.
   */
  listRepos(): Promise<RepoInfo[]>;

  /**
   * Get information about a specific repository by name.
   * Returns null if the repo doesn't exist.
   */
  getRepo(name: string): Promise<RepoInfo | null>;

  /**
   * List all worktrees (branches) checked out for a given repository.
   * A worktree corresponds to a checked-out branch directory.
   */
  listWorktrees(repoName: string): Promise<WorktreeInfo[]>;

  /**
   * Checkout a branch as a worktree for a given repository.
   * Creates a subdirectory under the repo folder.
   * Returns the WorktreeInfo for the new worktree.
   * Throws if the branch doesn't exist or checkout fails.
   */
  checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo>;

  /**
   * Delete a worktree (remove the checked-out branch directory).
   * Does NOT delete the branch from the repository.
   */
  deleteWorktree(repoName: string, branch: string): Promise<void>;

  /**
   * Delete a worktree's folder with `git worktree remove` — never forced: git
   * refuses when it has uncommitted or untracked changes, and that refusal is
   * the result's `error`. The branch is kept. Already gone: ok.
   */
  removeWorktree(repoName: string, branch: string): Promise<{ ok: boolean; error?: string }>;

  /**
   * Fetch latest changes for a repository.
   */
  fetch(repoName: string): Promise<void>;

  /**
   * Pull latest changes for a specific branch and update its worktree directory.
   * Fetches from remote, merges origin/branch into the local branch,
   * then checks out the updated files to the worktree directory.
   */
  pullBranch(repoName: string, branch: string): Promise<void>;

  /**
   * Get the current branch name for a working directory (non-bare repo or worktree).
   * Returns null if the directory is not a git repository.
   */
  getCurrentBranch(dirPath: string): Promise<string | null>;

  /**
   * List all branches (local + remote) for a repository.
   */
  listBranches(repoName: string): Promise<string[]>;

  /**
   * Get the default branch name for a repository (e.g., "main" or "master").
   * Returns null if the remote HEAD reference cannot be resolved.
   */
  getDefaultBranch(repoName: string): Promise<string | null>;
}
