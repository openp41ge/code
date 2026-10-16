/**
 * commit-cell.ts — the Commit tab (`ext:openp41ge-extension-git:commit`): one
 * commit, saved `{ repoName, hash, shortHash? }` (a dropped `git-commit`).
 *
 * Two sections, styled as the repository cell's:
 *   - Commit: its hash and refs, the full message, the author and date, its
 *     parents.
 *   - Files changed (n): a file opens the File diff at this commit in the
 *     next column.
 * `<git-commit-cell>` keeps a `CommitCellModel` (loaded through the
 * extension's backend) and renders it.
 */

import { html, LitElement, nothing, type TemplateResult } from "lit";
import type { OpenTabRequest } from "openp41ge-sdk";
import { OverlayScrollbar } from "openp41ge-sdk-uikit";
import type { CommitEntry, DiffStatEntry } from "openp41ge-sdk-git";
import { CommitCellModel, type CommitCellState } from "./commit-cell-model.js";
import {
  REPOSITORY_CELL_STYLES,
  accordionSection,
  empty,
  fileRow,
} from "./repository-cell-view.js";
import { FILE_DIFF_APP_TYPE } from "./repository-cell.js";

/** The surface host, as far as this cell uses it. */
export interface CommitHost {
  readonly context: Readonly<Record<string, unknown>>;
  dispatch(command: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
  openTab(request: OpenTabRequest): void;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The tab's params: its repository and commit. */
export function commitParams(
  params: Readonly<Record<string, unknown>>,
): { repoName: string; hash: string; shortHash?: string } | null {
  const repoName = str(params.repoName);
  const hash = str(params.hash);
  if (!repoName || !hash) return null;
  const shortHash = str(params.shortHash);
  return { repoName, hash, ...(shortHash ? { shortHash } : {}) };
}

/** The tab's label: the short commit, its repository muted. */
export function commitTabLabel(params: Readonly<Record<string, unknown>>): {
  title?: string;
  description?: string;
} {
  const p = commitParams(params);
  if (!p) return {};
  return { title: p.shortHash ?? p.hash.slice(0, 7), description: p.repoName };
}

async function call<T>(host: CommitHost, command: string, payload: Record<string, unknown>) {
  const answer = (await host.dispatch(command, payload)) as
    { ok: true; result: T } | { ok: false; error: string };
  if (!answer.ok) throw new Error(answer.error);
  return answer.result;
}

/** The Commit render function. */
export function renderCommit(host: CommitHost): TemplateResult {
  const params = commitParams(host.context ?? {});
  if (!params) {
    return html`<div
      style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted,#777);font-size:12px"
    >
      No commit
    </div>`;
  }
  return html`<git-commit-cell
    style="display:block;width:100%;height:100%"
    .host=${host}
    .params=${params}
  ></git-commit-cell>`;
}

const COMMIT_STYLES = html`<style>
  .gcc-commit {
    padding: 8px 10px 10px 9px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    user-select: text;
  }
  .gcc-hash-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .gcc-hash {
    color: #ccc;
    font-family: monospace;
    font-size: 12px;
    margin-right: 4px;
    overflow-wrap: anywhere;
  }
  .gcc-ref {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(74, 158, 255, 0.12);
    color: #4a9eff;
    white-space: nowrap;
  }
  .gcc-ref.tag {
    background: rgba(255, 167, 38, 0.12);
    color: #ffa726;
  }
  .gcc-subject {
    color: #ddd;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .gcc-body {
    color: #bbb;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .gcc-meta {
    color: #777;
    font-size: 11px;
    line-height: 1.5;
  }
  .gcc-meta span {
    color: #999;
  }
  .gcc-parents {
    font-family: monospace;
  }
</style>`;

const longDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function commitDetails(c: CommitEntry): TemplateResult {
  const body = c.fullMessage.startsWith(c.message)
    ? c.fullMessage.slice(c.message.length).trim()
    : c.fullMessage;
  return html`<div class="gcc-commit">
    <div class="gcc-hash-line">
      <span class="gcc-hash">${c.hash}</span>
      ${c.refs.map(
        (r) => html`<span class="gcc-ref ${r.startsWith("tag:") ? "tag" : ""}">${r}</span>`,
      )}
    </div>
    <div class="gcc-subject">${c.message}</div>
    ${body ? html`<div class="gcc-body">${body}</div>` : nothing}
    <div class="gcc-meta">
      <span>${c.authorName}</span> &lt;${c.authorEmail}&gt;<br />
      ${longDate(c.date)} · ${c.relativeDate}
      ${
        c.parents.length
          ? html`<br />${c.parents.length > 1 ? "Parents" : "Parent"}
              <span class="gcc-parents">${c.parents.map((p) => p.slice(0, 7)).join(" ")}</span>`
          : nothing
      }
    </div>
  </div>`;
}

/** The cell, from its state. */
export function renderCommitCell(
  state: CommitCellState,
  actions: {
    toggleSection(key: "commit" | "files"): void;
    refresh(): void;
    openFile(filePath: string): void;
  },
): TemplateResult {
  if (state.error) {
    return html`${REPOSITORY_CELL_STYLES}
      <div class="grc">
        <div class="grc-error">
          <div class="grc-error-text">${state.error}</div>
          <button class="grc-retry" @click=${() => actions.refresh()}>Retry</button>
        </div>
      </div>`;
  }
  const files: readonly DiffStatEntry[] = state.files;
  return html`${REPOSITORY_CELL_STYLES}${COMMIT_STYLES}
    <div class="grc">
      ${accordionSection({
        key: "commit",
        title: `Commit ${state.commit?.shortHash ?? state.hash.slice(0, 7)}`,
        loading: state.loading,
        collapsed: state.collapsed.includes("commit"),
        body: state.commit ? commitDetails(state.commit) : [],
        onToggle: () => actions.toggleSection("commit"),
        onRefresh: () => actions.refresh(),
      })}
      ${accordionSection({
        key: "files",
        title: `Files changed (${state.loading ? "..." : files.length})`,
        loading: state.loading,
        collapsed: state.collapsed.includes("files"),
        body: state.loading
          ? []
          : files.length
            ? files.map((f) => fileRow(f, actions.openFile))
            : [empty("No changed files")],
        onToggle: () => actions.toggleSection("files"),
        onRefresh: () => actions.refresh(),
      })}
    </div>`;
}

/** One commit cell: its model, rendered. */
export class GitCommitCell extends LitElement {
  static override properties = {
    host: { attribute: false },
    params: { attribute: false },
  };

  declare host: CommitHost | null;
  declare params: { repoName: string; hash: string } | null;

  private _model: CommitCellModel | null = null;
  private _scrollbars: OverlayScrollbar[] = [];

  constructor() {
    super();
    this.host = null;
    this.params = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override willUpdate(): void {
    const host = this.host;
    const params = this.params;
    if (!host || !params) return;
    const m = this._model;
    if (!m || m.state.repoName !== params.repoName || m.state.hash !== params.hash) {
      const repo = params.repoName;
      this._model = new CommitCellModel(
        {
          commit: (hash) => call<CommitEntry | null>(host, "commit", { repo, hash }),
          diffStat: (commit) => call<DiffStatEntry[]>(host, "diff-stat", { repo, commit }),
        },
        params,
        () => this.requestUpdate(),
      );
    }
    this._model!.start();
  }

  protected override updated(): void {
    for (const body of this.querySelectorAll<HTMLElement>(".grc-body")) {
      if (body.dataset.scrollbar) continue;
      const section = body.parentElement;
      if (!section) continue;
      body.dataset.scrollbar = "1";
      this._scrollbars.push(
        OverlayScrollbar.attach(body, {
          axis: "vertical",
          container: section,
          inset: { top: "34px" },
          autoHide: true,
          autoHideDelay: 600,
          size: 10,
          hoverSize: 10,
        }),
      );
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const sb of this._scrollbars) sb.destroy();
    this._scrollbars = [];
  }

  protected override render(): TemplateResult {
    const model = this._model;
    const host = this.host;
    if (!model || !host) return html``;
    return renderCommitCell(model.state, {
      toggleSection: (key) => model.toggleSection(key),
      refresh: () => model.refresh(),
      openFile: (filePath) => {
        const params = model.fileDiffParams(filePath);
        if (params) host.openTab({ appType: FILE_DIFF_APP_TYPE, params, placement: "next-column" });
      },
    });
  }
}

if (!customElements.get("git-commit-cell")) {
  customElements.define("git-commit-cell", GitCommitCell);
}
