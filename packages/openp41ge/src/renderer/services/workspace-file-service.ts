/**
 * WorkspaceFileService — tracks the active .openp41ge-workspace file.
 *
 * Manages opening, saving, and creating draft workspace files.
 * Emits "workspace-file-changed" on document when the active file changes.
 */

import type { WorkspaceFileData } from "../../layout/types";
import { createLogger } from "openp41ge-core-logger";
import { deriveRepoName, validateRepoUrl } from "openp41ge-sdk";
import { appState } from "./app-state";
import {
  WORKSPACE_FILE_VERSION,
  emptyWorkspaceSession,
  mergeManifestEdits,
  withManifestOf,
} from "../../layout/workspace-file";

const log = createLogger("openp41ge", "workspace-file-service");

const WORKSPACE_CHANGED_EVENT = "workspace-file-changed";

/** A deep copy (the open data's repo lists are edited in place). */
function copyOf(data: WorkspaceFileData): WorkspaceFileData {
  return JSON.parse(JSON.stringify(data)) as WorkspaceFileData;
}

/** Result of materialising (cloning) a repo for a workspace. */
export interface MaterializeOutcome {
  url: string;
  name: string;
  ok: boolean;
  error?: string;
  worktrees: Array<{ branch: string; ok: boolean; error?: string }>;
}

/** A repo's workspace name from its clone URL (the SDK's one rule). */
export { deriveRepoName };

export class WorkspaceFileService {
  /** Path to the active .openp41ge-workspace file, or null if none. */
  openFilePath: string | null = null;

  /** Parsed contents of the open workspace file. */
  openData: WorkspaceFileData | null = null;

  /**
   * The open file as last read or written: what `openData`'s edits are made
   * on, so a save or reload merges them with the file's current contents.
   */
  private _base: WorkspaceFileData | null = null;

  /**
   * Human-readable name of the open workspace:
   * `data.name` if set, else the workspace file's basename (minus the
   * `.openp41ge-workspace` extension), else "No workspace".
   */
  get openWorkspaceName(): string {
    const name = this.openData?.name?.trim();
    if (name) return name;
    if (this.openFilePath) {
      const base = this.openFilePath.split(/[\\/]/).pop() ?? "";
      const cleaned = base.replace(/\.openp41ge-workspace$/i, "").trim();
      if (cleaned) return cleaned;
    }
    return "No workspace";
  }

  /**
   * Absolute app-data root, from the main process. Falls back to the release
   * folder (`~/.openp41ge` resolved by the main-process handlers) for test and
   * browser-only contexts where the bridge field is absent.
   */
  private _dataDir(): string {
    return window.openp41ge?.dataDir?.() ?? "~/.openp41ge";
  }

  // ── Open (via dialog) ───────────────────────────────

  /**
   * Open the native file picker. Reads the selected file and sets it active.
   * Returns true if a file was loaded, false if cancelled.
   */
  async openDialog(): Promise<boolean> {
    const result = await window.openp41ge.dialog.openWorkspaceFile();
    if (!result) return false;
    // Opening a file counts as an activation — record it best-effort.
    const stamped = this._stamp(result.data);
    await this._persistAccess(result.filePath, stamped);
    this.openFilePath = result.filePath;
    this.openData = stamped;
    this._base = copyOf(this.openData);
    appState.openWorkspaceFilePath = result.filePath;
    appState.notify();
    this._emitChanged();
    return true;
  }

  // ── Load known path ─────────────────────────────────

  /**
   * Load a workspace file from a known path (no dialog).
   * Returns true on success.
   */
  async loadPath(filePath: string): Promise<boolean> {
    const result = await window.openp41ge.dialog.readWorkspaceFile(filePath);
    if (!result) return false;
    const stamped = this._stamp(result.data);
    await this._persistAccess(result.filePath, stamped);
    this.openFilePath = result.filePath;
    this.openData = stamped;
    this._base = copyOf(this.openData);
    appState.openWorkspaceFilePath = result.filePath;
    appState.notify();
    this._emitChanged();
    return true;
  }

  // ── Follow the open file on disk ────────────────────

  /**
   * Re-read the open workspace file's manifest (name, repos, …) when it is
   * `filePath`, keeping this window's layout session, and fire the change
   * signal (every mounted surface re-resolves its context). False when
   * `filePath` is not the open file or cannot be read.
   */
  async reloadManifest(filePath: string): Promise<boolean> {
    if (!this.openFilePath || !this.openData || filePath !== this.openFilePath) return false;
    const result = await window.openp41ge.dialog.readWorkspaceFile(filePath);
    if (!result || filePath !== this.openFilePath || !this.openData) return false;
    // Keep an edit not yet saved (a repo just added) on top of the new file.
    const merged = this._base
      ? mergeManifestEdits(this._base, this.openData, result.data)
      : result.data;
    this.openData = withManifestOf(this.openData, merged);
    this._base = copyOf(result.data);
    this._emitChanged();
    return true;
  }

  /**
   * Keep the open workspace's manifest live: reload it whenever the platform
   * reports its file changed (another window or extension wrote it). Returns
   * a function that stops following.
   */
  followDiskChanges(): () => void {
    const onChanged = window.openp41ge?.workspaceController?.onWorkspaceFileChanged;
    if (!onChanged) return () => undefined;
    return onChanged(({ path }) => {
      this.reloadManifest(path).catch((err: unknown) =>
        log.debug("reloading the workspace file failed:", path, err),
      );
    });
  }

  // ── Save ────────────────────────────────────────────

  /**
   * Write this window's manifest edits to the open workspace file (no
   * dialog), merged onto the file as it is now (`mergeManifestEdits`): another
   * writer's changes and the saved layout session are kept.
   */
  async save(): Promise<boolean> {
    const filePath = this.openFilePath;
    if (!filePath || !this.openData) return false;
    let data = this.openData;
    const current = this._base
      ? await window.openp41ge.dialog.readWorkspaceFile(filePath).catch(() => null)
      : null;
    if (this._base && current) data = mergeManifestEdits(this._base, this.openData, current.data);
    const ok = await window.openp41ge.dialog.writeWorkspaceFile(filePath, data);
    if (ok && this.openFilePath === filePath && this.openData) {
      this.openData = withManifestOf(this.openData, data);
      this._base = copyOf(data);
    }
    return ok;
  }

  /**
   * Save via dialog (Save As). Returns the new path, or null if cancelled.
   */
  async saveAs(): Promise<string | null> {
    if (!this.openData) return null;
    // Save As records access only for the newly written file.
    const stamped = this._stamp(this.openData);
    const defaultPath = this.openFilePath ?? undefined;
    const filePath = await window.openp41ge.dialog.saveWorkspaceFile(stamped, defaultPath);
    if (!filePath) return null;
    this.openFilePath = filePath;
    this.openData = stamped;
    this._base = copyOf(this.openData);
    appState.openWorkspaceFilePath = filePath;
    appState.notify();
    this._emitChanged();
    return filePath;
  }

  // ── List all workspaces ───────────────────────────

  /**
   * List all .openp41ge-workspace files from <dataDir>/workspaces/.
   * Returns sorted array of { filePath, data }.
   */
  async listWorkspaces(): Promise<Array<{ filePath: string; data: WorkspaceFileData }>> {
    return window.openp41ge.dialog.listWorkspaces();
  }

  // ── Create new workspace ───────────────────────────

  /**
   * Create a new workspace file with the given name.
   * Writes to <dataDir>/workspaces/<uuid>.openp41ge-workspace
   * and sets it as the open workspace.
   */
  async createWorkspace(name: string): Promise<WorkspaceFileData | null> {
    const uuid = crypto.randomUUID();
    const now = new Date().toISOString();
    const data: WorkspaceFileData = {
      id: uuid,
      name,
      version: WORKSPACE_FILE_VERSION,
      createdAt: now,
      dataDir: `${this._dataDir()}/workspaces-data/${uuid}`,
      repos: [],
      lastActivatedAt: now,
      ...emptyWorkspaceSession(),
    };

    const filePath = `${this._dataDir()}/workspaces/${uuid}.openp41ge-workspace`;

    // Ensure data directory exists
    await window.openp41ge.dialog.ensureDir(`${this._dataDir()}/workspaces-data/${uuid}`);

    const written = await window.openp41ge.dialog.writeWorkspaceFile(filePath, data);
    if (!written) return null;

    this.openFilePath = filePath;
    this.openData = data;
    this._base = copyOf(this.openData);
    appState.openWorkspaceFilePath = filePath;
    appState.notify();
    this._emitChanged();
    return data;
  }

  // ── Open existing workspace ────────────────────────

  /**
   * Set a workspace (from listWorkspaces) as the open workspace.
   *
   * By default this records the activation: it stamps `lastActivatedAt` on a
   * copy of the data, persists it best-effort to the workspace file, and sets
   * the in-memory state to the stamped copy. Persistence failure does not
   * block the open (best-effort) — the returned boolean reports whether the
   * persist succeeded. Pass `{ recordAccess: false }` for internal/restore
   * opens that should not bump recency.
   */
  async openWorkspace(
    entry: { filePath: string; data: WorkspaceFileData },
    opts: { recordAccess?: boolean } = {},
  ): Promise<boolean> {
    const recordAccess = opts.recordAccess ?? true;
    let openData = entry.data;
    let persisted = true;
    if (recordAccess) {
      const stamped = this._stamp(entry.data);
      openData = stamped;
      persisted = await this._persistAccess(entry.filePath, stamped);
    }
    this.openFilePath = entry.filePath;
    this.openData = openData;
    this._base = copyOf(this.openData);
    appState.openWorkspaceFilePath = entry.filePath;
    appState.notify();
    this._emitChanged();
    return persisted;
  }

  // ── Stamping ────────────────────────────────────────

  /** Shallow copy with a fresh `lastActivatedAt`; never mutates the input. */
  private _stamp(data: WorkspaceFileData): WorkspaceFileData {
    return { ...data, lastActivatedAt: new Date().toISOString() };
  }

  /** Best-effort write of activation data; failures are swallowed. */
  private async _persistAccess(filePath: string, data: WorkspaceFileData): Promise<boolean> {
    try {
      return await window.openp41ge.dialog.writeWorkspaceFile(filePath, data);
    } catch (err) {
      log.debug("persistAccess write failed:", filePath, err);
      return false;
    }
  }

  // ── Open workspace repo list ───────────────────────────

  /**
   * Append a repo (its bare-clone URL) to the open workspace's `repos` list
   * if not already present. Returns true when a new entry was added.
   * Persist with `save()`. Repos belong to the open workspace — the
   * explorer and the Workspaces overlay share this single list.
   */
  addRepoToActive(url: string): boolean {
    if (!this.openData) return false;
    const repo = url.trim();
    if (validateRepoUrl(repo)) return false;
    // One entry per repo: another URL form of it (SSH vs HTTPS) is a duplicate.
    const name = deriveRepoName(repo);
    if ((this.openData.repos ?? []).some((r) => deriveRepoName(r.url) === name)) return false;
    this.openData.repos = [...(this.openData.repos ?? []), { url: repo, worktrees: [] }];
    this._emitChanged();
    return true;
  }

  /**
   * Remove a repo from the open workspace (by its derived name). Returns true
   * when it was there. Persist with `save()`. The clone on disk is untouched.
   */
  removeRepoFromActive(repoName: string): boolean {
    if (!this.openData?.repos) return false;
    const repos = this.openData.repos.filter((r) => deriveRepoName(r.url) !== repoName);
    if (repos.length === this.openData.repos.length) return false;
    this.openData.repos = repos;
    this._emitChanged();
    return true;
  }

  /** True when `branch` is a worktree of the repo `repoName` in the open workspace. */
  hasWorktreeInActive(repoName: string, branch: string): boolean {
    const entry = this.openData?.repos?.find((r) => deriveRepoName(r.url) === repoName);
    return (entry?.worktrees ?? []).includes(branch);
  }

  /**
   * Add a worktree branch to a repo in the open workspace (by its derived
   * name). Returns true when the list actually changed. Persist with `save()`.
   */
  addWorktreeToActive(repoName: string, branch: string): boolean {
    if (!this.openData) return false;
    if (!branch) return false;
    const entry = this.openData.repos?.find((r) => deriveRepoName(r.url) === repoName);
    if (!entry) return false;
    if ((entry.worktrees ?? []).includes(branch)) return false;
    entry.worktrees = [...(entry.worktrees ?? []), branch];
    this._emitChanged();
    return true;
  }

  /**
   * Remove a worktree branch from a repo in the open workspace (by its
   * derived name). Returns true when the list actually changed. Persist with
   * `save()`.
   */
  removeWorktreeFromActive(repoName: string, branch: string): boolean {
    if (!this.openData) return false;
    const entry = this.openData.repos?.find((r) => deriveRepoName(r.url) === repoName);
    if (!entry) return false;
    if (!(entry.worktrees ?? []).includes(branch)) return false;
    entry.worktrees = (entry.worktrees ?? []).filter((b) => b !== branch);
    this._emitChanged();
    return true;
  }

  // ── Change data dir ─────────────────────────────────

  /**
   * Update the dataDir in memory. Call save() to persist to disk.
   */
  changeDataDir(newPath: string): void {
    if (!this.openData) return;
    this.openData.dataDir = newPath;
    this._emitChanged();
  }

  // ── Materialize repos (clone on disk) ────────────────────────────

  /**
   * Best-effort clone of the open workspace's repos into the project
   * repositories dir, and checkout of their worktrees, so the Explorer/Git
   * sidebar panels can list them.
   *
   * Uses the workspaceController APIs (the same path normal repo-add uses),
   * which clone into the directory the sidebar panels scan. All operations
   * are idempotent at the main-process level (existing clones/worktrees are
   * skipped), so this is safe to run on every activation. Returns a per-repo
   * outcome summary (for tests/diagnostics).
   */
  async materializeActiveRepos(): Promise<MaterializeOutcome[]> {
    const data = this.openData;
    if (!data || !Array.isArray(data.repos) || data.repos.length === 0) return [];

    const outcomes: MaterializeOutcome[] = [];
    for (const repo of data.repos) {
      const name = deriveRepoName(repo.url);
      const out: MaterializeOutcome = { url: repo.url, name, ok: false, worktrees: [] };
      try {
        // Clone the bare repo into the project repos dir (idempotent).
        const clone = await window.openp41ge.workspaceController.clone(repo.url).promise;
        if (!clone.success) {
          out.error = clone.error || "Clone failed";
          outcomes.push(out);
          continue;
        }

        for (const branch of repo.worktrees ?? []) {
          try {
            await window.openp41ge.workspaceController.checkoutWorktree(name, branch);
            out.worktrees.push({ branch, ok: true });
          } catch (wtErr) {
            out.worktrees.push({
              branch,
              ok: false,
              error: wtErr instanceof Error ? wtErr.message : String(wtErr),
            });
          }
        }
        out.ok = out.worktrees.every((w) => w.ok);
      } catch (e) {
        out.error = e instanceof Error ? e.message : String(e);
      }
      outcomes.push(out);
    }
    return outcomes;
  }

  // ── Clear ───────────────────────────────────────────

  /** Clear the open workspace (drops references, file stays on disk). */
  clear(): void {
    this.openFilePath = null;
    this.openData = null;
    this._base = null;
    appState.openWorkspaceFilePath = null;
    appState.notify();
    this._emitChanged();
  }

  // ── Events ──────────────────────────────────────────

  private _emitChanged(): void {
    document.dispatchEvent(
      new CustomEvent(WORKSPACE_CHANGED_EVENT, {
        bubbles: true,
        detail: {
          filePath: this.openFilePath,
          data: this.openData,
        },
      }),
    );
  }

  /** Subscribe to workspace file changes. Returns unsubscribe. */
  onChange(callback: () => void): () => void {
    const handler = () => callback();
    document.addEventListener(WORKSPACE_CHANGED_EVENT, handler);
    return () => document.removeEventListener(WORKSPACE_CHANGED_EVENT, handler);
  }
}

/** Singleton instance. */
export const workspaceFileService = new WorkspaceFileService();

/**
 * Pure filter: does this workspace match a search query? Matches against the
 * workspace name, the file basename, repo names/urls, and worktree names.
 * An empty/whitespace query matches everything.
 */
export function workspaceMatchesQuery(
  data: WorkspaceFileData,
  filePath: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if ((data.name ?? "").toLowerCase().includes(q)) return true;

  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (base.toLowerCase().includes(q)) return true;

  return (data.repos ?? []).some(
    (r) =>
      r.url.toLowerCase().includes(q) ||
      (r.worktrees ?? []).some((w) => w.toLowerCase().includes(q)),
  );
}
