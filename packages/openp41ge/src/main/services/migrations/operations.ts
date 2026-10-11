/**
 * operations.ts — the file operations data migrations are built from (the
 * downloadable instruction sets' vocabulary, and the built-in migrations).
 */

import fs from "fs";
import path from "path";
import { createLogger } from "openp41ge-core-logger";
import type { WorkspaceFileRepos } from "../workspace-repositories.js";

const log = createLogger("openp41ge", "migration-operations");

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The clones in `reposDir` (folders holding a `.git` folder), by name. */
export function findClones(reposDir: string): string[] {
  const found: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(reposDir, rel);
    if (rel && isDir(path.join(abs, ".git"))) {
      found.push(rel.split(path.sep).join("/"));
      return;
    }
    let names: string[] = [];
    try {
      names = fs
        .readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const name of names) walk(path.join(rel, name));
  };
  walk("");
  return found;
}

/**
 * Remove `dir` when nothing but empty folders is left in it (clones are
 * never entered). Returns whether it is gone.
 */
export function removeIfEmpty(dir: string): boolean {
  if (!isDir(dir) || isDir(path.join(dir, ".git"))) return false;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const e of entries) {
    if (!e.isDirectory() || !removeIfEmpty(path.join(dir, e.name))) empty = false;
  }
  if (!empty) return false;
  try {
    fs.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/** Most recently opened first; never-opened last, in file order. */
export function byRecentUse(a: WorkspaceFileRepos, b: WorkspaceFileRepos): number {
  const t = (w: WorkspaceFileRepos) => (w.lastActivatedAt ? Date.parse(w.lastActivatedAt) || 0 : 0);
  return t(b) - t(a);
}

/** Move a folder (across volumes too). */
export function move(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Relink the worktrees of the clone moved from `from` to `to` (what
 * `git worktree repair` does, limited to this clone's own worktrees):
 *   - `.git/worktrees/<n>/gitdir` names `<worktree>/.git` → its new place;
 *   - the worktree's `.git` file names `<repo>/.git/worktrees/<n>` → the new
 *     repository.
 * A worktree recorded outside the clone is left alone: it did not move, and
 * `git worktree repair` would repoint whatever is there (e.g. the original
 * of a copied clone) at this repository. Git records real paths, so `from`
 * is matched as given and resolved (`fromReal`).
 */
export function relinkWorktrees(from: string, fromReal: string, to: string): void {
  const records = path.join(to, ".git", "worktrees");
  let names: string[] = [];
  try {
    names = fs.readdirSync(records);
  } catch {
    return;
  }
  for (const name of names) {
    const record = path.join(records, name, "gitdir");
    try {
      const gitFile = fs.readFileSync(record, "utf-8").trim();
      const prefix = [from, fromReal].find((p) => gitFile.startsWith(p + path.sep));
      if (!prefix) continue;
      const movedGitFile = to + gitFile.slice(prefix.length);
      if (!fs.existsSync(movedGitFile)) continue;
      fs.writeFileSync(record, `${movedGitFile}\n`, "utf-8");
      fs.writeFileSync(movedGitFile, `gitdir: ${path.join(records, name)}\n`, "utf-8");
    } catch (err) {
      log.warn("could not relink worktree:", record, err);
    }
  }
}

/** `value` with every string at or under an old prefix moved to its new one. */
export function rewritePaths(value: unknown, prefixes: ReadonlyArray<[string, string]>): unknown {
  if (typeof value === "string") {
    for (const [from, to] of prefixes) {
      if (value === from || value.startsWith(from + "/")) return to + value.slice(from.length);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, prefixes));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewritePaths(v, prefixes)]),
    );
  }
  return value;
}

export function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.migrating`;
  fs.writeFileSync(tmp, contents, "utf-8");
  fs.renameSync(tmp, file);
}
