import type { GitAdapter } from "./git-adapter";
import type { RepoInfo, WorktreeInfo, CloneResult, CloneProgress } from "./types";

interface Openp41geWindow extends Window {}

interface WorkspaceController {
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
  deleteWorktree(repoName: string, branch: string): Promise<void>;
  listBranches(repoName: string): Promise<string[]>;
  getDefaultBranch(repoName: string): Promise<string | null>;
  pullBranch(repoName: string, branch: string): Promise<void>;
  fetch(repoName: string): Promise<void>;
}

function getWC(): WorkspaceController {
  const wc = (
    window as unknown as Openp41geWindow & {
      openp41ge?: { workspaceController?: WorkspaceController };
    }
  ).openp41ge?.workspaceController;
  if (!wc) throw new Error("workspaceController not available");
  return wc;
}

export class IpcGitAdapter implements GitAdapter {
  clone(url: string) {
    return getWC().clone(url);
  }

  async listRepos(): Promise<RepoInfo[]> {
    return getWC().listRepos();
  }

  async getRepo(name: string): Promise<RepoInfo | null> {
    return getWC().getRepo(name);
  }

  async removeRepo(repoName: string): Promise<void> {
    return getWC().removeRepo(repoName);
  }

  async listWorktrees(repoName: string): Promise<WorktreeInfo[]> {
    return getWC().listWorktrees(repoName);
  }

  async checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo> {
    return getWC().checkoutWorktree(repoName, branch);
  }

  async addWorktree(_repoName: string, _branch: string): Promise<WorktreeInfo> {
    throw new Error("addWorktree not available via workspaceController");
  }

  async deleteWorktree(repoName: string, branch: string): Promise<void> {
    return getWC().deleteWorktree(repoName, branch);
  }

  async listBranches(repoName: string): Promise<string[]> {
    return getWC().listBranches(repoName);
  }

  async getDefaultBranch(repoName: string): Promise<string | null> {
    return getWC().getDefaultBranch(repoName);
  }

  async pullBranch(repoName: string, branch: string): Promise<void> {
    return getWC().pullBranch(repoName, branch);
  }

  async fetch(repoName: string): Promise<void> {
    return getWC().fetch(repoName);
  }
}
