/**
 * history.ts — the History sidebar tab: search the workspace's commits; the
 * results list here and open in the grid.
 *
 *   - Search row (as tall as the app's bottom bars): the query (Enter
 *     searches at once, Escape clears then blurs, ↑/↓ move through the
 *     results), regex and match case.
 *   - Results bar (under the search row, smaller): the results, across how
 *     many repositories, commits searched and time taken; and while the
 *     search streams in (window by window, see HistoryModel) how many
 *     commits it has searched of the most it will.
 *   - Bottom bar: the options button (a square at the edge facing the grid,
 *     bright while any drawer option is set).
 *   - Options drawer (the options button): full height beside the sidebar's
 *     inner edge, resizable from its outer edge. Its top row (as tall as the
 *     sidebar's tab bar) holds the search modes, Simple Search and Advanced
 *     Search. Then rows, each 34px and a line: changed file paths, changed content
 *     lines; the depth limit (1K–10K newest commits per repo); in an
 *     advanced search, the repo filter (only repos whose name matches, when
 *     it has text; regex / match case); and a bottom bar like the
 *     sidebar's. A
 *     mask covers the grid and the other sidebar (this one stays clear); a
 *     click on it, or Escape, closes the drawer.
 *   - Results, newest first, three lines each: the matched entry (the
 *     message, or else the matching file path) windowed on its first match,
 *     matches highlighted; the repo and the worktree it is on; the short
 *     hash, author, date and where else it matched (a body or changed-line
 *     match is fetched as its row comes into view). A click expands the commit's files; a double-click opens its Commit tab;
 *     dragging it onto the grid opens it there. A file opens the File diff at
 *     the commit (a click previews, a double-click pins).
 *
 * `<git-history>` keeps a `HistoryModel` (searched through the extension's
 * backend) and renders it.
 */

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import "openp41ge-sdk-uikit/drop-indicator";
import { tooltipContent } from "openp41ge-sdk-uikit/tooltip";
import type { OpenTabRequest } from "openp41ge-sdk";
import type { SearchResultCommit } from "./git-types.js";
import {
  DEPTH_LIMITS,
  HistoryModel,
  hits,
  entryParts,
  resultsSummary,
  type HistoryState,
  type HistoryToggle,
} from "./history-model.js";
import {
  CASE_ICON,
  CONTENT_ICON,
  DEPTH_ICONS,
  FILES_ICON,
  OPTIONS_ICON,
  REGEX_ICON,
  SIMPLE_SEARCH_ICON,
  ADVANCED_SEARCH_ICON,
} from "./history-icons.js";
import { drawerPlacement, type DrawerPlacement } from "./history-drawer.js";
import { COMMIT_DRAG_SOURCE_ID } from "./repository-cell-view.js";
import { WORKTREE_ICON } from "./icons.js";
import { FILE_DIFF_APP_TYPE } from "./repository-cell.js";

export const COMMIT_APP_TYPE = "ext:openp41ge-extension-git:commit";

/** The surface host, as far as this tab uses it. */
export interface HistoryHost {
  readonly context: Readonly<Record<string, unknown>>;
  dispatch(command: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
  openTab(request: OpenTabRequest): void;
}

/** The workspace's cloned repos, by name. */
function workspaceRepos(host: HistoryHost): string[] {
  const repos = host.context.workspaceRepos;
  if (!Array.isArray(repos)) return [];
  return (repos as Array<{ name?: string; gitDir?: string }>)
    .filter((r) => typeof r.name === "string" && r.gitDir)
    .map((r) => r.name as string);
}

/** Each cloned repo's worktree branches. */
function workspaceWorktrees(host: HistoryHost): Record<string, string[]> {
  const repos = host.context.workspaceRepos;
  if (!Array.isArray(repos)) return {};
  const out: Record<string, string[]> = {};
  for (const r of repos as Array<{ name?: string; worktrees?: Array<{ name?: string }> }>) {
    if (typeof r.name !== "string" || !Array.isArray(r.worktrees)) continue;
    out[r.name] = r.worktrees.map((w) => w.name).filter((n): n is string => typeof n === "string");
  }
  return out;
}

/** A backend command's result, or its error thrown. */
async function call<T>(
  host: HistoryHost,
  command: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const answer = (await host.dispatch(command, payload)) as
    { ok: true; result: T } | { ok: false; error: string };
  if (!answer.ok) throw new Error(answer.error);
  return answer.result;
}

/** The History render function. */
export function renderHistory(host: HistoryHost): TemplateResult {
  return html`<git-history
    style="display:block;width:100%;height:100%"
    .host=${host}
    .repos=${workspaceRepos(host)}
    .worktrees=${workspaceWorktrees(host)}
  ></git-history>`;
}

const STYLES = html`<style>
  .gh {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  /* The search and repo filter rows: as tall as the app's bottom bars. */
  .gh-box {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    border-bottom: 1px solid var(--divider, #2a2a2a);
  }
  .gh-row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    box-sizing: border-box;
    padding: 0 10px;
  }
  /* The drawer's bottom bar, like the sidebar's (34px, a line above). */
  .gh-dspacer {
    flex: 1;
  }
  .gh-dfooter {
    flex-shrink: 0;
    height: 34px;
    box-sizing: border-box;
    border-top: 1px solid var(--divider, #333);
    background: var(--bg-secondary, #161616);
  }
  /* A drawer row with a field: 34px and its line, like the button rows. */
  .gh-drow {
    height: 35px;
  }
  /* No focus outline on the fields (the app outlines a focused input). */
  .gh .gh-input:focus-visible {
    outline: none;
  }
  .gh-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 26px;
    padding: 0;
    font-size: 12px;
    color: var(--text-primary, #ccc);
    background: transparent;
    border: none;
    outline: none;
  }
  /* The options drawer and its mask: above the grid's column resize handles
   * (z-index 1000) and the settings drawer host (1001), below the sidebars'
   * drag bars (1004), which stay usable. */
  .gh-mask {
    position: fixed;
    z-index: 1002;
    background: rgba(20, 20, 22, 0.55);
  }
  /* The drawer: as tall as the sidebar, beside its inner edge, resizable from its outer edge. Its sections — the match options,
   * the repo filter, the depth limit — run its full width, separated by
   * lines; their rounded buttons wrap to its width. */
  .gh-drawer {
    position: fixed;
    z-index: 1003;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background: var(--bg-secondary, #161616);
  }
  .gh-drawer.left {
    border-left: 1px solid var(--divider, #333);
  }
  .gh-drawer.right {
    border-right: 1px solid var(--divider, #333);
  }
  /* The drawer's top row: the search modes, as tall as the sidebar's tab
   * bar (34px and its line), each a full-height square. */
  .gh-dmodes {
    display: flex;
    height: 35px;
    flex-shrink: 0;
    box-sizing: border-box;
    border-bottom: 1px solid var(--divider, #333);
  }
  .gh-dmode {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-right: 1px solid var(--divider, #333);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
  }
  .gh-dmode:hover,
  .gh-dmode.on {
    background: var(--bg-hover, #2a2d2e);
    color: var(--text-primary, #ddd);
  }
  .gh-dsec {
    border-bottom: 1px solid var(--divider, #333);
  }
  /* A row of rounded buttons is as tall as the search row (34px). */
  .gh-dbuttons {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 4px;
    padding: 5px 8px;
  }
  .gh-dbtn {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
  }
  .gh-dbtn:hover {
    background: var(--bg-hover, #2a2d2e);
    color: var(--text-primary, #ddd);
  }
  .gh-dbtn.on {
    color: #e3e3e3;
    background: rgba(74, 158, 255, 0.22);
  }
  /* The resize bar: 3px over the drawer's outer border, showing the app's
   * opaque blue <drag-line> on hover and while dragging (as the settings
   * drawers' bars do). */
  .gh-dresize {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
  }
  .gh-drawer.left .gh-dresize {
    left: -2px;
  }
  .gh-drawer.right .gh-dresize {
    right: -2px;
  }
  .gh-dresize drag-line {
    left: 0;
  }
  /* The options button: a full-height square at the search row's right
   * edge, a line on its left. */
  .gh-footer.right {
    flex-direction: row-reverse;
  }
  /* The results summary: a quieter bar of its own under the search row
   * (60% of the other rows' height). */
  .gh-status {
    flex-shrink: 0;
    height: 20px;
    box-sizing: border-box;
    line-height: 19px;
    padding: 0 10px;
    border-bottom: 1px solid var(--divider, #2a2a2a);
    font-size: 11px;
    color: var(--text-muted, #6b6b6b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gh-options {
    width: 34px;
    height: 33px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
  }
  /* A line between it and the results count. */
  .gh-footer.left .gh-options {
    border-right: 1px solid var(--divider, #333);
  }
  .gh-footer.right .gh-options {
    border-left: 1px solid var(--divider, #333);
  }
  /* Stays highlighted (as on hover) while the drawer is open. */
  .gh-options:hover,
  .gh-options.open {
    background: var(--bg-hover, #2a2d2e);
    color: var(--text-primary, #ddd);
  }
  .gh-options.on {
    color: #e3e3e3;
  }
  .gh-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary, #888);
  }
  .gh-toggle:hover {
    color: var(--text-primary, #ddd);
  }
  .gh-toggle.on {
    color: #e3e3e3;
  }
  .gh-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }
  .gh-message {
    padding: 8px 10px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-muted, #777);
  }
  .gh-message.error {
    color: var(--error, #e53e3e);
    font-style: normal;
    overflow-wrap: anywhere;
  }
  .gh-commit {
    display: flex;
    flex-direction: column;
    user-select: none;
    cursor: pointer;
    outline: none;
  }
  .gh-head:hover,
  .gh-file:hover,
  .gh-commit:focus-visible > .gh-head {
    background: var(--bg-hover, #2a2d2e);
  }
  .gh-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 10px 0 26px;
    overflow: hidden;
    white-space: nowrap;
  }
  .gh-match {
    padding: 4px 10px 1px 6px;
    font-size: 12px;
    line-height: 16px;
    color: var(--text-primary, #ccc);
  }
  /*
   * The first line keeps its match in view at any width: the text before it
   * takes at most 45% of the line (cut from its start, "…" on the left), so
   * the match sits in the middle at the most; the text after it is cut at
   * its end.
   */
  .gh-entry {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: pre;
  }
  .gh-before {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
  .gh-hit-main {
    flex: 0 0.001 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gh-after {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gh-chevron {
    width: 14px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #888;
  }
  .gh-where {
    padding-top: 1px;
    font-size: 11px;
    line-height: 15px;
    color: var(--text-secondary, #999);
  }
  .gh-repo {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
  }
  .gh-worktree {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gh-worktree svg {
    flex-shrink: 0;
  }
  .gh-meta {
    padding-top: 1px;
    padding-bottom: 5px;
    font-size: 10px;
    line-height: 14px;
    color: var(--text-muted, #777);
  }
  .gh-hash {
    flex-shrink: 0;
    color: var(--accent, #4a9eff);
  }
  .gh-meta-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gh-file {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px 0 22px;
    font-size: 11px;
    cursor: pointer;
    color: var(--text-secondary, #aaa);
    user-select: none;
    outline: none;
  }
  .gh-file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gh-counts {
    flex-shrink: 0;
    display: inline-flex;
    gap: 5px;
    font-size: 10px;
  }
  .gh-hit {
    background: rgba(74, 158, 255, 0.28);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  /* The bottom bar: the options button at its inner edge (the grid's side). */
  .gh-footer {
    flex-shrink: 0;
    height: 34px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    border-top: 1px solid var(--divider, #333);
    font-size: 12px;
    color: var(--text-secondary, #999);
    background: var(--bg-secondary, #161616);
  }
</style>`;

const chevron = (open: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${open ? "4,6 8,10 12,6" : "6,4 10,8 6,12"}"/></svg>`;

const commitKey = (c: SearchResultCommit): string => `${c.repoName}:${c.hash}`;

/** The narrowest the options drawer resizes to. */
const DRAWER_MIN = 160;

/** Whether any drawer option differs from its default (the trigger then shows it). */
const filtered = (s: HistoryState): boolean =>
  s.files || s.content || s.maxCount !== DEPTH_LIMITS[0];

/** Spaces at either end as no-break spaces: the parts of the first line are
 *  separate boxes, which would drop a space at their edge. */
const edgeSpaces = (text: string): string =>
  text.replace(/^ +| +$/g, (m) => "\u00a0".repeat(m.length));

/** The History tab: its model, rendered. */
export class GitHistory extends LitElement {
  static override properties = {
    host: { attribute: false },
    repos: { attribute: false },
    worktrees: { attribute: false },
    _drawer: { state: true },
    _resizeHover: { state: true },
    _innerSide: { state: true },
    _resizing: { state: true },
  };

  declare host: HistoryHost | null;
  declare repos: readonly string[];
  declare worktrees: Readonly<Record<string, readonly string[]>>;

  /** The options drawer's width (px), shared by every History tab. */
  static drawerWidth = 220;

  private _model: HistoryModel | null = null;
  /** The open options drawer's placement (null: closed). */
  declare _drawer: DrawerPlacement | null;
  /** The drawer's resize bar is hovered / being dragged (shows its line). */
  declare _resizeHover: boolean;
  /** The sidebar's edge facing the grid (where the options button sits). */
  declare _innerSide: "left" | "right";
  declare _resizing: boolean;
  private _drawerCleanup: (() => void) | null = null;

  constructor() {
    super();
    this.host = null;
    this.repos = [];
    this.worktrees = {};
    this._drawer = null;
    this._resizeHover = false;
    this._resizing = false;
    this._innerSide = "left";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override willUpdate(): void {
    const host = this.host;
    if (!host) return;
    if (!this._model) {
      this._model = new HistoryModel(
        {
          searchWindow: (repo, options, start, size) =>
            call<{ commits: SearchResultCommit[]; walked: number }>(host, "search-commits-window", {
              repo,
              start,
              size,
              ...options,
            }),
          matchContext: (repo, hash, query, opts) =>
            call<SearchResultCommit["matched"] | null>(host, "match-context", {
              repo,
              hash,
              query,
              ...opts,
            }),
        },
        () => this.requestUpdate(),
      );
    }
    this._model.setRepos(this.repos);
    this._model.setWorktrees(this.worktrees);
  }

  private _onWindowResize = (): void => this._placeOptions();

  /** Which edge of the sidebar faces the grid: the drawer side. */
  private _placeOptions(): void {
    this._innerSide = this._placeDrawer().side;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this._onWindowResize);
  }

  protected override firstUpdated(): void {
    this._placeOptions();
    requestAnimationFrame(() => this.querySelector<HTMLInputElement>(".gh-query")?.focus());
  }

  /** Rows shown: their match lines are fetched as they come into view. */
  private _rowObserver: IntersectionObserver | null = null;
  private readonly _observed = new WeakSet<Element>();

  protected override updated(): void {
    const list = this.querySelector(".gh-results");
    if (!list || typeof IntersectionObserver === "undefined") return;
    this._rowObserver ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const hash = (e.target as HTMLElement).dataset.hash;
          if (e.isIntersecting && hash) this._model?.loadMatch(hash);
        }
      },
      { root: list, rootMargin: "200px 0px" },
    );
    for (const row of list.querySelectorAll(".gh-commit")) {
      if (this._observed.has(row)) continue;
      this._observed.add(row);
      this._rowObserver.observe(row);
    }
  }

  override disconnectedCallback(): void {
    this._rowObserver?.disconnect();
    this._rowObserver = null;
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onWindowResize);
    this._closeDrawer();
    this._model?.dispose();
  }

  /** Where the drawer goes now (from the sidebar's box). */
  private _placeDrawer(): DrawerPlacement {
    const sidebar = (this.closest("openp41ge-sidebar") as HTMLElement | null) ?? this;
    return drawerPlacement(sidebar.getBoundingClientRect(), window.innerWidth, window.innerHeight);
  }

  private _toggleDrawer(): void {
    if (this._drawer) {
      this._closeDrawer();
      return;
    }
    this._drawer = this._placeDrawer();
    const place = () => {
      if (this._drawer) this._drawer = this._placeDrawer();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this._closeDrawer();
    };
    const resize = new ResizeObserver(place);
    resize.observe(this);
    window.addEventListener("resize", place);
    // Bubbling, so a field's own Escape (clearing it) runs first.
    document.addEventListener("keydown", onKey);
    this._drawerCleanup = () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey);
    };
  }

  private _closeDrawer(): void {
    this._drawerCleanup?.();
    this._drawerCleanup = null;
    this._drawer = null;
  }

  /** One of the drawer's buttons. */
  private _drawerButton(
    on: boolean,
    icon: string,
    label: string,
    press: () => void,
    data: Record<string, string> = {},
  ): TemplateResult {
    return html`<button
      type="button"
      class="gh-dbtn ${on ? "on" : ""}"
      title=${label}
      aria-label=${label}
      aria-pressed=${on ? "true" : "false"}
      data-option=${data.option ?? ""}
      @click=${press}
    >
      ${unsafeHTML(icon)}
    </button>`;
  }

  /**
   * The options drawer: groups of square buttons beside the sidebar, over a
   * mask on the grid and sidebars (a click on it closes the drawer).
   */
  private _renderDrawer(m: HistoryModel, p: DrawerPlacement): TemplateResult {
    const s = m.state;
    const at = p.side === "left" ? `right:${window.innerWidth - p.edge}px` : `left:${p.edge}px`;
    return html`<div
        class="gh-mask"
        style="top:${p.mask.top}px;bottom:${p.mask.bottom}px;left:${p.mask.left}px;right:${p.mask.right}px"
        @click=${() => this._closeDrawer()}
      ></div>
      <div
        class="gh-drawer ${p.side}"
        style="top:${p.mask.top}px;bottom:${p.mask.bottom}px;${at};width:${GitHistory.drawerWidth}px"
        role="toolbar"
        aria-label="Search options"
      >
        <div class="gh-dmodes" aria-label="Search mode">
          <button
            type="button"
            class="gh-dmode ${s.advanced ? "" : "on"}"
            data-mode="simple"
            aria-label="Simple Search"
            aria-pressed=${s.advanced ? "false" : "true"}
            ${tooltipContent({ type: "simple", text: "Simple Search" })}
            @click=${() => m.setAdvanced(false)}
          >
            ${unsafeHTML(SIMPLE_SEARCH_ICON)}
          </button>
          <button
            type="button"
            class="gh-dmode ${s.advanced ? "on" : ""}"
            data-mode="advanced"
            aria-label="Advanced Search"
            aria-pressed=${s.advanced ? "true" : "false"}
            ${tooltipContent({ type: "simple", text: "Advanced Search" })}
            @click=${() => m.setAdvanced(true)}
          >
            ${unsafeHTML(ADVANCED_SEARCH_ICON)}
          </button>
        </div>
        <div class="gh-dsec gh-dbuttons" aria-label="Search in">
          ${this._drawerButton(
            s.files,
            FILES_ICON,
            "Search changed file paths",
            () => m.toggle("files"),
            { option: "files" },
          )}
          ${this._drawerButton(
            s.content,
            CONTENT_ICON,
            "Search changed content lines",
            () => m.toggle("content"),
            { option: "content" },
          )}
        </div>
        <div class="gh-dsec gh-dbuttons" aria-label="Depth limit">
          ${DEPTH_LIMITS.map((limit) =>
            this._drawerButton(
              limit === s.maxCount,
              DEPTH_ICONS[limit] ?? "",
              `Depth limit: ${limit / 1000}K newest commits`,
              () => m.setMaxCount(limit),
              { option: `depth-${limit}` },
            ),
          )}
        </div>
        ${
          s.advanced
            ? html`<div class="gh-row gh-dsec gh-drow gh-repo-row" aria-label="Repos">
                <input
                  class="gh-input gh-repo-filter"
                  type="text"
                  placeholder="Filter repos…"
                  spellcheck="false"
                  .value=${live(s.repoFilterText)}
                  @input=${(e: Event) => m.setRepoFilter((e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      m.searchNow();
                    } else if (e.key === "Escape" && s.repoFilterText) {
                      e.preventDefault();
                      e.stopPropagation();
                      m.setRepoFilter("");
                    }
                  }}
                />
                ${this._toggle(m, "repoFilterRegex", REGEX_ICON, "Repo filter regex")}
                ${this._toggle(m, "repoFilterCase", CASE_ICON, "Repo filter match case")}
              </div>`
            : nothing
        }
        <div class="gh-dspacer"></div>
        <div class="gh-dfooter"></div>
        <div
          class="gh-dresize"
          title="Resize"
          @pointerenter=${() => (this._resizeHover = true)}
          @pointerleave=${() => (this._resizeHover = false)}
          @pointerdown=${(e: PointerEvent) => this._resizeDrawer(e, p)}
        >
          <drag-line
            orientation="vertical"
            ?show=${this._resizeHover || this._resizing}
          ></drag-line>
        </div>
      </div>`;
  }

  /** Drag the drawer's outer edge to resize it (kept while the app runs). */
  private _resizeDrawer(e: PointerEvent, p: DrawerPlacement): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const drawer = handle.parentElement as HTMLElement;
    const startX = e.clientX;
    const startWidth = drawer.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    this._resizing = true;
    const move = (ev: PointerEvent) => {
      const delta = p.side === "left" ? startX - ev.clientX : ev.clientX - startX;
      const max = Math.max(DRAWER_MIN, window.innerWidth * 0.6);
      GitHistory.drawerWidth = Math.round(Math.min(max, Math.max(DRAWER_MIN, startWidth + delta)));
      drawer.style.width = `${GitHistory.drawerWidth}px`;
    };
    const up = () => {
      this._resizing = false;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  private _toggle(
    m: HistoryModel,
    option: HistoryToggle,
    icon: string,
    label: string,
  ): TemplateResult {
    const on = m.state[option];
    return html`<button
      type="button"
      class="gh-toggle ${on ? "on" : ""}"
      data-toggle=${option}
      title=${label}
      aria-label=${label}
      aria-pressed=${on ? "true" : "false"}
      @click=${() => m.toggle(option)}
    >
      ${unsafeHTML(icon)}
    </button>`;
  }

  private _queryKeydown(m: HistoryModel, e: KeyboardEvent): void {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      m.searchNow();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (input.value) m.setQuery("");
      else input.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this._moveFocus(e.key === "ArrowDown" ? 1 : -1);
    }
  }

  /** Move focus through the commit rows. */
  private _moveFocus(delta: number): void {
    const rows = [...this.querySelectorAll<HTMLElement>(".gh-commit")];
    if (rows.length === 0) return;
    const active = document.activeElement?.closest?.(".gh-commit") as HTMLElement | null;
    const at = active ? rows.indexOf(active) : -1;
    rows[Math.min(rows.length - 1, Math.max(0, (at < 0 ? 0 : at) + (at < 0 ? 0 : delta)))].focus();
  }

  private _highlighted(text: string, s: HistoryState): Array<TemplateResult | string> {
    const found = hits(text, s.resultsQuery, s);
    const out: Array<TemplateResult | string> = [];
    let i = 0;
    for (const [a, b] of found) {
      if (a > i) out.push(text.slice(i, a));
      out.push(html`<mark class="gh-hit">${text.slice(a, b)}</mark>`);
      i = b;
    }
    if (i < text.length) out.push(text.slice(i));
    return out;
  }

  /** Where else the commit matched: more hits in its message, matching files. */
  private _matchMeta(c: SearchResultCommit, s: HistoryState): string {
    const bits: string[] = [];
    const n = hits(c.message, s.resultsQuery, s).length;
    if (n > 1) bits.push(`+ ${n - 1} more instance${n - 1 === 1 ? "" : "s"}`);
    let paths = c.files.map((f) => f.path).filter((p) => hits(p, s.resultsQuery, s).length > 0);
    // The first is the matched entry itself when the message does not match.
    if (n === 0) paths = paths.slice(1);
    if (paths.length > 0) {
      const label = n === 0 ? "also" : `matched file${paths.length === 1 ? "" : "s"}`;
      const more = paths.length > 2 ? ` +${paths.length - 2} more` : "";
      bits.push(`${label}: ${paths.slice(0, 2).join(", ")}${more}`);
    }
    return bits.join(" · ");
  }

  private _openCommit(c: SearchResultCommit): void {
    this.host?.openTab({
      appType: COMMIT_APP_TYPE,
      params: { repoName: c.repoName, hash: c.hash, shortHash: c.shortHash },
      pinned: true,
    });
  }

  private _openFile(c: SearchResultCommit, path: string, pinned: boolean): void {
    this.host?.openTab({
      appType: FILE_DIFF_APP_TYPE,
      params: { repoName: c.repoName, path, hash: c.hash },
      pinned,
    });
  }

  private _commitRow(m: HistoryModel, c: SearchResultCommit): TemplateResult {
    const s = m.state;
    const key = commitKey(c);
    const expanded = s.expanded.includes(key);
    const entry = entryParts(c, s.resultsQuery, s);
    const meta = this._matchMeta(c, s);
    return html`<div
      class="gh-commit"
      tabindex="0"
      data-commit=${c.hash}
      data-drag-source-id=${COMMIT_DRAG_SOURCE_ID}
      data-repo-name=${c.repoName}
      data-hash=${c.hash}
      data-short-hash=${c.shortHash}
      @click=${() => m.toggleExpanded(key)}
      @dblclick=${() => this._openCommit(c)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          m.toggleExpanded(key);
        } else if ((e.key === "ArrowRight" && !expanded) || (e.key === "ArrowLeft" && expanded)) {
          e.preventDefault();
          m.toggleExpanded(key);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this._moveFocus(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <div class="gh-head">
        <div class="gh-line gh-match" title=${c.message}>
          <span class="gh-chevron">${unsafeHTML(chevron(expanded))}</span>
          <span class="gh-entry"
            >${
              entry.before
                ? html`<span class="gh-before"
                    ><bdi dir="ltr">${this._highlighted(edgeSpaces(entry.before), s)}</bdi></span
                  >`
                : nothing
            }${
              entry.match ? html`<mark class="gh-hit gh-hit-main">${entry.match}</mark>` : nothing
            }<span class="gh-after">${this._highlighted(edgeSpaces(entry.after), s)}</span></span
          >
        </div>
        <div class="gh-line gh-where">
          <span class="gh-repo" title=${c.repoName}>${c.repoName}</span>
          ${
            c.worktree
              ? html`<span class="gh-worktree" title="Worktree ${c.worktree}"
                  >${unsafeHTML(WORKTREE_ICON.replace(/width="14" height="14"/, 'width="11" height="11"'))}${c.worktree}</span
                >`
              : nothing
          }
        </div>
        <div class="gh-line gh-meta">
          <span class="gh-hash" title=${c.hash}>${c.shortHash}</span>
          <span class="gh-meta-text"
            >${[c.author, c.relativeDate || c.date, meta].filter(Boolean).join(" · ")}</span
          >
        </div>
      </div>
      ${
        expanded
          ? c.files.length
            ? c.files.map(
                (f) =>
                  html`<div
                    class="gh-file"
                    tabindex="0"
                    data-file=${f.path}
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this._openFile(c, f.path, false);
                    }}
                    @dblclick=${(e: Event) => {
                      e.stopPropagation();
                      this._openFile(c, f.path, true);
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      this._openFile(c, f.path, true);
                    }}
                  >
                    <span class="gh-file-name" title=${f.path}
                      >${this._highlighted(f.path, s)}</span
                    >
                    <span class="gh-counts"
                      >${
                        f.additions > 0
                          ? html`<span style="color:#3fb950">+${f.additions}</span>`
                          : nothing
                      }${
                        f.deletions > 0
                          ? html`<span style="color:#f85149">−${f.deletions}</span>`
                          : nothing
                      }</span
                    >
                  </div>`,
              )
            : html`<div class="gh-message" style="padding:2px 10px 2px 20px;font-size:11px">
                No changed files
              </div>`
          : nothing
      }
    </div>`;
  }

  private _results(m: HistoryModel): TemplateResult | TemplateResult[] {
    const s = m.state;
    const message = (text: string, error = false) =>
      html`<div class="gh-message ${error ? "error" : ""}">${text}</div>`;
    if (s.repos.length === 0) return message("No repositories to search");
    if (s.advanced && s.repoFilterText.trim() && m.scope().length === 0) {
      return message("No repos match the filter");
    }
    if (s.error) return message(`Search failed: ${s.error}`, true);
    if (!s.query.trim()) return message("Type to search commit messages or changed file paths");
    if (s.results === null) return message("Searching…");
    if (s.results.length === 0)
      return s.searching ? message("Searching…") : message("No matching commits");
    return s.results.map((c) => this._commitRow(m, c));
  }

  protected override render(): TemplateResult {
    const m = this._model;
    if (!m) return html``;
    const s = m.state;
    return html`${STYLES}
      <div class="gh">
        <div class="gh-box gh-search">
          <div class="gh-row gh-query-row">
            <input
              class="gh-input gh-query"
              type="text"
              placeholder="Search commits…"
              spellcheck="false"
              .value=${live(s.query)}
              @input=${(e: Event) => m.setQuery((e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => this._queryKeydown(m, e)}
            />
            ${this._toggle(m, "regex", REGEX_ICON, "Regex search")}
            ${this._toggle(m, "caseSensitive", CASE_ICON, "Match case")}
          </div>
        </div>
        <div
          class="gh-status"
          role="status"
          title=${resultsSummary(s, m.scope().length, s.maxCount)}
        >
          ${resultsSummary(s, m.scope().length, s.maxCount)}
        </div>
        <div class="gh-results">${this._results(m)}</div>
        ${this._drawer ? this._renderDrawer(m, this._drawer) : nothing}
        <div class="gh-footer ${this._innerSide}">
          <button
            type="button"
            class="gh-options ${this._drawer || filtered(s) ? "on" : ""} ${this._drawer ? "open" : ""}"
            title="Search options"
            aria-label="Search options"
            aria-expanded=${this._drawer ? "true" : "false"}
            @click=${() => this._toggleDrawer()}
          >
            ${unsafeHTML(OPTIONS_ICON)}
          </button>
        </div>
      </div>`;
  }
}

if (!customElements.get("git-history")) customElements.define("git-history", GitHistory);
