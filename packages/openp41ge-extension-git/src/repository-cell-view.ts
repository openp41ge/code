/**
 * repository-cell-view.ts — the repository cell's look: a pure function of
 * its state (`renderRepositoryCell`), the platform's git repository pane as
 * it was. Three accordion sections, each with a 34px header (chevron, title,
 * a square refresh button that spins while the section loads) and a body
 * that scrolls on its own:
 *   - Branches (n): grouped by short name — a local branch's row, then its
 *     remotes (`○ origin`); a group without a local branch is headed
 *     `[remote]`. Ahead / behind counts. Right-click: the branch menu.
 *   - Commits — <branch> (n): the "Uncommitted changes (n)" entry first when
 *     the worktree has changes, then the commits (hash, subject, author ·
 *     date; drag one onto the grid for its Commit tab), and "Show more".
 *   - Files changed (n): the selection's files with a status icon and
 *     +/- counts, or why there are none.
 * A worktree cell has no Branches section.
 */

import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { BranchEntry, CommitEntry, DiffStatEntry } from "./git-types.js";
import {
  filesSection,
  showsUncommitted,
  type RepositoryCellState,
  type SectionKey,
} from "./repository-cell-model.js";

/** What the view's rows and buttons do. */
export interface RepositoryCellActions {
  toggleSection(section: SectionKey): void;
  refresh(section: SectionKey): void;
  retry(): void;
  selectBranch(name: string): void;
  branchMenu(event: MouseEvent, branch: BranchEntry): void;
  selectCommit(hash: string): void;
  selectUncommitted(): void;
  showMore(): void;
  openFile(filePath: string): void;
}

const chevron = (open: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${open ? "4,6 8,10 12,6" : "6,4 10,8 6,12"}"/></svg>`;

const REFRESH = `<svg viewBox="0 -960 960 960" width="15" height="15" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>`;

const STATUS_ICONS: Record<DiffStatEntry["status"], string> = {
  added: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#4caf50" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/></svg>`,
  deleted: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#f44" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><line x1="5" y1="8" x2="11" y2="8"/></svg>`,
  renamed: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#4a9eff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M7 5.5L10.5 8L7 10.5"/></svg>`,
  modified: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#ffa726" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 9.5C6.5 7.5 9.5 7.5 10.5 9.5"/></svg>`,
};

export const REPOSITORY_CELL_STYLES = html`<style>
  .grc {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-gutter, #161616);
    overflow: hidden;
    font-size: 12px;
    padding-bottom: 4px;
    box-sizing: border-box;
  }
  .grc-section {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    flex: 1;
    transition:
      flex 0.2s ease,
      flex-grow 0.2s ease;
  }
  .grc-section.collapsed {
    flex: 0 1 auto;
  }
  .grc-header {
    display: flex;
    align-items: center;
    height: 34px;
    flex-shrink: 0;
    box-sizing: border-box;
    padding-left: 8px;
    cursor: pointer;
    user-select: none;
    background: #222;
    transition: background 0.1s;
  }
  .grc-header:hover {
    background: #2a2a2a;
  }
  .grc-chevron {
    width: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #888;
  }
  .grc-title {
    margin-left: 4px;
    color: #aaa;
    font-size: 11px;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grc-refresh {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: none;
    padding: 0;
    background: transparent;
    color: #666;
    cursor: pointer;
    transition:
      color 0.1s,
      background 0.1s;
  }
  .grc-refresh:hover {
    color: #aaa;
    background: rgba(255, 255, 255, 0.06);
  }
  .grc-refresh svg {
    display: block;
  }
  .grc-section.loading .grc-refresh,
  .grc-section.loading .grc-refresh:hover {
    color: #4a9eff;
  }
  .grc-section.loading .grc-refresh svg {
    animation: grc-spin 0.9s linear infinite;
  }
  @keyframes grc-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .grc-body {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .grc-section.collapsed .grc-body {
    display: none;
  }
  .grc-empty {
    padding: 8px;
    color: #555;
    font-style: italic;
    font-size: 11px;
  }
  .grc-row {
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
  }
  .grc-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .grc-branch {
    display: flex;
    align-items: center;
    padding: 4px 8px 2px 9px;
    font-size: 12px;
    font-family: monospace;
    font-weight: 600;
    color: #ccc;
  }
  .grc-branch-group {
    display: flex;
    align-items: center;
    padding: 6px 8px 2px 9px;
    font-size: 12px;
    font-family: monospace;
    font-weight: 600;
    color: #ccc;
  }
  .grc-remote {
    display: flex;
    align-items: center;
    padding: 2px 8px 2px 24px;
    font-size: 11px;
    font-family: monospace;
    color: #aaa;
  }
  .grc-row.selected,
  .grc-row.selected:hover {
    color: #4a9eff;
    background: rgba(74, 158, 255, 0.08);
  }
  .grc-name {
    margin-left: 4px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grc-dot {
    width: 12px;
    text-align: center;
    flex-shrink: 0;
    font-size: 8px;
    color: #555;
  }
  .grc-source {
    margin-left: 4px;
    color: #888;
    flex-shrink: 0;
  }
  .grc-badges {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    flex-shrink: 0;
    margin-left: 6px;
  }
  .grc-ahead {
    color: #4caf50;
  }
  .grc-behind {
    color: #f44;
  }
  .grc-remote-badge {
    color: #888;
    font-size: 10px;
    font-style: italic;
    flex-shrink: 0;
    margin-left: auto;
  }
  .grc-commit {
    display: flex;
    flex-direction: column;
    padding: 4px 8px 4px 9px;
    font-size: 11px;
  }
  .grc-commit:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .grc-commit.selected,
  .grc-commit.selected:hover {
    background: rgba(74, 158, 255, 0.06);
  }
  .grc-hash {
    color: #ccc;
    font-family: monospace;
    font-size: 13px;
    line-height: 1.6;
    font-weight: 500;
  }
  .grc-subject {
    color: #ccc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }
  .grc-meta {
    display: flex;
    align-items: center;
    margin-top: 1px;
    font-size: 10px;
  }
  .grc-author {
    color: #666;
  }
  .grc-date {
    color: #555;
    margin-left: 4px;
  }
  .grc-uncommitted .grc-hash {
    color: #ffa726;
    font-family: inherit;
    font-size: 12px;
  }
  .grc-more {
    padding: 6px 8px;
    color: #4a9eff;
    font-size: 11px;
  }
  .grc-file {
    display: flex;
    align-items: center;
    height: 26px;
    padding: 0 8px 0 9px;
    font-size: 11px;
    font-family: monospace;
    color: #aaa;
  }
  .grc-file-icon {
    width: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .grc-counts {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    flex-shrink: 0;
    margin-left: 8px;
  }
  .grc-error {
    padding: 16px;
    text-align: center;
  }
  .grc-error-text {
    color: #c55;
    font-size: 11px;
    margin-bottom: 8px;
    user-select: text;
    overflow-wrap: anywhere;
  }
  .grc-retry {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ccc;
    font-size: 11px;
    padding: 4px 12px;
    cursor: pointer;
  }
</style>`;

/** An accordion section: a 34px header (chevron, title, refresh) over a body
 *  that scrolls on its own. Shared with the commit cell. */
export function accordionSection(opts: {
  readonly key: string;
  readonly title: string;
  readonly loading: boolean;
  readonly collapsed: boolean;
  readonly body: TemplateResult | TemplateResult[];
  onToggle(): void;
  onRefresh(): void;
}): TemplateResult {
  const { key, title, loading, collapsed } = opts;
  const label = `Refresh ${key}`;
  return html`<div
    class="grc-section ${collapsed ? "collapsed" : ""} ${loading ? "loading" : ""}"
    data-section=${key}
  >
    <div class="grc-header" @click=${() => opts.onToggle()}>
      <span class="grc-chevron">${unsafeHTML(chevron(!collapsed))}</span>
      <span class="grc-title">${title}</span>
      <button
        class="grc-refresh"
        title=${label}
        aria-label=${label}
        @click=${(e: Event) => {
          e.stopPropagation();
          opts.onRefresh();
        }}
      >
        ${unsafeHTML(REFRESH)}
      </button>
    </div>
    <div class="grc-body">${opts.body}</div>
  </div>`;
}

function section(
  state: RepositoryCellState,
  key: SectionKey,
  title: string,
  loading: boolean,
  body: TemplateResult | TemplateResult[],
  actions: RepositoryCellActions,
): TemplateResult {
  return accordionSection({
    key,
    title,
    loading,
    collapsed: state.collapsed.includes(key),
    body,
    onToggle: () => actions.toggleSection(key),
    onRefresh: () => actions.refresh(key),
  });
}

export const empty = (text: string): TemplateResult => html`<div class="grc-empty">${text}</div>`;

function badges(b: BranchEntry): TemplateResult | typeof nothing {
  if (b.ahead <= 0 && b.behind <= 0) return nothing;
  return html`<span class="grc-badges"
    >${b.ahead > 0 ? html`<span class="grc-ahead">↑${b.ahead}</span>` : nothing}${
      b.behind > 0 ? html`<span class="grc-behind">↓${b.behind}</span>` : nothing
    }</span
  >`;
}

function branchRows(state: RepositoryCellState, actions: RepositoryCellActions): TemplateResult[] {
  const groups = new Map<string, BranchEntry[]>();
  for (const b of state.branches) {
    const key = b.shortName || b.name;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const sorted = [...groups.entries()].sort((a, b) => {
    const al = a[1].some((v) => v.isLocal);
    const bl = b[1].some((v) => v.isLocal);
    return al !== bl ? (al ? -1 : 1) : a[0].localeCompare(b[0]);
  });
  const menu = (b: BranchEntry) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    actions.branchMenu(e, b);
  };
  const remote = (b: BranchEntry): TemplateResult =>
    html`<div
      class="grc-row grc-remote ${b.name === state.selectedBranch ? "selected" : ""}"
      data-branch=${b.name}
      @click=${() => actions.selectBranch(b.name)}
      @contextmenu=${menu(b)}
    >
      <span class="grc-dot">○</span
      ><span class="grc-source">${b.name.split("/")[0]}</span>${badges(b)}
    </div>`;
  return sorted.map(([name, variants]) => {
    const local = variants.find((v) => v.isLocal);
    const remotes = variants.filter((v) => !v.isLocal).sort((a, b) => a.name.localeCompare(b.name));
    const head = local
      ? html`<div
          class="grc-row grc-branch ${local.name === state.selectedBranch ? "selected" : ""}"
          data-branch=${local.name}
          @click=${() => actions.selectBranch(local.name)}
          @contextmenu=${menu(local)}
        >
          <span class="grc-name">${name}</span>${badges(local)}
        </div>`
      : html`<div class="grc-branch-group">
          <span class="grc-name">${name}</span><span class="grc-remote-badge">[remote]</span>
        </div>`;
    return html`${head}${remotes.map(remote)}`;
  });
}

/** `data-drag-source-id` of commit rows: drag one onto the grid to open the Commit tab. */
export const COMMIT_DRAG_SOURCE_ID = "commit";

function commitRow(
  repoName: string,
  c: CommitEntry,
  selected: boolean,
  actions: RepositoryCellActions,
): TemplateResult {
  return html`<div
    class="grc-row grc-commit ${selected ? "selected" : ""}"
    data-commit=${c.hash}
    data-drag-source-id=${COMMIT_DRAG_SOURCE_ID}
    data-repo-name=${repoName}
    data-hash=${c.hash}
    data-short-hash=${c.shortHash}
    @click=${() => actions.selectCommit(c.hash)}
  >
    <div class="grc-hash">${c.shortHash || c.hash}</div>
    <div class="grc-subject">${c.message}</div>
    <div class="grc-meta">
      <span class="grc-author">${c.authorName}</span
      ><span class="grc-date">· ${c.relativeDate || c.date}</span>
    </div>
  </div>`;
}

function commitRows(state: RepositoryCellState, actions: RepositoryCellActions): TemplateResult[] {
  if (state.loadingBranches || (state.loadingCommits && state.commits.length === 0)) return [];
  const rows: TemplateResult[] = [];
  if (showsUncommitted(state)) {
    const n = state.uncommitted?.length ?? 0;
    rows.push(
      html`<div
        class="grc-row grc-commit grc-uncommitted ${
          state.selection.kind === "uncommitted" ? "selected" : ""
        }"
        data-uncommitted
        @click=${() => actions.selectUncommitted()}
      >
        <div class="grc-hash">Uncommitted changes (${n})</div>
        <div class="grc-meta">
          <span class="grc-author">In the ${state.worktree} worktree</span>
        </div>
      </div>`,
    );
  }
  if (state.commits.length === 0 && rows.length === 0) return [empty("No commits yet")];
  const sel = state.selection;
  for (const c of state.commits.slice(0, state.visibleCommitCount)) {
    rows.push(commitRow(state.repoName, c, sel.kind === "commit" && sel.hash === c.hash, actions));
  }
  if (state.commits.length > state.visibleCommitCount || state.hasMoreCommits) {
    rows.push(
      html`<div class="grc-row grc-more" @click=${() => actions.showMore()}>Show more</div>`,
    );
  }
  return rows;
}

function fileRows(state: RepositoryCellState, actions: RepositoryCellActions): TemplateResult[] {
  const files = filesSection(state);
  if (files.loading || state.loadingBranches) return [];
  if (files.files.length === 0) return [empty(files.message ?? "No changed files")];
  return files.files.map((f) => fileRow(f, actions.openFile));
}

/** A changed file: its status icon, path and +/- counts. Shared with the commit cell. */
export function fileRow(f: DiffStatEntry, open: (filePath: string) => void): TemplateResult {
  return html`<div
    class="grc-row grc-file"
    data-file=${f.filePath}
    title=${f.filePath}
    @click=${() => open(f.filePath)}
  >
    <span class="grc-file-icon">${unsafeHTML(STATUS_ICONS[f.status] ?? STATUS_ICONS.modified)}</span
    ><span class="grc-name">${f.filePath}</span
    ><span class="grc-counts"
      >${f.added > 0 ? html`<span class="grc-ahead">+${f.added}</span>` : nothing}${
        f.deleted > 0 ? html`<span class="grc-behind">-${f.deleted}</span>` : nothing
      }</span
    >
  </div>`;
}

/** The cell, from its state. */
export function renderRepositoryCell(
  state: RepositoryCellState,
  actions: RepositoryCellActions,
): TemplateResult {
  if (state.error) {
    return html`${REPOSITORY_CELL_STYLES}
      <div class="grc">
        <div class="grc-error">
          <div class="grc-error-text">${state.error}</div>
          <button class="grc-retry" @click=${() => actions.retry()}>Retry</button>
        </div>
      </div>`;
  }
  const files = filesSection(state);
  const busy = state.loadingBranches;
  const count = (loading: boolean, n: number): string => (loading ? "..." : String(n));
  const commitsTitle = state.selectedBranch
    ? `Commits — ${state.selectedBranch} (${count(state.loadingCommits || busy, state.visibleCommitCount)})`
    : "Commits";
  return html`${REPOSITORY_CELL_STYLES}
    <div class="grc">
      ${
        state.worktreeBranch
          ? nothing
          : section(
              state,
              "branches",
              `Branches (${count(busy, state.branches.length)})`,
              busy,
              busy
                ? []
                : state.branches.length
                  ? branchRows(state, actions)
                  : [empty("No branches")],
              actions,
            )
      }
      ${section(state, "commits", commitsTitle, state.loadingCommits || busy, commitRows(state, actions), actions)}
      ${section(
        state,
        "files",
        `Files changed (${count(files.loading || busy, files.files.length)})`,
        files.loading || busy,
        fileRows(state, actions),
        actions,
      )}
    </div>`;
}
