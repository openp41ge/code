/**
 * repository-cell-model.ts — the repository cell's state and what changes it:
 * loading branches and commits, the selection, "Show more", refreshes, and
 * the worktree's uncommitted changes as they come and go.
 *
 * The cell is a repository (`{ repoName }`: Branches, Commits, Files changed)
 * or one of its worktrees (`{ repoName, branch }`: Commits and Files changed
 * for that branch). Git runs through the injected `RepositoryCellApi` (the
 * extension's backend); the platform's facts — whether the repository is
 * cloned, its branches' state — arrive with every render (`setContext`). A
 * change in the repository's state (the platform watches its files and refs)
 * reloads the uncommitted files and the commits, so a commit made in the
 * worktree shows at once.
 *
 * No DOM: the view (repository-cell-view.ts) renders `state`.
 */

import type { RepositoryState } from "openp41ge-sdk";
import type { BranchEntry, CommitEntry, DiffStatEntry } from "./git-types.js";

/** Git, for one repository. Every call may reject with git's error. */
export interface RepositoryCellApi {
  /** `git fetch` from the remote; best-effort (a failure is ignored). */
  fetch(): Promise<void>;
  branches(): Promise<BranchEntry[]>;
  commitLog(branch: string, page: { maxCount: number; skip: number }): Promise<CommitEntry[]>;
  /** A commit's changed files. */
  diffStat(hash: string): Promise<DiffStatEntry[]>;
  /** A worktree's uncommitted files (changed, then untracked). */
  uncommittedFiles(worktree: string): Promise<DiffStatEntry[]>;
}

export type SectionKey = "branches" | "commits" | "files";

/** What Files changed lists: nothing, the worktree's uncommitted files, or a commit's. */
export type Selection =
  | { readonly kind: "none" }
  | { readonly kind: "uncommitted" }
  | { readonly kind: "commit"; readonly hash: string };

export interface RepositoryCellState {
  readonly repoName: string;
  /** A worktree cell's branch (no Branches section). */
  readonly worktreeBranch?: string;
  /** Why the cell shows nothing (not cloned, or the branches failed). */
  readonly error?: string;
  readonly branches: readonly BranchEntry[];
  readonly loadingBranches: boolean;
  /** The branch whose commits show (a branch row's full name). */
  readonly selectedBranch: string;
  readonly commits: readonly CommitEntry[];
  readonly loadingCommits: boolean;
  readonly visibleCommitCount: number;
  readonly hasMoreCommits: boolean;
  readonly selection: Selection;
  /** The selected commit's files. */
  readonly commitFiles: readonly DiffStatEntry[];
  readonly loadingFiles: boolean;
  /** The selected branch's worktree: its branch, null when it has none,
   *  undefined while the repository's state is not known. */
  readonly worktree: string | null | undefined;
  /** That worktree's uncommitted files (null: none known). */
  readonly uncommitted: readonly DiffStatEntry[] | null;
  /** Collapsed sections. */
  readonly collapsed: readonly SectionKey[];
}

const PAGE = 50;
const SHOW = 10;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The local branch name a branch row's full name stands for, if it is local. */
function localBranch(state: RepositoryCellState, name: string): string | undefined {
  if (state.worktreeBranch) return state.worktreeBranch;
  const entry = state.branches.find((b) => b.name === name);
  return entry?.isLocal ? entry.name : undefined;
}

/** The selected branch's worktree (its local branch name), null when it has
 *  none, undefined while the repository's state is not known. */
export function selectedWorktree(
  state: RepositoryCellState,
  repositoryState: RepositoryState | undefined,
): string | null | undefined {
  const local = localBranch(state, state.selectedBranch);
  if (!local) return null;
  if (!repositoryState) return state.worktreeBranch ? local : undefined;
  const branch = repositoryState.branches.find((b) => b.branch === local);
  if (branch) return branch.worktree ? local : null;
  // A worktree cell's branch the state does not list yet is still its worktree.
  return state.worktreeBranch ? local : null;
}

/** Whether the commit list starts with the "Uncommitted changes" entry. */
export function showsUncommitted(state: RepositoryCellState): boolean {
  return (state.uncommitted?.length ?? 0) > 0;
}

/** What the Files changed section shows: its files, or a message. */
export function filesSection(state: RepositoryCellState): {
  readonly files: readonly DiffStatEntry[];
  readonly loading: boolean;
  readonly message?: string;
} {
  const sel = state.selection;
  if (sel.kind === "commit") {
    return {
      files: state.commitFiles,
      loading: state.loadingFiles,
      ...(state.commitFiles.length === 0 && !state.loadingFiles
        ? { message: "No changed files" }
        : {}),
    };
  }
  if (sel.kind === "uncommitted") return { files: state.uncommitted ?? [], loading: false };
  const loading = state.loadingBranches || state.loadingCommits;
  if (state.worktree === null && !loading && state.selectedBranch) {
    const short = state.branches.find((b) => b.name === state.selectedBranch)?.shortName;
    const name = short ?? state.selectedBranch;
    const isRemote = !localBranch(state, state.selectedBranch);
    return {
      files: [],
      loading: false,
      message: isRemote
        ? `${state.selectedBranch} is a remote branch, not checked out as a worktree, so it has no uncommitted changes. Select a commit to view its changes.`
        : `${name} is not checked out as a worktree, so it has no uncommitted changes. Select a commit to view its changes.`,
    };
  }
  return { files: [], loading: false, message: "Select a commit to view its changes" };
}

/** A rename row's path (`old => new`, `dir/{old => new}/f`): the new path. */
export function newPath(raw: string): string {
  const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braces) return (braces[1] + braces[3] + braces[4]).replace(/\/\//g, "/");
  return raw.includes(" => ") ? (raw.split(" => ").pop() ?? raw).trim() : raw.trim();
}

export class RepositoryCellModel {
  private _state: RepositoryCellState;
  private _cloned = true;
  private _repositoryState: RepositoryState | undefined;
  /** The repository state last acted on (a new object = something changed). */
  private _seenState: RepositoryState | undefined;
  private _started = false;
  /** Bumped by a branch change / refresh: older loads are dropped. */
  private _generation = 0;
  private _commitToken = 0;
  private _uncommittedToken = 0;
  /** Select the uncommitted entry when it appears (until the user picks). */
  private _autoSelect = true;

  constructor(
    private readonly _api: RepositoryCellApi,
    params: { readonly repoName: string; readonly branch?: string },
    private readonly _changed: () => void,
  ) {
    this._state = {
      repoName: params.repoName,
      ...(params.branch ? { worktreeBranch: params.branch } : {}),
      branches: [],
      loadingBranches: !params.branch,
      selectedBranch: params.branch ?? "",
      commits: [],
      loadingCommits: true,
      visibleCommitCount: 0,
      hasMoreCommits: false,
      selection: { kind: "none" },
      commitFiles: [],
      loadingFiles: false,
      worktree: undefined,
      uncommitted: null,
      collapsed: [],
    };
  }

  get state(): RepositoryCellState {
    return this._state;
  }

  /** The repository state the cell was last given. */
  get repositoryState(): RepositoryState | undefined {
    return this._repositoryState;
  }

  private _set(update: Partial<RepositoryCellState>): void {
    this._state = { ...this._state, ...update };
    this._changed();
  }

  /** The platform's facts, given with every render. */
  setContext(ctx: { readonly cloned: boolean; readonly repositoryState?: RepositoryState }): void {
    this._cloned = ctx.cloned;
    this._repositoryState = ctx.repositoryState;
    if (!this._started || !ctx.repositoryState || ctx.repositoryState === this._seenState) return;
    const first = this._seenState === undefined;
    this._seenState = ctx.repositoryState;
    // The first state only says which branches have worktrees; a later one
    // means the repository changed (files or refs).
    if (first) void this._loadUncommitted();
    else void this._reloadQuietly();
  }

  /** Load the cell (once). */
  start(): void {
    if (this._started) return;
    this._started = true;
    if (this._repositoryState) this._seenState = this._repositoryState;
    void this._load(true);
  }

  private async _load(fetch: boolean): Promise<void> {
    const gen = ++this._generation;
    if (!this._cloned) {
      this._set({
        error: `${this._state.repoName} is not cloned in this workspace. It may have been deleted.`,
        loadingBranches: false,
        loadingCommits: false,
      });
      return;
    }
    if (fetch) await this._api.fetch().catch(() => undefined);
    if (gen !== this._generation) return;

    if (this._state.worktreeBranch) {
      this._set({ error: undefined });
      await Promise.all([this._loadCommits(gen, false), this._loadUncommitted()]);
      return;
    }
    let branches: BranchEntry[];
    try {
      branches = await this._api.branches();
    } catch (err) {
      if (gen === this._generation) {
        this._set({ error: message(err), loadingBranches: false, loadingCommits: false });
      }
      return;
    }
    if (gen !== this._generation) return;
    const keep = branches.some((b) => b.name === this._state.selectedBranch);
    this._set({
      error: undefined,
      branches,
      loadingBranches: false,
      selectedBranch: keep ? this._state.selectedBranch : (branches[0]?.name ?? ""),
    });
    await Promise.all([this._loadCommits(gen, false), this._loadUncommitted()]);
  }

  /** The selected branch's first page of commits (`keepVisible`: as many shown as before). */
  private async _loadCommits(gen: number, keepVisible: boolean): Promise<void> {
    const branch = this._state.selectedBranch;
    const token = ++this._commitToken;
    if (!branch) {
      this._set({ commits: [], loadingCommits: false, hasMoreCommits: false });
      return;
    }
    let commits: CommitEntry[] = [];
    try {
      commits = await this._api.commitLog(branch, { maxCount: PAGE, skip: 0 });
    } catch {
      // No commits (an unborn branch) or git failed: the list is empty.
    }
    if (gen !== this._generation || token !== this._commitToken) return;
    const visible = keepVisible
      ? Math.max(SHOW, Math.min(this._state.visibleCommitCount, commits.length))
      : SHOW;
    const sel = this._state.selection;
    const selectionGone = sel.kind === "commit" && !commits.some((c) => c.hash === sel.hash);
    this._set({
      commits,
      loadingCommits: false,
      hasMoreCommits: commits.length >= PAGE,
      visibleCommitCount: Math.min(visible, Math.max(commits.length, SHOW)),
      ...(selectionGone && !keepVisible ? { selection: { kind: "none" } as const } : {}),
    });
  }

  /** The selected branch's worktree's uncommitted files (or null: none). */
  private async _loadUncommitted(): Promise<void> {
    const token = ++this._uncommittedToken;
    const worktree = selectedWorktree(this._state, this._repositoryState);
    if (!worktree) {
      this._set({
        worktree,
        uncommitted: null,
        ...(this._state.selection.kind === "uncommitted" ? { selection: { kind: "none" } } : {}),
      });
      return;
    }
    let files: DiffStatEntry[] = [];
    try {
      files = await this._api.uncommittedFiles(worktree);
    } catch {
      // The worktree could not be read: no entry.
    }
    if (token !== this._uncommittedToken) return;
    const sel = this._state.selection;
    let selection: Selection = sel;
    if (files.length === 0 && sel.kind === "uncommitted") selection = { kind: "none" };
    if (files.length > 0 && sel.kind === "none" && this._autoSelect) {
      selection = { kind: "uncommitted" };
    }
    this._set({ worktree, uncommitted: files, selection });
  }

  /** After a change in the repository: its branches, commits and uncommitted files. */
  private async _reloadQuietly(): Promise<void> {
    const gen = this._generation;
    if (!this._state.worktreeBranch) {
      try {
        const branches = await this._api.branches();
        if (gen === this._generation) this._set({ branches });
      } catch {
        // Keep the list shown.
      }
    }
    await Promise.all([this._loadCommits(gen, true), this._loadUncommitted()]);
  }

  selectBranch(name: string): void {
    if (this._state.worktreeBranch) return;
    const gen = ++this._generation;
    this._autoSelect = true;
    this._set({
      selectedBranch: name,
      commits: [],
      loadingCommits: true,
      visibleCommitCount: 0,
      hasMoreCommits: false,
      selection: { kind: "none" },
      commitFiles: [],
      worktree: undefined,
      uncommitted: null,
    });
    void this._loadCommits(gen, false);
    void this._loadUncommitted();
  }

  /** Select a commit (or deselect it: a second click, or null). */
  selectCommit(hash: string | null): void {
    this._autoSelect = false;
    const sel = this._state.selection;
    if (hash === null || (sel.kind === "commit" && sel.hash === hash)) {
      this._set({ selection: { kind: "none" }, commitFiles: [], loadingFiles: false });
      return;
    }
    const token = ++this._commitToken;
    this._set({ selection: { kind: "commit", hash }, commitFiles: [], loadingFiles: true });
    void this._api.diffStat(hash).then(
      (files) => {
        if (token !== this._commitToken) return;
        this._set({ commitFiles: files, loadingFiles: false });
      },
      () => {
        if (token === this._commitToken) this._set({ commitFiles: [], loadingFiles: false });
      },
    );
  }

  /** Select the uncommitted entry (or deselect it on a second click). */
  selectUncommitted(): void {
    this._autoSelect = false;
    this._set({
      selection:
        this._state.selection.kind === "uncommitted" ? { kind: "none" } : { kind: "uncommitted" },
      commitFiles: [],
      loadingFiles: false,
    });
  }

  /** Show 10 more commits: from those loaded, else the next page. */
  showMore(): void {
    const s = this._state;
    if (s.visibleCommitCount < s.commits.length) {
      this._set({ visibleCommitCount: Math.min(s.visibleCommitCount + SHOW, s.commits.length) });
      return;
    }
    if (!s.hasMoreCommits || s.loadingCommits) return;
    const gen = this._generation;
    const branch = s.selectedBranch;
    this._set({ loadingCommits: true });
    void this._api.commitLog(branch, { maxCount: PAGE, skip: s.commits.length }).then(
      (more) => {
        if (gen !== this._generation || branch !== this._state.selectedBranch) return;
        const commits = [...this._state.commits, ...more];
        this._set({
          commits,
          loadingCommits: false,
          hasMoreCommits: more.length >= PAGE,
          visibleCommitCount: Math.min(this._state.visibleCommitCount + SHOW, commits.length),
        });
      },
      () => {
        if (gen === this._generation) this._set({ loadingCommits: false });
      },
    );
  }

  /** A section's refresh button: fetch, then reload everything (that section spins). */
  refresh(section: SectionKey): void {
    if (section === "branches") this._set({ loadingBranches: true });
    else if (section === "commits") this._set({ loadingCommits: true });
    else this._set({ loadingFiles: true });
    void this._load(true).finally(() => {
      if (this._state.loadingFiles && this._state.selection.kind !== "commit") {
        this._set({ loadingFiles: false });
      } else if (this._state.selection.kind === "commit") {
        this._reloadCommitFiles();
      }
    });
  }

  /** Reload the selected commit's files (after a refresh). */
  private _reloadCommitFiles(): void {
    const sel = this._state.selection;
    if (sel.kind !== "commit") return;
    const auto = this._autoSelect;
    this._set({ selection: { kind: "none" } });
    this.selectCommit(sel.hash);
    this._autoSelect = auto;
  }

  toggleSection(section: SectionKey): void {
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
    if (!path) return null;
    const sel = this._state.selection;
    if (sel.kind === "commit") return { repoName: this._state.repoName, path, hash: sel.hash };
    const worktree = selectedWorktree(this._state, this._repositoryState);
    if (sel.kind === "uncommitted" && worktree) {
      return { repoName: this._state.repoName, path, branch: worktree };
    }
    return null;
  }
}
