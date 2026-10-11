/**
 * commit-cell-model.ts — the commit cell's state: one commit (message,
 * author, date, refs, parents) and the files it changes, loaded through the
 * injected `CommitCellApi` (the extension's backend). No DOM.
 */

import type { CommitEntry, DiffStatEntry } from "./git-types.js";
import { newPath } from "./repository-cell-model.js";

/** Git, for one repository. Every call may reject with git's error. */
export interface CommitCellApi {
  /** The commit, or null when there is no such commit. */
  commit(hash: string): Promise<CommitEntry | null>;
  diffStat(hash: string): Promise<DiffStatEntry[]>;
}

export type CommitSectionKey = "commit" | "files";

export interface CommitCellState {
  readonly repoName: string;
  readonly hash: string;
  readonly loading: boolean;
  /** Why the commit is not shown. */
  readonly error?: string;
  readonly commit: CommitEntry | null;
  readonly files: readonly DiffStatEntry[];
  readonly collapsed: readonly CommitSectionKey[];
}

export class CommitCellModel {
  private _state: CommitCellState;
  private _started = false;
  private _token = 0;

  constructor(
    private readonly _api: CommitCellApi,
    params: { readonly repoName: string; readonly hash: string },
    private readonly _changed: () => void,
  ) {
    this._state = {
      repoName: params.repoName,
      hash: params.hash,
      loading: true,
      commit: null,
      files: [],
      collapsed: [],
    };
  }

  get state(): CommitCellState {
    return this._state;
  }

  private _set(update: Partial<CommitCellState>): void {
    this._state = { ...this._state, ...update };
    this._changed();
  }

  /** Load the commit (once). */
  start(): void {
    if (this._started) return;
    this._started = true;
    void this._load();
  }

  refresh(): void {
    this._set({ loading: true });
    void this._load();
  }

  private async _load(): Promise<void> {
    const token = ++this._token;
    const hash = this._state.hash;
    try {
      const [commit, files] = await Promise.all([
        this._api.commit(hash),
        this._api.diffStat(hash).catch(() => [] as DiffStatEntry[]),
      ]);
      if (token !== this._token) return;
      if (!commit) {
        this._set({ loading: false, commit: null, files: [], error: `Commit ${hash} not found` });
        return;
      }
      this._set({ loading: false, commit, files, error: undefined });
    } catch (err) {
      if (token !== this._token) return;
      this._set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  toggleSection(section: CommitSectionKey): void {
    const collapsed = this._state.collapsed;
    this._set({
      collapsed: collapsed.includes(section)
        ? collapsed.filter((s) => s !== section)
        : [...collapsed, section],
    });
  }

  /** The File diff tab's params for a file row, or null. */
  fileDiffParams(filePath: string): Record<string, string> | null {
    const path = newPath(filePath);
    return path ? { repoName: this._state.repoName, path, hash: this._state.hash } : null;
  }
}
