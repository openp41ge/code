/**
 * repository-cleanup.ts — the platform's cleanup of what no workspace uses.
 *
 * A run deletes, when nothing in it is work that exists nowhere else:
 *   - a clone no workspace (using that repositories folder) lists;
 *   - empty folders in a repositories folder;
 *   - a deleted workspace's data folder (no workspace file has its id), chat
 *     threads included;
 *   - the old `workspaces-data/<id>/repos/` copies of the workspaces
 *     extension's first design.
 * Anything with uncommitted, unpushed or stashed work, or whose state cannot
 * be read, is kept and listed instead (the Cleanup tab) for
 * the user to decide. A clone being cloned, or cloned less than a day ago, is
 * never touched: the workspace editor clones before Save lists it.
 */

import fs from "fs";
import path from "path";
import type { RepositoryState } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";
import type { WorkspaceDataDir, WorkspaceFileRepos } from "./workspace-repositories.js";

const log = createLogger("openp41ge", "repository-cleanup");

/** A clone's work that exists nowhere else: its state, and any stash. */
export interface RepoWork extends RepositoryState {
  readonly stashed: boolean;
}

/** Something cleanup kept because it holds work (or its state is unknown). */
export interface CleanupItem {
  /** A clone, or a deleted workspace's data folder. */
  readonly kind: "repository" | "workspace";
  /** The folder. */
  readonly path: string;
  /** The repository (`<host>/<org>/<repo>`), or the workspace id. */
  readonly name: string;
  /** The clones in it, each with its branches' work. */
  readonly repositories: readonly RepoWork[];
}

export interface CleanupDeps {
  /** The app's data folder (`workspaces-data/` lives in it). */
  readonly appDataDir: string;
  /** Repositories folders to scan besides the workspaces' own. */
  readonly reposDirs: () => readonly string[];
  /** Every workspace file; `complete` is false when one could not be read. */
  readonly workspaces: () => {
    readonly files: readonly WorkspaceFileRepos[];
    readonly complete: boolean;
  };
  /** The repositories folder a workspace uses. */
  readonly reposDirOf: (workspace: WorkspaceDataDir) => string;
  /** A clone's work. Never rejects; a failure is `error`. */
  readonly work: (reposDir: string, repoName: string) => Promise<RepoWork>;
  /** Whether a clone of `repoName` is running in `reposDir`. */
  readonly isCloning: (reposDir: string, repoName: string) => boolean;
  readonly now?: () => number;
}

/** A clone younger than this is never touched. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether `state` holds work that exists nowhere else (or is unknown). */
function hasWork(work: RepoWork): boolean {
  if (work.error || work.stashed) return true;
  return work.branches.some(
    (b) => b.staged > 0 || b.unstaged > 0 || b.untracked > 0 || b.unpushed > 0,
  );
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** The clones in `reposDir` (folders holding a `.git` folder), by name. */
function findClones(reposDir: string): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(reposDir, rel);
    if (rel && isDir(path.join(abs, ".git"))) {
      found.push(rel.split(path.sep).join("/"));
      return;
    }
    for (const name of subdirs(abs)) walk(path.join(rel, name));
  };
  walk("");
  return found;
}

/** Whether anything under `dir` is a git folder. */
function containsGit(dir: string): boolean {
  for (const name of subdirs(dir)) {
    if (name === ".git" || containsGit(path.join(dir, name))) return true;
  }
  return false;
}

/**
 * Remove the empty folders under a repositories folder `dir` (not `dir`
 * itself), deepest first. Clones are not entered: their folders are theirs.
 * Returns the folders removed.
 */
function removeEmptyDirs(dir: string): string[] {
  const removed: string[] = [];
  for (const name of subdirs(dir)) {
    const child = path.join(dir, name);
    if (isDir(path.join(child, ".git"))) continue;
    removed.push(...removeEmptyDirs(child));
    try {
      fs.rmdirSync(child); // only when empty
      removed.push(child);
    } catch {
      // not empty
    }
  }
  return removed;
}

export class RepositoryCleanup {
  private _items: CleanupItem[] = [];
  private _running: Promise<{ deleted: string[]; kept: CleanupItem[] }> | null = null;
  private readonly _listeners = new Set<() => void>();

  constructor(private readonly _deps: CleanupDeps) {}

  /** What the last run kept (the Cleanup tab). */
  list(): readonly CleanupItem[] {
    return this._items;
  }

  /** Called whenever the list changes. Returns unsubscribe. */
  onChange(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Run once (a run already going is joined, not repeated). */
  run(): Promise<{ deleted: string[]; kept: CleanupItem[] }> {
    if (!this._running) {
      this._running = this._run().finally(() => {
        this._running = null;
      });
    }
    return this._running;
  }

  /** Delete a listed item's folder (the user asked). Refuses any other path. */
  async delete(target: string): Promise<{ ok: boolean; error?: string }> {
    const item = this._items.find((i) => i.path === target);
    if (!item) return { ok: false, error: `${target} is not listed for cleanup` };
    try {
      await fs.promises.rm(item.path, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (item.kind === "repository") {
      for (const dir of this._allReposDirs()) {
        if (item.path.startsWith(dir + path.sep)) removeEmptyDirs(dir);
      }
    }
    this._setItems(this._items.filter((i) => i !== item));
    return { ok: true };
  }

  private _allReposDirs(): string[] {
    const { files } = this._deps.workspaces();
    return [
      ...new Set([
        ...this._deps.reposDirs(),
        ...files.map((f) => this._deps.reposDirOf(f.workspace)),
      ]),
    ];
  }

  private async _run(): Promise<{ deleted: string[]; kept: CleanupItem[] }> {
    const deleted: string[] = [];
    const kept: CleanupItem[] = [];
    const { files, complete } = this._deps.workspaces();

    // ── Clones no workspace lists ──────────────────────────────────────
    for (const reposDir of this._allReposDirs()) {
      const listed = new Set(
        files
          .filter((f) => this._deps.reposDirOf(f.workspace) === reposDir)
          .flatMap((f) => f.repoNames),
      );
      for (const repoName of findClones(reposDir)) {
        if (listed.has(repoName)) continue;
        const repoDir = path.join(reposDir, repoName);
        if (this._untouchable(reposDir, repoName)) continue;
        const work = await this._deps.work(reposDir, repoName);
        if (hasWork(work)) {
          kept.push({ kind: "repository", path: repoDir, name: repoName, repositories: [work] });
          continue;
        }
        if (await this._remove(repoDir)) deleted.push(repoDir);
      }
      deleted.push(...removeEmptyDirs(reposDir));
    }

    // ── Workspace data folders ─────────────────────────────────────────
    const dataRoot = path.join(this._deps.appDataDir, "workspaces-data");
    const ids = new Set(files.map((f) => f.workspace.id));
    for (const id of subdirs(dataRoot)) {
      const folder = path.join(dataRoot, id);
      if (ids.has(id)) {
        // The workspaces extension's old private copies (not git repos).
        const legacy = path.join(folder, "repos");
        if (isDir(legacy) && !containsGit(legacy) && (await this._remove(legacy))) {
          deleted.push(legacy);
        }
        continue;
      }
      // An unreadable workspace file might be this one: leave every folder.
      if (!complete) continue;
      const reposDir = path.join(folder, "repositories");
      const clones = findClones(reposDir);
      if (clones.some((name) => this._untouchable(reposDir, name))) continue;
      const work: RepoWork[] = [];
      for (const name of clones) work.push(await this._deps.work(reposDir, name));
      if (work.some(hasWork)) {
        kept.push({ kind: "workspace", path: folder, name: id, repositories: work });
        continue;
      }
      if (await this._remove(folder)) deleted.push(folder);
    }

    if (deleted.length > 0) log.info("cleanup deleted:", deleted.join(", "));
    this._setItems(kept);
    return { deleted, kept };
  }

  /** Being cloned, or cloned less than a day ago. */
  private _untouchable(reposDir: string, repoName: string): boolean {
    if (this._deps.isCloning(reposDir, repoName)) return true;
    try {
      const st = fs.statSync(path.join(reposDir, repoName, ".git"));
      const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
      return (this._deps.now?.() ?? Date.now()) - born < MIN_AGE_MS;
    } catch {
      return true;
    }
  }

  private async _remove(dir: string): Promise<boolean> {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return true;
    } catch (err) {
      log.warn("cleanup could not delete:", dir, err);
      return false;
    }
  }

  private _setItems(items: CleanupItem[]): void {
    if (JSON.stringify(items) === JSON.stringify(this._items)) return;
    this._items = items;
    for (const fn of this._listeners) fn();
  }
}
