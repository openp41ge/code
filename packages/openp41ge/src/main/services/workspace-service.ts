/**
 * WorkspaceService — orchestrates IGitService and IFileSystemService.
 *
 * Thin orchestrator that delegates to the two backend services.
 * Used by IPC handlers in main.ts — no Electron imports, only service interfaces.
 *
 * The workspace store (FileWorkspaceStore) has been removed — it was superseded
 * by the project system. Git operations remain here as
 * they delegate to NodeGitService.
 */

import path from "path";
import { createLogger } from "openp41ge-core-logger";
import type { IGitService, RepoInfo, WorktreeInfo } from "../interfaces/git-service.js";
import type { IFileSystemService, FileEntryInfo } from "../interfaces/file-system-service.js";

const log = createLogger("openp41ge", "workspace-service");

export class WorkspaceService {
  private _reposDir: string;

  constructor(
    private readonly _gitService: IGitService,
    private readonly _fileSystem: IFileSystemService,
    reposDir?: string,
  ) {
    this._reposDir = reposDir ?? "";
  }

  /** Update the repositories directory (used when switching to a project). */
  setReposDir(reposDir: string): void {
    this._reposDir = reposDir;
  }

  // ── Git operations ────────────────────────────────────────────────────

  clone(url: string) {
    return this._gitService.clone(url);
  }

  listRepos(): Promise<RepoInfo[]> {
    return this._gitService.listRepos();
  }

  getRepo(name: string): Promise<RepoInfo | null> {
    return this._gitService.getRepo(name);
  }

  listWorktrees(repoName: string): Promise<WorktreeInfo[]> {
    return this._gitService.listWorktrees(repoName);
  }

  checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo> {
    return this._gitService.checkoutWorktree(repoName, branch);
  }

  deleteWorktree(repoName: string, branch: string): Promise<void> {
    return this._gitService.deleteWorktree(repoName, branch);
  }

  removeWorktree(repoName: string, branch: string): Promise<{ ok: boolean; error?: string }> {
    return this._gitService.removeWorktree(repoName, branch);
  }

  fetch(repoName: string): Promise<void> {
    return this._gitService.fetch(repoName);
  }

  pullBranch(repoName: string, branch: string): Promise<void> {
    return this._gitService.pullBranch(repoName, branch);
  }

  listBranches(repoName: string): Promise<string[]> {
    return this._gitService.listBranches(repoName);
  }

  getDefaultBranch(repoName: string): Promise<string | null> {
    return this._gitService.getDefaultBranch(repoName);
  }

  // ── File system operations ────────────────────────────────────────────

  async listFiles(repoName: string, worktreeBranch: string): Promise<FileEntryInfo[]> {
    const repoPath = path.join(this._reposDir, repoName);
    const dirName = worktreeBranch.replace(/\//g, "--");
    const worktreePath = path.join(repoPath, dirName);
    return this._fileSystem.readdir(worktreePath);
  }

  async readFile(
    repoName: string,
    worktreeBranch: string,
    filePath: string,
  ): Promise<{ data: string; totalSize: number }> {
    const repoPath = path.join(this._reposDir, repoName);
    const dirName = worktreeBranch.replace(/\//g, "--");
    const worktreePath = path.join(repoPath, dirName, filePath);
    return this._fileSystem.readRange(worktreePath, 0, 1024 * 1024);
  }

  async searchFiles(
    query: string,
    rootPaths: string[],
  ): Promise<{ path: string; name: string; dir: string }[]> {
    const results: { path: string; name: string; dir: string }[] = [];
    const q = query.toLowerCase();
    const maxResults = 50;

    async function walk(dir: string, depth: number, fs: IFileSystemService) {
      if (depth > 5 || results.length >= maxResults) return;
      let entries: FileEntryInfo[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        log.debug("workspace find cannot read dir; skipping:", dir, err);
        return;
      }
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.isDirectory) {
          await walk(entry.path, depth + 1, fs);
        } else {
          if (entry.name.toLowerCase().includes(q)) {
            results.push({ path: entry.path, name: entry.name, dir });
          }
        }
      }
    }

    for (const root of rootPaths) {
      await walk(root, 0, this._fileSystem);
      if (results.length >= maxResults) break;
    }

    return results;
  }
}
