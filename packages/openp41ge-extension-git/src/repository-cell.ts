/**
 * repository-cell.ts — the Repository tab (`ext:openp41ge-extension-git:repository`):
 * a repository, or one of its worktrees, as Branches / Commits / Files
 * changed. Saved `{ repoName, branch? }` (a branch: that worktree's cell).
 *
 * `renderRepository` (the surface's render function) hands
 * `<git-repository-cell>` what the host knows; the element keeps a
 * `RepositoryCellModel` (the cell's state, loaded through the extension's
 * backend) and renders it with `renderRepositoryCell`. Being one element per
 * mount, the rows persist between renders, so each section keeps its scroll
 * position. Each section body gets the toolkit's overlay scrollbar.
 */

import { html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import type {
  ContextMenuEntry,
  OpenTabRequest,
  RepositoryState,
  SurfaceWorkspaceHost,
} from "openp41ge-sdk";
import { OverlayScrollbar } from "openp41ge-sdk-uikit";
import type { BranchEntry, CommitEntry, DiffStatEntry } from "openp41ge-sdk-git";
import { REPO_ICON, WORKTREE_ICON } from "./icons.js";
import { RepositoryCellModel, type RepositoryCellApi } from "./repository-cell-model.js";
import { renderRepositoryCell, type RepositoryCellActions } from "./repository-cell-view.js";
import { GIT_OUTPUT_APP_TYPE } from "./repositories-view.js";

export const FILE_DIFF_APP_TYPE = "ext:openp41ge-extension-git:file-diff";

/** The surface host, as far as this cell uses it. */
export interface RepositoryHost {
  readonly context: Readonly<Record<string, unknown>>;
  dispatch(command: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
  openTab(request: OpenTabRequest): void;
  readonly workspace: SurfaceWorkspaceHost;
  showContextMenu(event: MouseEvent, items: readonly ContextMenuEntry[]): void;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The tab's params: its repository, and a worktree's branch. */
export function repositoryParams(
  params: Readonly<Record<string, unknown>>,
): { repoName: string; branch?: string } | null {
  const repoName = str(params.repoName);
  if (!repoName) return null;
  const branch = str(params.branch);
  return { repoName, ...(branch ? { branch } : {}) };
}

/** The tab's label: a worktree by its branch (its repository muted), else the repository. */
export function repositoryTabLabel(params: Readonly<Record<string, unknown>>): {
  title?: string;
  description?: string;
  icon?: string;
} {
  const p = repositoryParams(params);
  if (!p) return {};
  return p.branch
    ? { title: p.branch, description: p.repoName, icon: WORKTREE_ICON }
    : { title: p.repoName, icon: REPO_ICON };
}

/** A backend command's result, or its error thrown. */
async function call<T>(
  host: RepositoryHost,
  command: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const answer = (await host.dispatch(command, payload)) as
    { ok: true; result: T } | { ok: false; error: string };
  if (!answer.ok) throw new Error(answer.error);
  return answer.result;
}

/** The cell's git, through the extension's backend and the platform. */
function apiFor(host: RepositoryHost, repo: string): RepositoryCellApi {
  return {
    fetch: async () => {
      await host.workspace.fetchRepository(repo);
    },
    branches: () => call<BranchEntry[]>(host, "branches", { repo }),
    commitLog: (branch, page) => call<CommitEntry[]>(host, "commit-log", { repo, branch, ...page }),
    diffStat: (commit) => call<DiffStatEntry[]>(host, "diff-stat", { repo, commit }),
    uncommittedFiles: (worktree) =>
      call<DiffStatEntry[]>(host, "uncommitted-files", { repo, worktree }),
  };
}

/** Whether the workspace has `repoName` cloned (true when the context does not say). */
function isCloned(host: RepositoryHost, repoName: string): boolean {
  const repos = host.context.workspaceRepos;
  if (!Array.isArray(repos)) return true;
  const repo = (repos as Array<{ name?: string; gitDir?: string }>).find(
    (r) => r.name === repoName,
  );
  return !!repo?.gitDir;
}

function stateOf(host: RepositoryHost, repoName: string): RepositoryState | undefined {
  const states = host.context.repositoryStates as Record<string, RepositoryState> | undefined;
  return states?.[repoName];
}

/** The Repository render function. */
export function renderRepository(host: RepositoryHost): TemplateResult {
  const params = repositoryParams(host.context ?? {});
  if (!params) {
    return html`<div
      style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted,#777);font-size:12px"
    >
      Select a repository to view git information
    </div>`;
  }
  return html`<git-repository-cell
    style="display:block;width:100%;height:100%"
    .host=${host}
    .params=${params}
    .cloned=${isCloned(host, params.repoName)}
    .repositoryState=${stateOf(host, params.repoName)}
  ></git-repository-cell>`;
}

/** One repository cell: its model, rendered. */
export class GitRepositoryCell extends LitElement {
  static override properties = {
    host: { attribute: false },
    params: { attribute: false },
    cloned: { attribute: false },
    repositoryState: { attribute: false },
  };

  declare host: RepositoryHost | null;
  declare params: { repoName: string; branch?: string } | null;
  declare cloned: boolean;
  declare repositoryState: RepositoryState | undefined;

  private _model: RepositoryCellModel | null = null;
  private _scrollbars: OverlayScrollbar[] = [];

  constructor() {
    super();
    this.host = null;
    this.params = null;
    this.cloned = true;
    this.repositoryState = undefined;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override willUpdate(changed: PropertyValues): void {
    const host = this.host;
    const params = this.params;
    if (!host || !params) return;
    const key = (p: typeof params | null | undefined) => `${p?.repoName}\n${p?.branch ?? ""}`;
    if (!this._model || (changed.has("params") && key(changed.get("params")) !== key(params))) {
      this._model = new RepositoryCellModel(apiFor(host, params.repoName), params, () =>
        this.requestUpdate(),
      );
    }
    this._model.setContext({
      cloned: this.cloned,
      ...(this.repositoryState ? { repositoryState: this.repositoryState } : {}),
    });
    this._model.start();
  }

  protected override updated(): void {
    this._attachScrollbars();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const sb of this._scrollbars) sb.destroy();
    this._scrollbars = [];
  }

  /** The toolkit's overlay scrollbar on each section body (once per body). */
  private _attachScrollbars(): void {
    for (const body of this.querySelectorAll<HTMLElement>(".grc-body")) {
      if (body.dataset.scrollbar) continue;
      const section = body.parentElement;
      if (!section) continue;
      body.dataset.scrollbar = "1";
      this._scrollbars.push(
        OverlayScrollbar.attach(body, {
          axis: "vertical",
          container: section,
          inset: { top: "34px" }, // below the section header
          autoHide: true,
          autoHideDelay: 600,
          size: 10,
          hoverSize: 10,
        }),
      );
    }
  }

  private _actions(model: RepositoryCellModel, host: RepositoryHost): RepositoryCellActions {
    const repo = model.state.repoName;
    return {
      toggleSection: (s) => model.toggleSection(s),
      refresh: (s) => model.refresh(s),
      retry: () => model.refresh("branches"),
      selectBranch: (name) => model.selectBranch(name),
      selectCommit: (hash) => model.selectCommit(hash),
      selectUncommitted: () => model.selectUncommitted(),
      showMore: () => model.showMore(),
      openFile: (filePath) => {
        const params = model.fileDiffParams(filePath);
        if (!params) return;
        host.openTab({ appType: FILE_DIFF_APP_TYPE, params, placement: "next-column" });
      },
      branchMenu: (event, branch) =>
        host.showContextMenu(event, branchMenu(host, model, repo, branch)),
    };
  }

  protected override render(): TemplateResult {
    const model = this._model;
    const host = this.host;
    if (!model || !host) return html``;
    return renderRepositoryCell(model.state, this._actions(model, host));
  }
}

/** A branch row's menu. */
function branchMenu(
  host: RepositoryHost,
  model: RepositoryCellModel,
  repo: string,
  branch: BranchEntry,
): ContextMenuEntry[] {
  const local = branch.shortName || branch.name;
  const checkedOut = model.repositoryState?.branches.some((b) => b.branch === local && b.worktree);
  const failed = (title: string) => (res: { ok: boolean; error?: string; cancelled?: boolean }) => {
    if (res.ok || res.cancelled) return;
    const transcript = (res as { transcript?: Record<string, unknown> }).transcript;
    host.openTab({
      appType: GIT_OUTPUT_APP_TYPE,
      params: { title, message: res.error ?? title, ...(transcript ?? {}) },
      pinned: true,
    });
  };
  return [
    ...(checkedOut
      ? []
      : [
          {
            label: "Checkout as worktree",
            onSelect: () =>
              void host.workspace.addWorktree(repo, local).then(failed("Add worktree failed")),
          },
        ]),
    {
      label: "Fetch",
      onSelect: () => void host.workspace.fetchRepository(repo).then(failed("Fetch failed")),
    },
    { label: "Show commits", onSelect: () => model.selectBranch(branch.name) },
    {
      label: "Copy branch name",
      onSelect: () => void navigator.clipboard?.writeText(branch.name).catch(() => undefined),
    },
  ];
}

if (!customElements.get("git-repository-cell")) {
  customElements.define("git-repository-cell", GitRepositoryCell);
}
