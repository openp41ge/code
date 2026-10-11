/**
 * tools/shared.ts — helpers shared by the file-mutating agent tools.
 *
 * Provides:
 *  - connected-worktree path/scope resolution (mirrors read_file / search_files),
 *  - a git-backed patch pipeline: build a git patch from old→new content and apply
 *    it with `git apply` inside the file's worktree. All file mutation goes through
 *    git; these helpers never touch the index or HEAD implicitly.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ToolExecutionContext } from "./types.js";

/** Resolve a possibly-relative path against the tool context cwd. */
export function resolvePath(p: string | undefined, ctx: ToolExecutionContext): string | undefined {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.resolve(ctx.cwd ?? process.cwd(), p);
}

/**
 * Whether `p` lies at or under `root`. Paths are compared lexically (after
 * resolving `.`/`..`) so `root` itself counts, but a sibling like `/root-evil`
 * under `/root` does not.
 */
export function isWithin(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Enforce the connected-worktree scope. Returns an in-band error string when
 * the path is not inside one of `ctx.roots`; `null` when it is allowed.
 *
 * - `roots` undefined → no scope restriction (legacy / direct tool usage).
 * - `roots` empty → nothing connected → deny the operation.
 * - `roots` non-empty → path must be within a root.
 */
export function scopeError(p: string, ctx: ToolExecutionContext): string | null {
  if (ctx.roots === undefined) return null;
  if (ctx.roots.length === 0) {
    return "no connected worktrees in scope";
  }
  if (!ctx.roots.some((root) => isWithin(p, root))) {
    return `path is outside the connected worktrees ('${p}')`;
  }
  return null;
}

/**
 * The connected roots that contain `file`. Multiple matches mean the path is
 * ambiguous (overlapping / nested worktrees) and the caller should reject.
 */
export function containingRoots(file: string, roots: string[]): string[] {
  return roots.filter((root) => isWithin(file, root));
}

/** A regular file? Rejects directories, symlinks, FIFOs, etc. */
export async function isRegularFile(p: string): Promise<boolean> {
  try {
    const st = await fs.promises.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/** Size cap for files an agent may mutate (keeps diffs/context bounded). */
export const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB

/** Reject binary or oversized files. Returns an error string or null. */
export async function guardFile(p: string): Promise<string | null> {
  const st = await fs.promises.stat(p).catch(() => null);
  if (!st) return `file does not exist ('${p}')`;
  if (st.size > MAX_FILE_BYTES) {
    return `file too large (> ${MAX_FILE_BYTES} bytes): '${p}'`;
  }
  const buf = await fs.promises.readFile(p);
  if (buf.includes(0)) return `binary file not supported ('${p}')`;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return `non-UTF-8 file not supported ('${p}')`;
  }
  return null;
}

// ─── git plumbing ─────────────────────────────────────────────────────────

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run a git subcommand. `input` (if provided) is written to stdin. By default a
 * non-zero exit is an error; pass `allowExit1` to treat exit 1 as success
 * (git's exit-code convention: 0 = clean, 1 = differences found).
 */
export function runGit(
  args: string[],
  cwd: string,
  opts: { input?: string; allowExit1?: boolean } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || (opts.allowExit1 && code === 1)) {
        resolve({ stdout, stderr, code: code ?? 0 });
      } else {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} failed (exit ${code})`));
      }
    });
    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Resolve the git top-level (worktree root) for a directory inside a git
 * repo. Returns `null` when `root` is not inside a git worktree.
 */
export async function topLevelFor(root: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-parse", "--show-toplevel"], root);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Blob hash of a file's working-tree content (no `-w`; nothing written). */
export async function blobHash(p: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["hash-object", p], path.dirname(p));
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ─── patch build / apply ──────────────────────────────────────────────────

/**
 * Compute the repo-relative path of `p` w.r.t. the worktree `top`, resolving
 * symlinks on BOTH sides. `git rev-parse --show-toplevel` returns a realpath
 * (e.g. `/private/tmp/...`) while the caller's `p` may go through a symlink
 * (e.g. `/tmp/...`); computing a relative path across the mismatch yields a
 * garbage path. For a non-existent file (a future create), the nearest existing
 * ancestor directory is realpath'd and the missing tail re-joined.
 */
export async function resolveRelPath(top: string, p: string): Promise<string> {
  let topReal: string;
  try {
    topReal = await fs.promises.realpath(top);
  } catch {
    topReal = top;
  }
  // Existing file: realpath it directly.
  try {
    const realP = await fs.promises.realpath(p);
    return path.relative(topReal, realP);
  } catch {
    // Absent file: realpath the nearest existing ancestor, rejoin the missing tail.
    const missing: string[] = [];
    let d = path.dirname(path.resolve(p));
    while (d && d !== path.dirname(d) && !fs.existsSync(d)) {
      missing.unshift(path.basename(d));
      d = path.dirname(d);
    }
    const realD = await fs.promises.realpath(d).catch(() => d);
    return path.join(path.relative(topReal, realD), ...missing, path.basename(p));
  }
}

/** Rewrite the diff's path-bearing header lines from temp basenames to `rel`. */
function rewritePatchPaths(patch: string, names: string[], rel: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (/^(diff --git|--- |\+\+\+ )/.test(line)) {
        for (const name of names) line = line.split(name).join(rel);
      }
      return line;
    })
    .join("\n");
}

/**
 * Build a git-only patch that transforms `oldContent` → `newContent` for a file
 * at repo-relative `rel`. The diff is generated by `git diff --no-index` on two
 * temp files so git owns the hunk content; only the header paths are rewritten
 * to the real target path so `git apply` lands on the working-tree file.
 */
export async function buildDiffPatch(
  rel: string,
  oldContent: string,
  newContent: string,
): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opg-patch-"));
  const oldName = `opg-old-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const newName = `opg-new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const oldFile = path.join(dir, oldName);
  const newFile = path.join(dir, newName);
  try {
    await fs.promises.writeFile(oldFile, oldContent);
    await fs.promises.writeFile(newFile, newContent);
    const { stdout } = await runGit(["diff", "--no-index", "--full-index", oldName, newName], dir, {
      allowExit1: true,
    });
    return rewritePatchPaths(stdout, [oldName, newName], rel);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** Build a git-only patch that creates a new file at repo-relative `rel`. */
export async function buildCreatePatch(rel: string, content: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opg-patch-"));
  const newName = `opg-new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const newFile = path.join(dir, newName);
  try {
    await fs.promises.writeFile(newFile, content);
    const { stdout } = await runGit(
      ["diff", "--no-index", "--full-index", "/dev/null", newName],
      dir,
      { allowExit1: true },
    );
    return rewritePatchPaths(stdout, [newName], rel);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Apply a git patch inside the worktree top-level. Rejects (throws) if the
 * patch does not apply — the caller surfaces that in-band. Only the working
 * tree is mutated; the index and HEAD are untouched.
 */
export async function applyPatch(worktreeTop: string, patch: string): Promise<void> {
  const patchFile = path.join(
    os.tmpdir(),
    `opg-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
  );
  try {
    await fs.promises.writeFile(patchFile, patch);
    await runGit(["apply", patchFile], worktreeTop);
  } finally {
    await fs.promises.rm(patchFile, { force: true });
  }
}
