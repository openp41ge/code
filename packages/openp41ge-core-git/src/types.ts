// ─── Service types (raw git data) ─────────────────────────────────────────

/** Result of a clone operation. */
export interface CloneResult {
  success: boolean;
  path?: string;
  error?: string;
}

/** Progress information during a clone. */
export interface CloneProgress {
  percent: number;
  message: string;
}

/** Info about a cloned repository. */
export interface RepoInfo {
  path: string;
  name: string;
  url: string;
}

/** Info about a worktree. */
export interface WorktreeInfo {
  branch: string;
  path: string;
  exists: boolean;
}
