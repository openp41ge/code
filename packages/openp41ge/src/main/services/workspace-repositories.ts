/**
 * workspace-repositories.ts — each workspace's git services.
 *
 * Repositories belong to a workspace: every workspace has its own git
 * services, built on first use for the repositories folder `reposDirOf`
 * gives it. Git IPC calls are routed to the services of the workspace that
 * asked (see `electron/workspace-of-sender.ts`); workspaces never see each
 * other's repositories.
 */

import fs from "fs";
import path from "path";
import { deriveRepoName } from "openp41ge-sdk";
import { NodeGitService } from "./node-git-service.js";
import { WorkspaceService } from "./workspace-service.js";
import type { IFileSystemService } from "../interfaces/file-system-service.js";

/** A workspace, as far as its data folder is concerned. */
export interface WorkspaceDataDir {
  /** The workspace file's id. */
  readonly id: string;
  /** Its data folder (chat threads, repositories). */
  readonly dataDir: string;
}

/**
 * The data folder of a workspace file's data: the file's `dataDir` when set,
 * else `<appDataDir>/workspaces-data/<id>`. Null when the file has no id.
 */
export function workspaceDataDirOf(
  data: { readonly id?: unknown; readonly dataDir?: unknown },
  appDataDir: string,
): WorkspaceDataDir | null {
  if (typeof data.id !== "string" || !data.id) return null;
  const own = typeof data.dataDir === "string" ? data.dataDir.trim() : "";
  const dataDir = own
    ? own.replace(/^~(?=$|\/)/, process.env.HOME ?? "~")
    : path.join(appDataDir, "workspaces-data", data.id);
  return { id: data.id, dataDir };
}

/** A workspace's own repositories folder: `<dataDir>/repositories`. */
export function workspaceReposDir(workspace: WorkspaceDataDir): string {
  return path.join(workspace.dataDir, "repositories");
}

/** A repository folder: it holds the bare repository's `.git` directory. */
function isRepoDir(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The name of the repository (`<host>/<org>/<repo>`) that `changedPath` — a
 * worktree file, a git file, or the repository folder — is in. Null outside
 * any repository of `reposDir`.
 */
export function repoNameOfPath(
  reposDir: string,
  changedPath: string,
  isRepo: (dir: string) => boolean = isRepoDir,
): string | null {
  const rel = path.relative(reposDir, changedPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep);
  for (let n = 1; n <= segments.length; n++) {
    if (isRepo(path.join(reposDir, ...segments.slice(0, n)))) {
      return segments.slice(0, n).join("/");
    }
  }
  return null;
}

/** A workspace file, as far as its repositories are concerned. */
export interface WorkspaceFileRepos {
  /** The workspace file. */
  readonly file: string;
  readonly workspace: WorkspaceDataDir;
  readonly name: string;
  /** When it was last opened (ISO time), when recorded. */
  readonly lastActivatedAt?: string;
  /** When it was made (ISO time), when recorded. */
  readonly createdAt?: string;
  /** The repositories it lists (`<host>/<org>/<repo>`), valid URLs only. */
  readonly repoNames: readonly string[];
}

/**
 * Every workspace file (`*.openp41ge-workspace`) in `dir`. A file that cannot
 * be read or has no id is skipped, and `complete` is then false (its id, and
 * so its data folder, is unknown). A repo is listed by the name its URL gives,
 * even a mistyped URL: the workspace still means that repository.
 */
export function scanWorkspaceFiles(
  dir: string,
  appDataDir: string,
): { files: WorkspaceFileRepos[]; complete: boolean } {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".openp41ge-workspace"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    return { files: [], complete: missing };
  }
  const files: WorkspaceFileRepos[] = [];
  let complete = true;
  for (const name of names.sort()) {
    let data: {
      id?: unknown;
      dataDir?: unknown;
      name?: unknown;
      repos?: unknown;
      lastActivatedAt?: unknown;
      createdAt?: unknown;
    };
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
    } catch {
      complete = false;
      continue;
    }
    const workspace = data && workspaceDataDirOf(data, appDataDir);
    if (!workspace) {
      complete = false;
      continue;
    }
    const repos = Array.isArray(data.repos) ? data.repos : [];
    const repoNames = repos.flatMap((r: { url?: unknown }) =>
      typeof r?.url === "string" && r.url.trim() ? [deriveRepoName(r.url.trim())] : [],
    );
    files.push({
      file: path.join(dir, name),
      workspace,
      name: typeof data.name === "string" ? data.name : workspace.id,
      ...(typeof data.lastActivatedAt === "string"
        ? { lastActivatedAt: data.lastActivatedAt }
        : {}),
      ...(typeof data.createdAt === "string" ? { createdAt: data.createdAt } : {}),
      repoNames,
    });
  }
  return { files, complete };
}

/** Every readable workspace file in `dir` (see `scanWorkspaceFiles`). */
export function readWorkspaceFiles(dir: string, appDataDir: string): WorkspaceFileRepos[] {
  return scanWorkspaceFiles(dir, appDataDir).files;
}

/** One workspace's git services. */
export interface WorkspaceGit {
  readonly reposDir: string;
  readonly git: NodeGitService;
  readonly service: WorkspaceService;
}

export interface WorkspaceRepositoriesOptions {
  readonly fileSystem: IFileSystemService;
  /** The repositories folder of a workspace. */
  readonly reposDirOf: (workspace: WorkspaceDataDir) => string;
  /** Called once per repositories folder, when it is first used. */
  readonly onReposDir?: (reposDir: string) => void;
  /** Every workspace file (for clones two workspaces share). */
  readonly listWorkspaces?: () => readonly WorkspaceFileRepos[];
}

export class WorkspaceRepositories {
  private readonly _byWorkspace = new Map<string, WorkspaceGit>(); // workspaceId -> services
  private readonly _reposDirs = new Set<string>();

  constructor(private readonly _options: WorkspaceRepositoriesOptions) {}

  /** The workspace's git services (built on first use). */
  of(workspace: WorkspaceDataDir): WorkspaceGit {
    const known = this._byWorkspace.get(workspace.id);
    if (known) return known;
    const reposDir = this._options.reposDirOf(workspace);
    const git = new NodeGitService(reposDir);
    const created: WorkspaceGit = {
      reposDir,
      git,
      service: new WorkspaceService(git, this._options.fileSystem, reposDir),
    };
    this._byWorkspace.set(workspace.id, created);
    if (!this._reposDirs.has(reposDir)) {
      this._reposDirs.add(reposDir);
      this._options.onReposDir?.(reposDir);
    }
    return created;
  }

  /** Whether any workspace using `reposDir` is cloning `repoName`. */
  isCloning(reposDir: string, repoName: string): boolean {
    for (const git of this._byWorkspace.values()) {
      if (git.reposDir === reposDir && git.git.isCloning(repoName)) return true;
    }
    return false;
  }

  /**
   * Delete the workspace's clone `repoName` (the caller has asked the user).
   * Refused while another workspace with the same repositories folder lists
   * it: two workspace files can name the same data folder (`dataDir`), and
   * then they share its clones.
   */
  async deleteRepository(
    workspace: WorkspaceDataDir,
    repoName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const git = this.of(workspace);
    const sharedWith = (this._options.listWorkspaces?.() ?? []).filter(
      (w) =>
        w.workspace.id !== workspace.id &&
        w.repoNames.includes(repoName) &&
        this._options.reposDirOf(w.workspace) === git.reposDir,
    );
    if (sharedWith.length > 0) {
      const names = sharedWith.map((w) => `"${w.name}"`).join(", ");
      return {
        ok: false,
        error: `${repoName} is also used by workspace ${names}, so its clone is kept.`,
      };
    }
    return git.git.deleteRepository(repoName);
  }
}
