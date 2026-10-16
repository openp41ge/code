/**
 * repositories-view.ts — the Repositories sidebar: the open workspace's
 * repositories and their worktrees (no files — that is the Explorer).
 *
 *   - Repo and worktree rows open on click as a preview, pinned on
 *     double-click (a repo, or a repo at a worktree's branch), and drag into
 *     the grid (`git-repository` payloads).
 *   - Right-click a repo / worktree row: Fetch (`git fetch` the repo, then
 *     re-read the list); Delete a worktree (its folder, via git — refused when
 *     it has uncommitted changes) or Delete a repo (its clone and worktrees,
 *     and it leaves the workspace). The platform asks first.
 *     A failure turns the row red, with an error icon that opens the output.
 *   - `+ add repository` / `+ add worktree` rows ask the platform
 *     (`host.workspace`): it clones / checks out and records the change in the
 *     open workspace, and the new rows arrive through `context.workspaceRepos`
 *     (the platform keeps the context live). Each add in progress is its own
 *     row above the add row, which stays free for the next one; a failed add
 *     reopens the add row with what was typed, or, when that row is in use,
 *     stays as a red row (its error icon opens the output; a click on it
 *     reopens it once the add row is free).
 *   - Dots after a row's name: amber, uncommitted changes; blue, commits no
 *     remote has. A repo row sums all its local branches. From
 *     `context.repositoryStates`, which the platform keeps up to date.
 *
 * A pure function of the host: the tree comes from the context; the state
 * holds only what is view-local (collapsed repos, the active add row, errors).
 */

import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { REPO_ICON, WORKTREE_ICON } from "./icons.js";
import {
  validateRepoUrl,
  type ContextMenuEntry,
  type GitTranscript,
  type WorkspaceActionResult,
  type OpenTabRequest,
  type BranchState,
  type RepositoryState,
  type SurfaceWorkspaceHost,
} from "openp41ge-sdk";

/** `data-drag-source-id` of repo and worktree rows. */
export const REPOSITORY_DRAG_SOURCE_ID = "repository";

/** The app type of this extension's Git output grid tab. */
export const GIT_OUTPUT_APP_TYPE = "ext:openp41ge-extension-git:git-output";
/** The Repository tab (repository-cell.ts). */
export const REPOSITORY_APP_TYPE = "ext:openp41ge-extension-git:repository";

/** A repository in `context.workspaceRepos`. */
interface WorkspaceRepo {
  readonly name: string;
  readonly gitDir?: string;
  readonly worktrees: readonly { readonly name: string; readonly path: string }[];
}

/** Which add row is open: the repository row, or a repo's worktree row. */
type AddTarget = { readonly kind: "repo" } | { readonly kind: "worktree"; readonly repo: string };

export interface RepositoriesState {
  /** Repos whose worktrees are hidden (repos start expanded). */
  readonly collapsed?: readonly string[];
  /** The add row being edited, and what is typed in it. */
  readonly editing?: AddTarget | null;
  readonly value?: string;
  /** Adds in flight (clones / checkouts), with clone progress, and failed
   *  ones kept while their add row was in use. */
  readonly adding?: readonly AddInFlight[];
  /** Why the last action on a repo / worktree row failed (its key: rowKey). */
  readonly rowError?: {
    readonly key: string;
    readonly title: string;
    readonly message: string;
  } | null;
  /** A row action's progress, in italics beside the row's name (its key:
   *  rowKey; `id` tells one run from the next). */
  readonly rowStatus?: {
    readonly key: string;
    readonly text: string;
    readonly id: number;
  } | null;
  /** Why the last add failed, shown under its row. */
  readonly error?: {
    readonly target: AddTarget;
    readonly message: string;
    /** The git command that failed and its output, when one ran. */
    readonly transcript?: GitTranscript;
  } | null;
}

/** One add the platform is working on (or that failed while its row was in use). */
export interface AddInFlight {
  readonly id: number;
  readonly target: AddTarget;
  /** What was typed. */
  readonly value: string;
  readonly percent?: number;
  readonly failed?: { readonly message: string; readonly transcript?: GitTranscript };
}

let nextAddId = 1;

/** The parts of the platform's SurfaceHost the view uses. */
export interface RepositoriesHost {
  readonly context: Readonly<Record<string, unknown>>;
  readonly state: RepositoriesState;
  setState(update: (prev: RepositoriesState) => RepositoriesState): void;
  openTab(request: OpenTabRequest): void;
  readonly workspace: SurfaceWorkspaceHost;
  showContextMenu(event: MouseEvent, items: readonly ContextMenuEntry[]): void;
}

// ─── Icons (the Explorer's glyphs, so the two sidebars match; the repo and
// worktree icons are shared, in icons.ts) ─────────────────────────────────

const ERROR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M508.5-291.5Q520-303 520-320t-11.5-28.5Q497-360 480-360t-28.5 11.5Q440-337 440-320t11.5 28.5Q463-280 480-280t28.5-11.5ZM440-440h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

const icon = (name: string, size = 12): TemplateResult =>
  html`<openp41ge-icon name=${name} size=${size}></openp41ge-icon>`;

const STYLES = html`<style>
  .repos-tree {
    min-height: 100%;
    font-family: var(--ui-sans, ui-sans-serif, system-ui, sans-serif);
    font-size: 12px;
    color: var(--fg-primary, inherit);
  }
  .repos-root {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding-right: 8px;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }
  .row:hover {
    background: var(--row-hover, rgba(128, 128, 128, 0.12));
  }
  .row .chevron {
    width: 12px;
    flex: none;
    text-align: center;
    opacity: 0.75;
  }
  .row .icon {
    width: 14px;
    flex: none;
    display: flex;
    justify-content: center;
  }
  .row .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row.add-row {
    color: var(--text-muted, #666);
    opacity: 0.6;
  }
  .row.add-row:hover {
    color: var(--fg-primary, inherit);
    opacity: 1;
  }
  .add-input {
    flex: 1;
    min-width: 0;
    height: 20px;
    padding: 0 2px;
    font: inherit;
    color: var(--fg-primary, inherit);
    background: transparent;
    border: none;
    outline: none;
  }
  .add-input::placeholder {
    color: var(--text-muted, #888);
  }
  /* The row shows the editing state; the input itself has no focus ring. */
  .add-input:focus,
  .add-input:focus-visible {
    outline: none !important;
    box-shadow: none;
  }
  .row.editing {
    cursor: default;
    background: rgba(74, 158, 255, 0.12);
    box-shadow: inset 0 0 0 1px var(--tree-focus, #4a9eff);
  }
  .dots {
    flex: none;
    display: inline-flex;
    gap: 3px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  /* A clear orange: the theme's --accent-warning is a pale cream in the
     dark theme, hard to tell from the text. */
  .dot--uncommitted {
    background: #e2a03f;
  }
  .dot--unpushed {
    background: var(--accent-info, #4a9eff);
  }
  .row-status {
    flex: none;
    color: var(--text-muted, #888);
    font-size: 11px;
    font-style: italic;
  }
  .busy {
    flex: none;
    color: var(--text-muted, #888);
    font-size: 11px;
  }
  /* A failed action: the row turns red; its error icon opens the git output. */
  .row.row--error {
    background: rgba(244, 71, 71, 0.12);
    color: var(--accent-error, #f44747);
  }
  .row.row--error .label {
    flex: 1;
  }
  .row.editing.row--error {
    background: rgba(244, 71, 71, 0.12);
    box-shadow: inset 0 0 0 1px var(--accent-error, #f44747);
  }
  .row--error .add-input {
    color: var(--accent-error, #f44747);
  }
  .error-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--accent-error, #f44747);
    cursor: pointer;
  }
  .error-btn svg {
    width: 16px;
    height: 16px;
  }
  .empty {
    padding: 8px 10px;
    color: var(--fg-muted, inherit);
    font-style: italic;
  }
</style>`;

// ─── State helpers ────────────────────────────────────────────────────────

const sameTarget = (a: AddTarget | null | undefined, b: AddTarget): boolean =>
  !!a && a.kind === b.kind && (a.kind === "repo" || a.repo === (b as { repo: string }).repo);

function reposOf(host: RepositoriesHost): WorkspaceRepo[] {
  const repos = host.context.workspaceRepos;
  return Array.isArray(repos) ? (repos as WorkspaceRepo[]) : [];
}

function toggleRepo(host: RepositoriesHost, name: string): void {
  host.setState((prev) => {
    const collapsed = prev.collapsed ?? [];
    return {
      ...prev,
      collapsed: collapsed.includes(name)
        ? collapsed.filter((n) => n !== name)
        : [...collapsed, name],
    };
  });
}

/** Collapse every repo (hide all worktrees). */
function collapseAllRepos(host: RepositoriesHost): void {
  host.setState((prev) => ({ ...prev, collapsed: reposOf(host).map((r) => r.name) }));
}

/** The platform's sidebar shell (`<openp41ge-sidebar-tab-content>`), as far
 *  as its bottom bar goes. */
interface SidebarShell extends Element {
  registerBottomBarButton(spec: {
    id: string;
    icon?: string;
    title?: string;
    onClick?: () => void;
  }): () => void;
}

/** Fill the shell's bottom bar. Re-registering an id replaces it, so this is
 *  safe on every render; an older host without the shell has no bar. */
function registerBarButtons(el: Element | undefined, host: RepositoriesHost): void {
  const shell = el as SidebarShell | undefined;
  if (!shell || typeof shell.registerBottomBarButton !== "function") return;
  shell.registerBottomBarButton({
    id: "collapse-all",
    icon: "collapse",
    title: "Collapse all",
    onClick: () => collapseAllRepos(host),
  });
}

function beginAdd(host: RepositoriesHost, target: AddTarget): void {
  host.setState((prev) => ({ ...prev, editing: target, value: "", error: null }));
}

function cancelAdd(host: RepositoriesHost): void {
  host.setState((prev) => ({ ...prev, editing: null, value: "", error: null }));
}

const withoutAdd = (prev: RepositoriesState, id: number): readonly AddInFlight[] =>
  (prev.adding ?? []).filter((a) => a.id !== id);

/**
 * An add failed: reopen its add row with what was typed and the error, or,
 * when that row is being typed in, keep the add as a red row.
 */
function failedAdd(
  prev: RepositoriesState,
  add: AddInFlight,
  message: string,
  transcript?: GitTranscript,
): RepositoriesState {
  const failed = { message, ...(transcript ? { transcript } : {}) };
  if (sameTarget(prev.editing, add.target)) {
    return {
      ...prev,
      adding: (prev.adding ?? []).map((a) => (a.id === add.id ? { ...a, failed } : a)),
    };
  }
  return {
    ...prev,
    adding: withoutAdd(prev, add.id),
    editing: add.target,
    value: add.value,
    error: { target: add.target, ...failed },
  };
}

/** A click on a failed add's row: back into its add row, once that is free. */
function reopenFailed(host: RepositoriesHost, add: AddInFlight): void {
  host.setState((prev) =>
    sameTarget(prev.editing, add.target) || !add.failed
      ? prev
      : {
          ...prev,
          adding: withoutAdd(prev, add.id),
          editing: add.target,
          value: add.value,
          error: { target: add.target, ...add.failed },
        },
  );
}

/** Confirm an add row: validate, then ask the platform. The add gets its own
 *  row while it runs and the add row closes, free for the next one. */
function confirmAdd(host: RepositoriesHost, target: AddTarget): void {
  const value = (host.state.value ?? "").trim();
  if (!value) return;
  if (target.kind === "repo") {
    const invalid = validateRepoUrl(value);
    if (invalid) {
      host.setState((prev) => ({ ...prev, error: { target, message: invalid } }));
      return;
    }
  }
  const add: AddInFlight = { id: nextAddId++, target, value };
  host.setState((prev) => ({
    ...prev,
    adding: [...(prev.adding ?? []), add],
    editing: null,
    value: "",
    error: null,
  }));
  const done = (res: { ok: boolean; error?: string; transcript?: GitTranscript }) =>
    host.setState((prev) =>
      res.ok
        ? { ...prev, adding: withoutAdd(prev, add.id) }
        : failedAdd(prev, add, res.error ?? "Failed", res.transcript),
    );
  const fail = (err: unknown) => host.setState((prev) => failedAdd(prev, add, String(err)));

  if (target.kind === "repo") {
    const cloning = host.workspace.addRepository(value);
    cloning.onProgress((p) =>
      host.setState((prev) => ({
        ...prev,
        adding: (prev.adding ?? []).map((a) =>
          a.id === add.id ? { ...a, percent: p.percent } : a,
        ),
      })),
    );
    void cloning.done.then(done, fail);
    return;
  }
  void host.workspace.addWorktree(target.repo, value).then(done, fail);
}

/** Identifies a repo row, or a worktree row (repo + branch), for its error. */
const rowKey = (repo: string, branch?: string): string => (branch ? `${repo}\n${branch}` : repo);

/** How long a finished action's status (e.g. "fetched") stays beside its row. */
const DONE_STATUS_MS = 3000;
let statusRuns = 0;

/**
 * Run a row's action; a failure marks the row red (a declined confirm does
 * not). With `status`, the row shows `status.running` in italics while it
 * runs, then `status.done` for a few seconds once it succeeds.
 */
function runRowAction(
  host: RepositoriesHost,
  key: string,
  title: string,
  action: Promise<WorkspaceActionResult>,
  status?: { readonly running: string; readonly done: string },
): void {
  const id = ++statusRuns;
  /** This run's status leaves (a later run's stays). */
  const dropStatus = (prev: RepositoriesState): RepositoriesState =>
    prev.rowStatus?.id === id ? { ...prev, rowStatus: null } : prev;
  const clear = (prev: RepositoriesState) =>
    prev.rowError?.key === key ? { ...prev, rowError: null } : prev;
  host.setState((prev) =>
    clear(status ? { ...prev, rowStatus: { key, text: status.running, id } } : prev),
  );
  void action.then(
    (res) => {
      if (res.ok && status) {
        host.setState((prev) =>
          clear(
            prev.rowStatus?.id === id
              ? { ...prev, rowStatus: { key, text: status.done, id } }
              : prev,
          ),
        );
        setTimeout(() => host.setState(dropStatus), DONE_STATUS_MS);
        return;
      }
      host.setState((prev) =>
        res.ok || res.cancelled
          ? clear(dropStatus(prev))
          : { ...dropStatus(prev), rowError: { key, title, message: res.error ?? "Failed" } },
      );
    },
    (err: unknown) =>
      host.setState((prev) => ({
        ...dropStatus(prev),
        rowError: { key, title, message: String(err) },
      })),
  );
}

/** A row's action status, in italics beside its name. */
function rowStatus(host: RepositoriesHost, key: string): TemplateResult | typeof nothing {
  const status = host.state?.rowStatus;
  return status && status.key === key
    ? html`<span class="row-status">${status.text}</span>`
    : nothing;
}

/** The context menu of a repo row, or of a worktree row when `branch` is given. */
function openRowMenu(host: RepositoriesHost, e: MouseEvent, repo: string, branch?: string): void {
  e.preventDefault();
  const key = rowKey(repo, branch);
  host.showContextMenu(e, [
    {
      // A fetch is repository-wide; on a worktree row it fetches its repo.
      label: "Fetch",
      onSelect: () =>
        runRowAction(host, key, "Fetch failed", host.workspace.fetchRepository(repo), {
          running: "fetching…",
          done: "fetched",
        }),
    },
    { separator: true },
    branch
      ? {
          // Deletes the worktree's folder (git refuses if it has uncommitted
          // changes); the branch is kept.
          label: "Delete",
          onSelect: () =>
            runRowAction(host, key, "Delete failed", host.workspace.deleteWorktree(repo, branch)),
        }
      : {
          // Deletes the clone and its worktrees and takes the repo out of the
          // workspace; the platform asks first, showing unsaved work.
          label: "Delete",
          onSelect: () =>
            runRowAction(host, key, "Delete failed", host.workspace.deleteRepository(repo)),
        },
  ]);
}

/** A failed row's error icon: opens what went wrong in the Git output tab. */
function rowErrorButton(host: RepositoriesHost, key: string): TemplateResult | typeof nothing {
  const err = host.state?.rowError;
  if (!err || err.key !== key) return nothing;
  return html`<button
    type="button"
    class="error-btn"
    data-error
    title=${err.message}
    aria-label="Show what went wrong"
    @click=${(e: MouseEvent) => {
      e.stopPropagation();
      host.openTab({
        appType: GIT_OUTPUT_APP_TYPE,
        params: { title: err.title, message: err.message },
        pinned: true,
      });
    }}
  >
    ${unsafeHTML(ERROR_ICON)}
  </button>`;
}

/** Open the Git output tab for a failed add: git's transcript, or the message. */
function openErrorOutput(
  host: RepositoriesHost,
  kind: AddTarget["kind"],
  error: { message: string; transcript?: GitTranscript },
): void {
  host.openTab({
    appType: GIT_OUTPUT_APP_TYPE,
    params: {
      title: kind === "repo" ? "Clone failed" : "Add worktree failed",
      message: error.message,
      ...(error.transcript ?? {}),
    },
    pinned: true,
  });
}

// ─── State dots ───────────────────────────────────────────────────────────

/** The state of `repo` (from the context), when it has arrived. */
function stateOf(host: RepositoriesHost, repo: string): RepositoryState | undefined {
  const states = host.context.repositoryStates as
    Readonly<Record<string, RepositoryState>> | undefined;
  return states?.[repo];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Amber / blue dots for `branches` (summed), with the counts on hover. */
function stateDots(branches: readonly BranchState[]): TemplateResult | typeof nothing {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let unpushed = 0;
  for (const b of branches) {
    staged += b.staged;
    unstaged += b.unstaged;
    untracked += b.untracked;
    unpushed += b.unpushed;
  }
  const uncommitted = [
    unstaged ? `${unstaged} changed` : "",
    staged ? `${staged} staged` : "",
    untracked ? `${untracked} untracked` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const notPushed = unpushed ? `${plural(unpushed, "commit", "commits")} not pushed` : "";
  if (!uncommitted && !notPushed) return nothing;
  return html`<span class="dots" title=${[uncommitted, notPushed].filter(Boolean).join(" · ")}
    >${uncommitted ? html`<span class="dot dot--uncommitted" data-dot="uncommitted"></span>` : nothing}${
      notPushed ? html`<span class="dot dot--unpushed" data-dot="unpushed"></span>` : nothing
    }</span
  >`;
}

// ─── Rows ─────────────────────────────────────────────────────────────────

const pad = (depth: number) => `padding-left:${4 + depth * 16}px`;

function repoRow(host: RepositoriesHost, repo: WorkspaceRepo, expanded: boolean): TemplateResult {
  const key = rowKey(repo.name);
  return html`<div
    class="row ${host.state?.rowError?.key === key ? "row--error" : ""}"
    role="treeitem"
    aria-expanded=${expanded ? "true" : "false"}
    data-row="repo"
    data-drag-source-id=${REPOSITORY_DRAG_SOURCE_ID}
    data-repo-name=${repo.name}
    style=${pad(0)}
    title=${repo.name}
    @click=${() => host.openTab({ appType: REPOSITORY_APP_TYPE, params: { repoName: repo.name } })}
    @dblclick=${() =>
      host.openTab({ appType: REPOSITORY_APP_TYPE, params: { repoName: repo.name }, pinned: true })}
    @contextmenu=${(e: MouseEvent) => openRowMenu(host, e, repo.name)}
  >
    <span
      class="chevron"
      @click=${(e: MouseEvent) => {
        e.stopPropagation();
        toggleRepo(host, repo.name);
      }}
      >${icon(expanded ? "chevron-down" : "chevron-right")}</span
    ><span class="icon">${unsafeHTML(REPO_ICON)}</span><span class="label">${repo.name}</span>
    ${stateDots(stateOf(host, repo.name)?.branches ?? [])} ${rowStatus(host, key)}
    ${rowErrorButton(host, key)}
  </div>`;
}

function worktreeRow(
  host: RepositoriesHost,
  repo: WorkspaceRepo,
  wt: { name: string; path: string },
): TemplateResult {
  const key = rowKey(repo.name, wt.name);
  return html`<div
    class="row ${host.state?.rowError?.key === key ? "row--error" : ""}"
    role="treeitem"
    data-row="worktree"
    data-drag-source-id=${REPOSITORY_DRAG_SOURCE_ID}
    data-repo-name=${repo.name}
    data-branch=${wt.name}
    style=${pad(1)}
    title=${wt.path}
    @click=${() =>
      host.openTab({
        appType: REPOSITORY_APP_TYPE,
        params: { repoName: repo.name, branch: wt.name },
      })}
    @dblclick=${() =>
      host.openTab({
        appType: REPOSITORY_APP_TYPE,
        params: { repoName: repo.name, branch: wt.name },
        pinned: true,
      })}
    @contextmenu=${(e: MouseEvent) => openRowMenu(host, e, repo.name, wt.name)}
  >
    <span class="chevron"></span><span class="icon">${unsafeHTML(WORKTREE_ICON)}</span
    ><span class="label">${wt.name}</span>
    ${stateDots(stateOf(host, repo.name)?.branches.filter((b) => b.branch === wt.name) ?? [])}
    ${rowStatus(host, key)} ${rowErrorButton(host, key)}
  </div>`;
}

/** A `+ add repository` / `+ add worktree` row (or its inline input), after
 *  the rows of its adds in progress. */
function addRow(host: RepositoriesHost, target: AddTarget, depth: number): TemplateResult {
  const s = host.state;
  const error = s.error && sameTarget(s.error.target, target) ? s.error : null;
  const inFlight = (s.adding ?? [])
    .filter((a) => sameTarget(a.target, target))
    .map((a) => addingRow(host, a, depth));
  return html`${inFlight}${addRowItself(host, target, depth, error)}`;
}

/** An add in progress (or failed while its add row was in use). */
function addingRow(host: RepositoriesHost, add: AddInFlight, depth: number): TemplateResult {
  const kind = add.target.kind;
  const glyph = unsafeHTML(kind === "repo" ? REPO_ICON : WORKTREE_ICON);
  const failed = add.failed;
  const status = failed
    ? "failed"
    : kind === "repo"
      ? `Cloning${add.percent ? ` ${add.percent}%` : "…"}`
      : "Checking out…";
  return html`<div
    class="row adding ${failed ? "row--error" : ""}"
    title=${failed?.message ?? nothing}
    style=${pad(depth)}
    @click=${() => reopenFailed(host, add)}
  >
    <span class="chevron"></span><span class="icon">${glyph}</span
    ><span class="label">${add.value}</span><span class="busy">${status}</span>
    ${
      failed
        ? html`<button
            type="button"
            class="error-btn"
            data-error
            title=${failed.message}
            aria-label="Show what went wrong"
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              openErrorOutput(host, kind, failed);
            }}
          >
            ${unsafeHTML(ERROR_ICON)}
          </button>`
        : nothing
    }
  </div>`;
}

function addRowItself(
  host: RepositoriesHost,
  target: AddTarget,
  depth: number,
  error: RepositoriesState["error"],
): TemplateResult {
  const s = host.state;
  const kind = target.kind;
  const label = kind === "repo" ? "add repository" : "add worktree";
  const glyph = unsafeHTML(kind === "repo" ? REPO_ICON : WORKTREE_ICON);
  if (!sameTarget(s.editing, target)) {
    return html`<div
      class="row add-row"
      role="treeitem"
      data-new-entry=${kind}
      style=${pad(depth)}
      @click=${() => beginAdd(host, target)}
    >
      <span class="chevron">${icon("plus")}</span><span class="icon">${glyph}</span
      ><span class="label">${label}</span>
    </div>`;
  }
  return html`<div
    class="row editing ${error ? "row--error" : ""}"
    data-new-entry=${kind}
    style=${pad(depth)}
  >
    <span class="chevron">${icon("plus")}</span><span class="icon">${glyph}</span>
    <input
      class="add-input"
      data-new-entry=${kind}
      .value=${s.value ?? ""}
      placeholder=${kind === "repo" ? "git@github.com:org/repo.git" : "branch name"}
      ${ref((el) => {
        if (el instanceof HTMLInputElement) queueMicrotask(() => el.focus());
      })}
      @input=${(e: Event) =>
        host.setState((prev) => ({
          ...prev,
          value: (e.target as HTMLInputElement).value,
          error: null,
        }))}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmAdd(host, target);
        } else if (e.key === "Escape") {
          cancelAdd(host);
        }
      }}
    />
    ${
      error
        ? html`<button
            type="button"
            class="error-btn"
            data-error
            title=${error.message}
            aria-label="Show what went wrong"
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => openErrorOutput(host, kind, error)}
          >
            ${unsafeHTML(ERROR_ICON)}
          </button>`
        : nothing
    }
  </div>`;
}

// ─── Render ───────────────────────────────────────────────────────────────

/** The Repositories render function: a pure function of the host. */
export function renderRepositories(host: RepositoriesHost): TemplateResult {
  const repos = reposOf(host);
  const collapsed = host.state?.collapsed ?? [];
  return html`
    ${STYLES}
    <openp41ge-sidebar-tab-content ${ref((el) => registerBarButtons(el, host))}>
      <div class="repos-tree" role="tree">
        <div class="repos-root">
          ${
            repos.length === 0
              ? html`<div class="empty">No repositories in this workspace yet.</div>`
              : repos.map((repo) => {
                  const expanded = !collapsed.includes(repo.name);
                  return html`${repoRow(host, repo, expanded)}${
                    expanded
                      ? html`${repo.worktrees.map((wt) => worktreeRow(host, repo, wt))}${addRow(
                          host,
                          { kind: "worktree", repo: repo.name },
                          1,
                        )}`
                      : nothing
                  }`;
                })
          }
          ${addRow(host, { kind: "repo" }, 0)}
        </div>
      </div>
    </openp41ge-sidebar-tab-content>
  `;
}
