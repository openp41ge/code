/**
 * ReposWatcher — watches the repositories directory in the main process and
 * reports filesystem changes to renderer windows so the Explorer stays in sync
 * with external edits (deletes/creates/renames made outside the app).
 *
 * Uses Node's `fs.watch` with the recursive flag (kernel FSEvents on macOS,
 * ReadDirectoryChangesW on Windows). On platforms that don't support recursive
 * watching (Linux), it falls back to watching every directory in the tree
 * non-recursively and re-scanning for new directories as they appear.
 *
 * Events are debounced per path and filtered to skip high-noise subtrees such
 * as `.git`, `node_modules`, and build output that the Explorer doesn't show.
 * Inside a repository's `.git`, the files that change a branch's state
 * (refs, a worktree's HEAD / index — commits, pushes, staging, checkouts)
 * are reported separately, to `onGitState`.
 */

import fs from "fs";
import path from "path";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "repos-watcher");

/** Debounce per-path so bursty writes (a build, a multi-file save) coalesce. */
const DEBOUNCE_MS = 200;

/** Directories whose changes are not shown in the Explorer — skip entirely. */
const IGNORED_SUBPATH_SEGMENTS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  ".venv",
  "__pycache__",
  "coverage",
  "target",
  ".turbo",
];

/**
 * Whether `rel` (relative to the repositories folder) is a git file whose
 * change changes a branch's state: `<repo>/.git/` refs, packed-refs, HEAD,
 * or a worktree's HEAD / index. Never a lock file.
 */
export function isGitStatePath(rel: string): boolean {
  const segments = rel.split(path.sep);
  const at = segments.indexOf(".git");
  if (at < 0) return false;
  // Within a worktree's ignored folders (e.g. node_modules/.git): not ours.
  if (segments.slice(0, at).some((seg) => IGNORED_SUBPATH_SEGMENTS.includes(seg))) return false;
  const inGit = segments.slice(at + 1);
  const last = inGit[inGit.length - 1] ?? "";
  if (last.endsWith(".lock")) return false;
  if (inGit[0] === "refs") return inGit.length > 1;
  if (inGit.length === 1) return last === "packed-refs" || last === "HEAD";
  return inGit[0] === "worktrees" && inGit.length === 3 && (last === "HEAD" || last === "index");
}

export class ReposWatcher {
  private _watchers = new Map<string, fs.FSWatcher>();
  private _debounces = new Map<string, NodeJS.Timeout>();
  private _rescanTimer: NodeJS.Timeout | null = null;
  private _started = false;
  private _closed = false;

  constructor(
    private readonly _root: string,
    private readonly _onChange: (changedPath: string) => void,
    /** A git state file changed (see isGitStatePath). */
    private readonly _onGitState?: (changedPath: string) => void,
  ) {}

  /** Begin watching. Idempotent — safe to call multiple times. */
  start(): void {
    if (this._started || this._closed) return;
    this._started = true;
    try {
      fs.mkdirSync(this._root, { recursive: true });
    } catch (err) {
      // Root dir may be unavailable (e.g. unmounted) — watch will retry next start.
      log.warn("repos-watcher root dir unavailable; watch will retry on next start:", this._root, err);
    }
    this._watchRecursive();
  }

  /** Stop watching and cancel all pending events. */
  stop(): void {
    this._closed = true;
    for (const w of this._watchers.values()) {
      try {
        w.close();
      } catch (err) {
        /* already closed */
        log.debug("repos-watcher close watcher failed (already closed):", err);
      }
    }
    this._watchers.clear();
    for (const t of this._debounces.values()) clearTimeout(t);
    this._debounces.clear();
    if (this._rescanTimer) clearTimeout(this._rescanTimer);
  }

  // ── Recursive watch (macOS/Windows) ───────────────────────────────────

  private _watchRecursive(): void {
    try {
      const watcher = fs.watch(this._root, { recursive: true }, (_event, filename) => {
        const changed = filename ? path.resolve(this._root, filename.toString()) : this._root;
        this._schedule(changed);
      });
      watcher.on("error", () => {
        // Recursive not supported (Linux) — close and fall back to manual tree watch.
        log.info("recursive watch unsupported; falling back to per-directory watch");
        try {
          watcher.close();
        } catch (err) {
          log.debug("repos-watcher close watcher failed:", err);
        }
        this._watchers.delete(this._root);
        this._watchTree();
      });
      this._watchers.set(this._root, watcher);
    } catch (err) {
      log.warn("recursive watch failed; falling back to per-directory watch:", err);
      this._watchTree();
    }
  }

  // ── Per-directory fallback (Linux) ────────────────────────────────────

  private _watchTree(): void {
    for (const dir of this._collectDirs(this._root)) {
      if (!this._watchers.has(dir)) this._addDirWatcher(dir);
    }
  }

  private _collectDirs(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        log.debug("repos-watcher cannot read dir while collecting:", dir, err);
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
      }
      out.push(dir);
    };
    walk(root);
    return out;
  }

  private _addDirWatcher(dir: string): void {
    try {
      const watcher = fs.watch(dir, (_event, filename) => {
        const changed = filename ? path.join(dir, filename.toString()) : dir;
        this._schedule(changed);
        // A change may have added a directory — rescan to watch it too.
        this._scheduleRescan();
      });
      watcher.on("error", () => {
        log.warn("repos-watcher dir watcher error; dropping watcher:", dir);
        try {
          watcher.close();
        } catch (err) {
          log.debug("repos-watcher close dir watcher failed:", err);
        }
        this._watchers.delete(dir);
      });
      this._watchers.set(dir, watcher);
    } catch (err) {
      /* directory disappeared or unreadable */
      log.debug("repos-watcher cannot add dir watcher; directory disappeared or unreadable:", dir, err);
    }
  }

  private _scheduleRescan(): void {
    if (this._rescanTimer) return;
    this._rescanTimer = setTimeout(() => {
      this._rescanTimer = null;
      this._watchTree();
    }, DEBOUNCE_MS * 2);
  }

  // ── Event flow ────────────────────────────────────────────────────────

  private _schedule(changedPath: string): void {
    if (this._closed) return;
    const report = this._shouldReport(changedPath)
      ? this._onChange
      : this._onGitState && isGitStatePath(path.relative(this._root, changedPath))
        ? this._onGitState
        : null;
    if (!report) return;
    const key = changedPath;
    const existing = this._debounces.get(key);
    if (existing) clearTimeout(existing);
    this._debounces.set(
      key,
      setTimeout(() => {
        this._debounces.delete(key);
        if (this._closed) return;
        report(changedPath);
      }, DEBOUNCE_MS),
    );
  }

  /** Whether a changed path is worth reporting (skip git internals, node_modules, etc.). */
  private _shouldReport(changedPath: string): boolean {
    const rel = path.relative(this._root, changedPath);
    // A change to a repo root itself matters (a worktree folder created/deleted).
    if (!rel) return true;
    const segments = rel.split(path.sep);
    for (const seg of segments) {
      if (IGNORED_SUBPATH_SEGMENTS.includes(seg)) return false;
    }
    return true;
  }
}
