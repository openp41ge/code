/**
 * Moves the app's storage from the old "openp41ge" names to the "openp41ge
 * code" ones (`app-data-dir.ts`), once, on the first start of a version that
 * uses the new names:
 *
 *   - the data folder (`~/.openp41ge` → `~/.openp41ge-code`, and the dev
 *     build's `~/.openp41ge-dev` → `~/.openp41ge-code-dev`)
 *   - Chromium's profile folder (`openp41ge` → `openp41ge code`, and
 *     `openp41ge-dev` → `openp41ge code development`)
 *
 * A folder moves only when the new one does not exist yet and the old one
 * does. If the move fails, the app keeps using the old folder for this run
 * and tries again on the next start, so nothing is lost.
 *
 * After the data folder moves, the paths saved inside it that point into it
 * follow: each workspace file's `dataDir`, the manager grid's workspace paths,
 * and the git worktree links of the workspaces' repositories. Logs and chat
 * histories keep the paths they recorded.
 */

import fs from "fs";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "storage-rename");

/** The data folder's name before the rename, by packaged state. */
export function legacyAppDataDirName(isPackaged: boolean): string {
  return isPackaged ? ".openp41ge" : ".openp41ge-dev";
}

/** Chromium's profile folder's name before the rename, by packaged state. */
export function legacyChromiumProfileDirName(isPackaged: boolean): string {
  return isPackaged ? "openp41ge" : "openp41ge-dev";
}

/** The file system, as far as the move uses it. */
export interface StorageFs {
  exists(p: string): boolean;
  isDirectory(p: string): boolean;
  readdir(p: string): string[];
  readFile(p: string): string;
  writeFile(p: string, data: string): void;
  rename(from: string, to: string): void;
}

export const nodeStorageFs: StorageFs = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readdir: (p) => fs.readdirSync(p),
  readFile: (p) => fs.readFileSync(p, "utf-8"),
  writeFile: (p, data) => fs.writeFileSync(p, data, "utf-8"),
  rename: (from, to) => fs.renameSync(from, to),
};

/** How deep below `workspaces-data` repositories are looked for. */
const REPO_SEARCH_DEPTH = 8;

export class StorageMove {
  constructor(private readonly _fs: StorageFs = nodeStorageFs) {}

  /**
   * Move `from` to `to` if only `from` exists. Returns the folder to use:
   * `to`, or `from` when the move failed.
   */
  moveFolder(from: string, to: string): string {
    if (this._fs.exists(to) || !this._fs.exists(from)) return to;
    try {
      this._fs.rename(from, to);
      log.info("moved", { from, to });
      return to;
    } catch (err) {
      log.error("move failed; using the old folder", { from, to }, err);
      return from;
    }
  }

  /** Move the data folder (see `moveFolder`), then its saved paths with it. */
  moveDataDir(from: string, to: string): string {
    const moved = !this._fs.exists(to) && this._fs.exists(from);
    const dir = this.moveFolder(from, to);
    if (moved && dir === to) this._rewriteSavedPaths(from, to);
    return dir;
  }

  private _rewriteSavedPaths(from: string, to: string): void {
    const rewrite = (s: string) => movedPath(s, from, to);
    const workspaces = `${to}/workspaces`;
    if (this._fs.isDirectory(workspaces)) {
      for (const name of this._fs.readdir(workspaces)) {
        if (name.endsWith(".openp41ge-workspace"))
          this._rewriteJson(`${workspaces}/${name}`, rewrite);
      }
    }
    this._rewriteJson(`${to}/manager-grid.json`, rewrite);
    this._repairWorktrees(`${to}/workspaces-data`, rewrite, REPO_SEARCH_DEPTH);
  }

  /** Rewrite every string in a JSON file; a file that does not parse stays. */
  private _rewriteJson(file: string, rewrite: (s: string) => string): void {
    if (!this._fs.exists(file)) return;
    try {
      const before = this._fs.readFile(file);
      const data = JSON.parse(before) as unknown;
      const moved = mapStrings(data, rewrite);
      if (JSON.stringify(moved) === JSON.stringify(data)) return;
      // Keep the file's layout: indented or not, with or without a final newline.
      const indent = /^\s*[{[]\r?\n/.test(before) ? 2 : undefined;
      const end = before.endsWith("\n") ? "\n" : "";
      this._fs.writeFile(file, JSON.stringify(moved, null, indent) + end);
    } catch (err) {
      log.warn("could not update saved paths in", file, err);
    }
  }

  /**
   * Find the repositories under `dir` (a folder with a `.git` entry; not
   * looked into further) and repair their worktrees' links.
   */
  private _repairWorktrees(dir: string, rewrite: (s: string) => string, depth: number): void {
    if (depth < 0 || !this._fs.isDirectory(dir)) return;
    const names = this._fs.readdir(dir);
    if (names.includes(".git")) {
      this._repairRepo(`${dir}/.git`, rewrite);
      return;
    }
    for (const name of names) this._repairWorktrees(`${dir}/${name}`, rewrite, depth - 1);
  }

  /**
   * A repository's worktrees are linked both ways by absolute paths:
   * `.git/worktrees/<name>/gitdir` holds the worktree's `.git` file, which
   * holds `gitdir: <the .git/worktrees/<name> folder>`.
   */
  private _repairRepo(gitDir: string, rewrite: (s: string) => string): void {
    const worktrees = `${gitDir}/worktrees`;
    if (!this._fs.isDirectory(worktrees)) return;
    for (const name of this._fs.readdir(worktrees)) {
      try {
        const link = `${worktrees}/${name}/gitdir`;
        if (!this._fs.exists(link)) continue;
        const target = rewrite(this._fs.readFile(link).trim());
        this._rewriteLine(link, () => target);
        if (this._fs.exists(target) && !this._fs.isDirectory(target)) {
          this._rewriteLine(target, (line) =>
            line.startsWith("gitdir: ") ? `gitdir: ${rewrite(line.slice(8))}` : line,
          );
        }
      } catch (err) {
        log.warn("could not repair worktree", { gitDir, name }, err);
      }
    }
  }

  /** Rewrite a one-line file (keeping its line ending), if it changes. */
  private _rewriteLine(file: string, rewrite: (line: string) => string): void {
    const before = this._fs.readFile(file);
    const line = before.replace(/\r?\n$/, "");
    const after = rewrite(line) + before.slice(line.length);
    if (after !== before) this._fs.writeFile(file, after);
  }
}

/** `p` with `from` replaced by `to`, when `p` is `from` or inside it. */
function movedPath(p: string, from: string, to: string): string {
  if (p === from) return to;
  return p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}
