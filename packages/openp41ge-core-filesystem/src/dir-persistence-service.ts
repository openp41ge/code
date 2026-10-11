/**
 * DirPersistenceService — save and restore expanded directory state.
 *
 * Reads from and writes to the global __wtState object which persists
 * across page navigations and app restarts.
 */

import type { WorktreeData } from "./types";

/**
 * Global persistence state interface.
 */
interface WtState {
  expandedRepos: Set<string>;
  expandedWorktrees: Set<string>;
  expandedDirs: Set<string>;
  persistedDirPaths: string[];
}

function getGlobalState(): WtState {
  const g = globalThis as unknown as { __wtState?: WtState };
  if (!g.__wtState) {
    g.__wtState = {
      expandedRepos: new Set(),
      expandedWorktrees: new Set(),
      expandedDirs: new Set(),
      persistedDirPaths: [],
    };
  }
  return g.__wtState;
}

export class DirPersistenceService {
  private _persistedDirPaths: string[] | null = null;

  /**
   * Load expanded worktrees and directories for a given repo from global state.
   * Returns the loaded sets/maps that the component should use.
   */
  loadFromGlobalState(repoName: string): {
    expanded: boolean;
    expandedWorktrees: Set<string>;
    expandedDirs: Map<string, Set<string>>;
  } {
    const st = getGlobalState();
    const expanded = !!st.expandedRepos?.has(repoName);
    const expandedWorktrees = new Set<string>();
    const expandedDirs = new Map<string, Set<string>>();

    if (st.expandedWorktrees) {
      for (const key of st.expandedWorktrees) {
        if (key.startsWith(`${repoName}:`)) {
          expandedWorktrees.add(key.slice(repoName.length + 1));
        }
      }
    }

    // Save expanded directory paths — to be resolved once worktree paths arrive
    if (st.expandedDirs?.size) {
      this._persistedDirPaths = Array.from(st.expandedDirs);
    }

    return { expanded, expandedWorktrees, expandedDirs };
  }

  /**
   * After worktree data arrives, map persisted directory keys (branch:path) to
   * their owning worktree branches. Returns the populated expandedDirs map,
   * or null if not enough data is available yet.
   */
  restoreDirExpansion(worktrees: WorktreeData[]): Map<string, Set<string>> | null {
    if (!this._persistedDirPaths || this._persistedDirPaths.length === 0) {
      // Re-read from global state — worktree may have been collapsed and
      // re-expanded, consuming the initial _persistedDirPaths.
      const st = getGlobalState();
      if (st.expandedDirs?.size) {
        this._persistedDirPaths = Array.from(st.expandedDirs);
      } else {
        return null;
      }
    }
    if (worktrees.length === 0) return null;

    const expandedDirs = new Map<string, Set<string>>();
    const worktreeBranches = new Set(worktrees.map((wt) => wt.branch));

    for (const key of this._persistedDirPaths) {
      // Keys are in "branch:path" format
      const colonIdx = key.indexOf(":");
      if (colonIdx === -1) continue;
      const branch = key.slice(0, colonIdx);
      const dirPath = key.slice(colonIdx + 1);
      if (!worktreeBranches.has(branch)) continue;

      let dirs = expandedDirs.get(branch);
      if (!dirs) {
        dirs = new Set();
        expandedDirs.set(branch, dirs);
      }
      dirs.add(dirPath);
    }
    this._persistedDirPaths = null;
    return expandedDirs;
  }

  get hasPendingRestore(): boolean {
    return this._persistedDirPaths !== null && this._persistedDirPaths.length > 0;
  }

  /** Forget any directory paths pending restore (used when collapsing all). */
  resetPendingRestore(): void {
    this._persistedDirPaths = null;
  }
}
