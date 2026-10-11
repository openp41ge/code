import { spawn, exec, execFile } from "child_process";
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { createLogger } from "openp41ge-core-logger";
import { currentGitProblem } from "./git-binary.js";
import {
  deriveRepoName,
  validateRepoUrl,
  type BranchState,
  type RepositoryState,
} from "openp41ge-sdk";
import type {
  IGitService,
  RepoInfo,
  WorktreeInfo,
  GitCloneSession,
  GitCloneResult,
} from "../interfaces/git-service.js";

const log = createLogger("openp41ge", "node-git-service");

/**
 * Git service implementation using Node.js child_process.
 *
 * Repositories are stored under reposDir in a hierarchical layout:
 *   reposDir/<provider>/<org>/<repo>/
 *     .git/          ← bare repo internals (HEAD, config, objects/, refs/)
 *     main/          ← worktree (files from the main branch)
 *     feature/       ← worktree (files from the feature branch)
 *
 * Examples:
 *   git@github.com:user/repo.git → github/user/repo/
 *   https://gitlab.com/group/sub/project.git → gitlab/group/sub/project/
 */
/**
 * The message for a failed git command: its last `fatal:` / `error:` line, or
 * else its last line of output. Progress lines are rewritten with \r, so each
 * line counts as what a terminal would finally show.
 */
function gitErrorOf(output: string): string {
  const lines = output
    .split("\n")
    .map(
      (l) =>
        l
          .split("\r")
          .filter((p) => p.trim())
          .pop()
          ?.trim() ?? "",
    )
    .filter(Boolean);
  return [...lines].reverse().find((l) => /^(fatal|error):/.test(l)) ?? lines.pop() ?? "git failed";
}

/**
 * The branch checked out in `dirPath` (a repository folder, or a worktree whose
 * `.git` file points at its repository), read from its `HEAD`. Null when it is
 * not a git folder or `HEAD` is detached. Needs no repositories folder.
 */
export function currentBranchOf(dirPath: string): string | null {
  try {
    const gitPath = path.join(dirPath, ".git");
    const stat = fs.statSync(gitPath);
    let headPath: string;
    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, "utf-8");
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (!match) return null;
      headPath = path.join(match[1].trim(), "HEAD");
    } else if (stat.isDirectory()) {
      headPath = path.join(gitPath, "HEAD");
    } else {
      return null;
    }
    const head = fs.readFileSync(headPath, "utf-8");
    const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/m);
    return refMatch ? refMatch[1].trim() : null;
  } catch (err) {
    log.debug("currentBranchOf failed:", dirPath, err);
    return null;
  }
}

export class NodeGitService implements IGitService {
  private _reposDir: string;
  /** Repositories (by name) a clone is running for. */
  private readonly _cloning = new Set<string>();
  private _initialized = false;

  /**
   * @param gitProblem Why git is unusable (from the startup check), or null.
   *   When set, git work is refused with it instead of running git.
   */
  constructor(
    reposDir: string,
    private readonly _gitProblem: () => string | null = currentGitProblem,
  ) {
    this._reposDir = reposDir;
  }

  /** The repositories directory. */
  get reposDir(): string {
    return this._reposDir;
  }

  /** Update the repositories directory (used when switching to a project). */
  setReposDir(reposDir: string): void {
    this._reposDir = reposDir;
    this._initialized = false;
  }

  private _ensureDir(): void {
    if (!this._initialized) {
      fs.mkdirSync(this._reposDir, { recursive: true });
      this._initialized = true;
    }
  }

  /** Parent directory for a repo (where .git/ and worktrees live). */
  private _repoDir(name: string): string {
    return path.join(this._reposDir, name);
  }

  /** Bare .git directory for a repo. */
  private _gitDir(name: string): string {
    return path.join(this._reposDir, name, ".git");
  }

  /**
   * Execute a git command within a repo's parent directory using --git-dir=.git
   * so that worktree operations create siblings of .git/.
   */
  private async _execGit(args: string[], repoName: string): Promise<string> {
    const problem = this._gitProblem();
    if (problem) throw new Error(problem);
    const repoDir = this._repoDir(repoName);
    return new Promise((resolve, reject) => {
      exec(
        `git -C "${repoDir.replace(/"/g, '\\"')}" --git-dir=.git ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            const msg = stderr.trim() || error.message;
            reject(new Error(`git error: ${msg}`));
          } else {
            resolve(stdout.trim());
          }
        },
      );
    });
  }

  // ── Clone ──────────────────────────────────────────────────────────────

  clone(url: string): GitCloneSession {
    // The platform's one clone path: every clone (host.workspace, opening a
    // workspace, the preload API) is checked here, in the main process, so
    // no caller can bypass it. A non-URL never reaches `git` (no option
    // injection, no stray directories).
    const invalid = validateRepoUrl(url) ?? this._gitProblem();
    if (invalid) {
      return {
        promise: Promise.resolve({ success: false, error: invalid }),
        onProgress: () => () => {},
        abort: () => {},
      };
    }
    url = url.trim();
    this._ensureDir();
    const name = this._deriveRepoName(url);
    const repoDir = this._repoDir(name);
    const gitDir = this._gitDir(name);

    if (fs.existsSync(gitDir)) {
      return {
        promise: Promise.resolve({ success: true, path: gitDir }),
        onProgress: () => () => {},
        abort: () => {},
      };
    }

    fs.mkdirSync(repoDir, { recursive: true });

    const emitter = new EventEmitter();
    let aborted = false;

    const child = spawn("git", ["clone", "--bare", "--progress", url, gitDir], {
      cwd: this._reposDir,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 300_000,
    });

    // Keep everything git prints: the error message and the transcript come
    // from it (the stream is consumed here, so it can't be read again later).
    const command = `git clone --bare --progress ${url}`;
    let output = "";
    let lastPercent = 0;
    child.stderr!.on("data", (data: Buffer) => {
      output += data.toString("utf-8");
      if (aborted) return;
      const lines = data.toString("utf-8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const percentMatch = line.match(/(\d+)%/);
        const pct = percentMatch ? Math.min(100, Math.max(0, parseInt(percentMatch[1], 10))) : 0;
        if (pct > lastPercent) lastPercent = pct;
        emitter.emit("progress", {
          percent: Math.max(lastPercent, pct),
          message: line.trim().replace(/\r/g, ""),
        });
      }
    });

    const promise = new Promise<GitCloneResult>((resolve) => {
      child.on("close", (code) => {
        if (aborted) {
          resolve({ success: false, error: "Clone aborted" });
          return;
        }
        const transcript = { command, output };
        if (code === 0) {
          // A bare clone has no remote-tracking branches: record them now,
          // or every commit counts as unpushed until the first fetch.
          void this.fetch(name)
            .catch((err) => log.warn("clone: recording remote branches failed:", name, err))
            .finally(() => {
              emitter.emit("progress", { percent: 100, message: "Clone complete" });
              resolve({ success: true, path: gitDir, transcript });
            });
        } else {
          resolve({ success: false, error: gitErrorOf(output), transcript });
        }
      });
      child.on("error", (err) => {
        if (!aborted)
          resolve({
            success: false,
            error: err.message,
            transcript: { command, output: err.message },
          });
      });
    });

    this._cloning.add(name);
    void promise.finally(() => this._cloning.delete(name));

    return {
      promise,
      onProgress: (callback) => {
        emitter.on("progress", callback);
        return () => emitter.off("progress", callback);
      },
      abort: () => {
        aborted = true;
        child.kill("SIGTERM");
      },
    };
  }

  // ── List / get repos ──────────────────────────────────────────────────

  async listRepos(): Promise<RepoInfo[]> {
    this._ensureDir();
    const candidates: { name: string; gitDir: string }[] = [];

    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        log.debug("listRepos cannot read dir; skipping:", dir, err);
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(dir, entry.name);
        const gitDir = path.join(fullPath, ".git");
        if (fs.existsSync(gitDir)) {
          candidates.push({
            name: path.relative(this._reposDir, fullPath),
            gitDir,
          });
        }
        walk(fullPath);
      }
    };

    walk(this._reposDir);

    const repos: RepoInfo[] = [];
    for (const c of candidates) {
      try {
        const output = await this._execGit(["rev-parse", "--is-bare-repository"], c.name);
        if (output === "true") {
          let url = "";
          try {
            url = await this._execGit(["config", "--get", "remote.origin.url"], c.name);
          } catch (err) {
            log.debug("listRepos no remote URL for repo:", c.name, err);
            url = "";
          }
          repos.push({ path: c.gitDir, name: c.name, url });
        }
      } catch (err) {
        log.debug("listRepos skipping non-bare/skipped candidate:", c.name, err);
        /* skip */
      }
    }

    // Apply persisted repo order from <reposDir>/../repo-order.json
    const orderPath = path.join(this._reposDir, "..", "repo-order.json");
    try {
      if (fs.existsSync(orderPath)) {
        const order = JSON.parse(fs.readFileSync(orderPath, "utf-8")) as string[];
        const orderMap = new Map(order.map((n, i) => [n, i]));
        repos.sort((a, b) => {
          const ai = orderMap.get(a.name);
          const bi = orderMap.get(b.name);
          if (ai !== undefined && bi !== undefined) return ai - bi;
          if (ai !== undefined) return -1;
          if (bi !== undefined) return 1;
          return a.name.localeCompare(b.name);
        });
      }
    } catch (err) {
      log.debug("listRepos ignoring order file errors:", err);
      /* ignore order file errors */
    }

    return repos;
  }

  async getRepo(name: string): Promise<RepoInfo | null> {
    this._ensureDir();
    const gitDir = this._gitDir(name);
    if (!fs.existsSync(gitDir)) return null;
    try {
      const output = await this._execGit(["rev-parse", "--is-bare-repository"], name);
      if (output !== "true") return null;
      let url = "";
      try {
        url = await this._execGit(["config", "--get", "remote.origin.url"], name);
      } catch (err) {
        log.debug("getRepo no remote URL:", name, err);
        url = "";
      }
      return { path: gitDir, name, url };
    } catch (err) {
      log.debug("getRepo not found or unreadable:", name, err);
      return null;
    }
  }

  // ── Worktrees ─────────────────────────────────────────────────────────

  async listWorktrees(repoName: string): Promise<WorktreeInfo[]> {
    this._ensureDir();
    const repoDir = this._repoDir(repoName);
    if (!fs.existsSync(repoDir)) return [];

    try {
      const branchesOutput = await this._execGit(
        ["branch", "--list", "--format=%(refname:short)"],
        repoName,
      );
      const branches = branchesOutput ? branchesOutput.split("\n") : [];
      const worktrees: WorktreeInfo[] = [];
      for (const branch of branches) {
        if (!branch) continue;
        const dirName = branch.replace(/\//g, "--");
        const worktreePath = path.join(repoDir, dirName);
        const exists = fs.existsSync(worktreePath) && fs.lstatSync(worktreePath).isDirectory();
        // Keep branches whose folder is missing (exists:false) so upstream
        // surfaces can show a “not checked out / resync needed” warning.
        worktrees.push({ branch, path: worktreePath, exists });
      }
      return worktrees;
    } catch (err) {
      log.debug("listWorktrees failed; returning empty:", repoName, err);
      return [];
    }
  }

  async checkoutWorktree(repoName: string, branch: string): Promise<WorktreeInfo> {
    this._ensureDir();
    const repoDir = this._repoDir(repoName);
    const dirName = branch.replace(/\//g, "--");
    const worktreePath = path.join(repoDir, dirName);

    // Already materialized — idempotent on re-activation.
    if (fs.existsSync(worktreePath)) {
      return { branch, path: worktreePath, exists: true };
    }

    /**
     * git worktree add, tolerating stale registrations: if the path is already
     * registered in the bare repo's metadata but the folder is gone (folder
     * deleted behind git's back — "<name> is a missing but already registered
     * worktree"), prune then retry once.
     */
    const addWt = async (): Promise<void> => {
      try {
        await this._execGit(["worktree", "add", "--checkout", dirName, branch], repoName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          /already registered|missing but already registered|add -f|already used by worktree|already checked out/i.test(
            msg,
          )
        ) {
          try {
            await this._execGit(["worktree", "prune"], repoName);
            if (!fs.existsSync(worktreePath)) {
              await this._execGit(["worktree", "add", "--checkout", dirName, branch], repoName);
            }
            return;
          } catch (err2) {
            throw err2;
          }
        }
        throw err;
      }
    };

    // Check if branch exists locally.
    let branchExists = false;
    try {
      const output = await this._execGit(["rev-parse", "--verify", branch], repoName);
      branchExists = !!output;
    } catch (err) {
      log.debug("checkoutWorktree local branch check failed:", repoName, branch, err);
      branchExists = false;
    }

    try {
      if (branchExists) {
        // Local branch exists — create worktree directly.
        await addWt();
        return { branch, path: worktreePath, exists: true };
      }

      // Check if branch exists on remote.
      let remoteExists = false;
      try {
        const remoteOutput = await this._execGit(
          ["ls-remote", "--heads", "origin", branch],
          repoName,
        );
        remoteExists = !!remoteOutput.trim();
      } catch (err) {
        log.debug("checkoutWorktree remote branch check failed:", repoName, branch, err);
        remoteExists = false;
      }

      if (remoteExists) {
        // Remote branch exists — fetch it, create local tracking branch, then worktree.
        await this._execGit(["fetch", "origin", `${branch}:${branch}`], repoName);
        await addWt();
        return { branch, path: worktreePath, exists: true };
      }

      // Branch exists nowhere we can see — create it from HEAD. A concurrent
      // activation (another window) may have created it in the meantime;
      // "already exists" is not an error, just fall through to materializing
      // the worktree for the now-existing branch.
      try {
        await this._execGit(["branch", branch], repoName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(msg)) throw err;
      }
      await addWt();
      return { branch, path: worktreePath, exists: true };
    } catch (err) {
      // Another window may have checked out this branch's worktree concurrently
      // ("already used by worktree" / "already checked out"); if the dir now
      // exists, treat it as materialized instead of erroring.
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /already used by worktree|already checked out/i.test(msg) &&
        fs.existsSync(worktreePath)
      ) {
        return { branch, path: worktreePath, exists: true };
      }
      throw err;
    }
  }

  async removeWorktree(repoName: string, branch: string): Promise<{ ok: boolean; error?: string }> {
    const dirName = branch.replace(/\//g, "--");
    if (!fs.existsSync(path.join(this._repoDir(repoName), dirName))) {
      // Already gone: just forget any stale registration.
      await this._execGit(["worktree", "prune"], repoName).catch(() => undefined);
      return { ok: true };
    }
    try {
      // No --force and no fallback: uncommitted work is never deleted.
      await this._execGit(["worktree", "remove", dirName], repoName);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message.replace(/^git error: /, "") : String(err);
      return { ok: false, error: gitErrorOf(message) };
    }
  }

  /**
   * Per local branch: its worktree's uncommitted files (staged / unstaged /
   * untracked) and its commits no remote-tracking branch has. A repository
   * that is not cloned has no branches.
   */
  async repositoryState(repoName: string): Promise<RepositoryState> {
    if (!fs.existsSync(path.join(this._repoDir(repoName), ".git"))) {
      return { repoName, branches: [] };
    }
    try {
      const branches: BranchState[] = [];
      for (const wt of await this.listWorktrees(repoName)) {
        const unpushed = Number(
          await this._execGit(
            ["rev-list", "--count", `refs/heads/${wt.branch}`, "--not", "--remotes"],
            repoName,
          ),
        );
        const counts = wt.exists
          ? countStatus(await this._gitAt(wt.path, ["status", "--porcelain=v2"]))
          : { staged: 0, unstaged: 0, untracked: 0 };
        branches.push({ branch: wt.branch, worktree: wt.exists, ...counts, unpushed });
      }
      return { repoName, branches };
    } catch (err) {
      const message = err instanceof Error ? err.message.replace(/^git error: /, "") : String(err);
      return { repoName, branches: [], error: gitErrorOf(message) };
    }
  }

  /**
   * Delete the clone `repoName` (`<host>/<org>/<repo>`): its bare repository
   * and every worktree folder, uncommitted work included — the caller has
   * asked the user. Host / org folders it leaves empty go too. Refuses a name
   * that is not a repository of this folder.
   */
  async deleteRepository(repoName: string): Promise<{ ok: boolean; error?: string }> {
    const segments = repoName.split("/");
    const valid =
      !path.isAbsolute(repoName) &&
      segments.every((s) => s !== "" && s !== "." && s !== "..") &&
      fs.existsSync(path.join(this._repoDir(repoName), ".git"));
    if (!valid) return { ok: false, error: `${repoName || "(none)"} is not a repository here` };
    try {
      await fs.promises.rm(this._repoDir(repoName), { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    for (let n = segments.length - 1; n > 0; n--) {
      const dir = path.join(this._reposDir, ...segments.slice(0, n));
      try {
        await fs.promises.rmdir(dir); // only an empty folder
      } catch {
        break;
      }
    }
    return { ok: true };
  }

  /** Whether a clone of `repoName` is running. */
  isCloning(repoName: string): boolean {
    return this._cloning.has(repoName);
  }

  /** Whether any of the repository's worktrees has stashed work. */
  async hasStash(repoName: string): Promise<boolean> {
    if (!fs.existsSync(this._gitDir(repoName))) return false;
    try {
      await this._execGit(["rev-parse", "--verify", "--quiet", "refs/stash"], repoName);
      return true;
    } catch {
      return false; // no refs/stash
    }
  }

  /** Run git in `cwd` (a worktree: its `.git` file finds the repository). */
  private _gitAt(cwd: string, args: string[]): Promise<string> {
    const problem = this._gitProblem();
    if (problem) return Promise.reject(new Error(problem));
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`git error: ${stderr.trim() || error.message}`));
          else resolve(stdout);
        },
      );
    });
  }

  /**
   * Delete a worktree's folder with `git worktree remove`, never forced:
   * when git refuses (uncommitted or untracked changes) this throws its
   * message and the folder stays. A folder that is already gone is fine.
   */
  async deleteWorktree(repoName: string, branch: string): Promise<void> {
    const removed = await this.removeWorktree(repoName, branch);
    if (!removed.ok) throw new Error(removed.error ?? "git refused to remove the worktree");
  }

  async pullBranch(repoName: string, branch: string): Promise<void> {
    const dirName = branch.replace(/\//g, "--");
    const worktreePath = path.join(this._repoDir(repoName), dirName);
    const gitDir = this._gitDir(repoName);

    // Fetch latest from remote (runs from repo dir, works fine)
    await this.fetch(repoName);

    // Merge remote tracking branch into local branch.
    // Must run inside the worktree, not the bare repo dir.
    if (fs.existsSync(worktreePath)) {
      try {
        await this._execGitInDir(["merge", "--ff-only", `origin/${branch}`], worktreePath, gitDir);
      } catch (err) {
        // Fast-forward may fail; try regular merge
        log.debug("pullBranch ff merge failed; trying regular merge:", repoName, branch, err);
        await this._execGitInDir(["merge", `origin/${branch}`], worktreePath, gitDir);
      }

      // Checkout latest files into the worktree
      await this._execGitInDir(["checkout", "--", "."], worktreePath, gitDir);
    }
  }

  /**
   * Execute a git command in a specific worktree directory, pointing to the
   * shared .git directory (needed because worktrees use gitlink files).
   */
  private async _execGitInDir(args: string[], cwd: string, gitDir: string): Promise<string> {
    const problem = this._gitProblem();
    if (problem) throw new Error(problem);
    return new Promise((resolve, reject) => {
      exec(
        `git --git-dir="${gitDir}" --work-tree="${cwd}" ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`,
        {
          cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        },
        (error, stdout, stderr) => {
          if (error) {
            const msg = stderr.trim() || error.message;
            reject(new Error(`git error: ${msg}`));
          } else {
            resolve(stdout.trim());
          }
        },
      );
    });
  }

  async fetch(repoName: string): Promise<void> {
    const gitDir = this._gitDir(repoName);
    if (!fs.existsSync(gitDir)) return;
    // Fetch into remote-tracking refs (refs/remotes/origin/*) rather than
    // updating local branches directly. This avoids "cannot lock ref" errors
    // when a local branch has diverged from the remote, and ensures we don't
    // create local branches for every remote branch.
    //
    // An explicit refspec is needed because bare repos cloned via the app may
    // not have remote.origin.fetch configured (which defaults to empty).
    await this._execGit(
      ["fetch", "origin", "+refs/heads/*:refs/remotes/origin/*", "--prune"],
      repoName,
    );
  }

  async getCurrentBranch(dirPath: string): Promise<string | null> {
    return currentBranchOf(dirPath);
  }

  async listBranches(repoName: string): Promise<string[]> {
    this._ensureDir();
    const gitDir = this._gitDir(repoName);
    if (!fs.existsSync(gitDir)) return [];
    try {
      const output = await this._execGit(["branch", "-a", "--format=%(refname:short)"], repoName);
      if (!output) return [];
      const branches = output.split("\n").filter(Boolean);
      const seen = new Set<string>();
      const result: string[] = [];
      for (const b of branches) {
        const normalized = b.replace(/^origin\//, "");
        if (!seen.has(normalized) && normalized !== "HEAD") {
          seen.add(normalized);
          result.push(normalized);
        }
      }
      return result.sort();
    } catch (err) {
      log.debug("listBranches failed; returning empty:", repoName, err);
      return [];
    }
  }

  async getDefaultBranch(repoName: string): Promise<string | null> {
    this._ensureDir();
    const gitDir = this._gitDir(repoName);
    if (!fs.existsSync(gitDir)) return null;
    try {
      const output = await this._execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoName);
      if (!output) return null;
      const match = output.match(/refs\/remotes\/origin\/(.+)$/);
      return match ? match[1] : null;
    } catch (err) {
      log.debug("getDefaultBranch symbolic-ref failed; trying listBranches:", repoName, err);
      try {
        const branches = await this.listBranches(repoName);
        return branches.find((b) => b === "main" || b === "master") ?? branches[0] ?? null;
      } catch (err2) {
        log.debug("getDefaultBranch listBranches fallback failed:", repoName, err2);
        return null;
      }
    }
  }

  // ── URL parsing ────────────────────────────────────────────────────────

  /** A repo's directory under the repos dir: its workspace name. */
  private _deriveRepoName(url: string): string {
    return deriveRepoName(url);
  }
}

/**
 * Count `git status --porcelain=v2` entries: `1`/`2` (changed / renamed)
 * lines carry XY (staged, unstaged; `.` = unchanged), `u` is unmerged
 * (counted as unstaged), `?` is untracked.
 */
function countStatus(porcelain: string): {
  staged: number;
  unstaged: number;
  untracked: number;
} {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of porcelain.split("\n")) {
    const kind = line[0];
    if (kind === "?") untracked++;
    else if (kind === "u") unstaged++;
    else if (kind === "1" || kind === "2") {
      if (line[2] !== ".") staged++;
      if (line[3] !== ".") unstaged++;
    }
  }
  return { staged, unstaged, untracked };
}
