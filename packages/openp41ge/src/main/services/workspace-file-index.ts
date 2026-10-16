/**
 * workspace-file-index.ts — the files the open palette (Cmd+N) finds: every
 * file of the calling workspace's worktrees, as git sees them (tracked, plus
 * untracked files it does not ignore — so no `node_modules`).
 *
 * A worktree's listing is cached until a file changes under it
 * (`invalidate`, from the repositories watcher) or `ttlMs` passes, and is
 * matched here, in the main process, so only the best matches cross IPC.
 */

import path from "path";
import type { WorkspaceRoot } from "openp41ge-sdk";
import { matchFile } from "../../shared/open-palette-ranking.js";

/** Lists a worktree's files, relative to it (`/`-separated). */
export interface FileLister {
  list(root: string): Promise<string[]>;
}

/** A file the index found. */
export interface IndexedFile {
  readonly path: string;
  /** Relative to its worktree. */
  readonly relPath: string;
  readonly repoName: string;
  readonly branch: string;
}

export interface FileIndexOptions {
  /** How long a listing is used before it is listed again (default 30 s). */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export class WorkspaceFileIndex {
  private readonly _ttlMs: number;
  private readonly _now: () => number;
  private readonly _cache = new Map<string, { files: Promise<string[]>; at: number }>();

  constructor(
    private readonly _lister: FileLister,
    options: FileIndexOptions = {},
  ) {
    this._ttlMs = options.ttlMs ?? 30_000;
    this._now = options.now ?? Date.now;
  }

  private _files(root: string): Promise<string[]> {
    const hit = this._cache.get(root);
    if (hit && this._now() - hit.at <= this._ttlMs) return hit.files;
    const files = this._lister.list(root);
    this._cache.set(root, { files, at: this._now() });
    return files;
  }

  /** The `limit` files of `roots` that best match `query`. */
  async search(
    roots: readonly WorkspaceRoot[],
    query: string,
    limit: number,
  ): Promise<IndexedFile[]> {
    const scored: { file: IndexedFile; score: number }[] = [];
    for (const root of roots) {
      for (const relPath of await this._files(root.path)) {
        const score = matchFile(query, relPath);
        if (score === null) continue;
        scored.push({
          score,
          file: {
            path: path.join(root.path, relPath),
            relPath,
            repoName: root.repoName,
            branch: root.branch,
          },
        });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.file);
  }

  /** A file changed at `changedPath`: forget the listing of the worktree it is in. */
  invalidate(changedPath: string): void {
    for (const root of this._cache.keys()) {
      if (changedPath === root || changedPath.startsWith(root + path.sep)) this._cache.delete(root);
    }
  }
}
