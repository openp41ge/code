import { appState } from "./app-state";

export interface RepoInfo {
  id: string;
  path: string;
  name: string;
}

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  repoId: string;
}

/**
 * Workspace data — shared data layer for the core system.
 *
 * Replaces the old "Projects" tab concept. Workspace is NOT a tab —
 * it's a core data layer that is always available. Plugins read from
 * and write to workspace data through events.
 *
 * Explorer reads workspace.repos to show the file tree.
 * Git repo reads workspace.repos to show branches and commits.
 * Layout reads workspace.layout for sidebar widths and tab positions.
 */
export class WorkspaceData {
  repos: RepoInfo[] = [];
  worktrees: WorktreeInfo[] = [];
  activeRepoId: string | null = null;

  /** Persisted layout data stored alongside workspace data. */
  layout: {
    sidebarWidths: Record<string, number>;
  } = {
    sidebarWidths: { left: 300, right: 350 },
  };

  setActiveRepo(repoId: string | null): void {
    this.activeRepoId = repoId;
    appState.activeRepoId = repoId;
  }

  addRepo(repo: RepoInfo): void {
    this.repos.push(repo);
  }

  removeRepo(repoId: string): void {
    this.repos = this.repos.filter((r) => r.id !== repoId);
    if (this.activeRepoId === repoId) {
      this.setActiveRepo(this.repos[0]?.id ?? null);
    }
  }
}

/** Singleton instance. */
export const workspaceData = new WorkspaceData();
