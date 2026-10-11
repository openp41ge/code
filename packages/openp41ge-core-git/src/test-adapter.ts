import type { GitAdapter } from "./git-adapter";
import type { CloneResult, CloneProgress, RepoInfo, WorktreeInfo } from "./types";

/**
 * In-memory GitAdapter for unit tests. No real I/O.
 */
export class TestGitAdapter implements GitAdapter {
  repos: Map<string, RepoInfo> = new Map();
  worktrees: Map<string, WorktreeInfo[]> = new Map();
  branches: Map<string, string[]> = new Map();

  // ── Helpers for test setup ──

  addRepo(name: string, url: string, path?: string): void {
    this.repos.set(name, { name, url, path: path ?? `/test/${name}` });
  }

  addWorktreeData(repoName: string, branch: string, path?: string): void {
    const list = this.worktrees.get(repoName) ?? [];
    list.push({ branch, path: path ?? `/test/${repoName}/${branch}`, exists: true });
    this.worktrees.set(repoName, list);
  }

  addBranch(repoName: string, branch: string): void {
    const list = this.branches.get(repoName) ?? [];
    if (!list.includes(branch)) list.push(branch);
    this.branches.set(repoName, list);
  }

  // ── Adapter implementation ──

  clone(url: string) {
    const name = url.split("/").pop()?.replace(".git", "") ?? "unknown";
    const result: CloneResult = { success: true, path: `/cloned/${name}` };
    this.repos.set(name, { name, url, path: `/cloned/${name}` });

    let progressCb: ((progress: CloneProgress) => void) | null = null;
    let cancel: (() => void) | null = null;
    const promise = new Promise<CloneResult>((resolve, reject) => {
      cancel = () => reject(new Error("Clone aborted"));
      setTimeout(() => {
        progressCb?.({ percent: 50, message: "Cloning..." });
      }, 10);
      setTimeout(() => {
        progressCb?.({ percent: 100, message: "Done" });
        resolve(result);
      }, 20);
    });

    return {
      promise,
      onProgress: (fn: (progress: CloneProgress) => void) => {
        progressCb = fn;
        return () => {
          progressCb = null;
        };
      },
      destroy: () => {
        cancel?.();
        cancel = null;
      },
    };
  }

  async listRepos(): Promise<RepoInfo[]> {
    return Array.from(this.repos.values());
  }

  async getRepo(name: string): Promise<RepoInfo | null> {
    return this.repos.get(name) ?? null;
  }

  async removeRepo(repoName: string): Promise<void> {
    this.repos.delete(repoName);
    this.worktrees.delete(repoName);
    this.branches.delete(repoName);
  }

  async listWorktrees(repoName: string): Promise<WorktreeInfo[]> {
    return this.worktrees.get(repoName) ?? [];
  }

  async checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo> {
    const wt: WorktreeInfo = {
      branch,
      path: `/test/${repoName}/${branch}`,
      exists: true,
    };
    const list = this.worktrees.get(repoName) ?? [];
    const idx = list.findIndex((w) => w.branch === branch);
    if (idx >= 0) list[idx] = wt;
    else list.push(wt);
    this.worktrees.set(repoName, list);
    return wt;
  }

  async addWorktree(repoName: string, branch: string): Promise<WorktreeInfo> {
    return this.checkoutWorktree(repoName, branch);
  }

  async deleteWorktree(repoName: string, branch: string): Promise<void> {
    const list = this.worktrees.get(repoName) ?? [];
    this.worktrees.set(
      repoName,
      list.filter((w) => w.branch !== branch),
    );
  }

  async listBranches(repoName: string): Promise<string[]> {
    return this.branches.get(repoName) ?? [];
  }

  async getDefaultBranch(repoName: string): Promise<string | null> {
    const list = this.branches.get(repoName);
    return list && list.length > 0 ? list[0] : null;
  }

  async pullBranch(_repoName: string, _branch: string): Promise<void> {
    // no-op in memory
  }

  async fetch(_repoName: string): Promise<void> {
    // no-op in memory
  }
}
