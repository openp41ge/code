/**
 * <openp41ge-workspaces-list> — the Workspaces sidebar tab: the list of
 * workspaces, with search, a new-workspace row and a delete mode.
 *
 * A row click opens that workspace's editor (`onOpen(ws, false)`), a
 * double-click pins it (`onOpen(ws, true)`). Where the editor opens is the
 * host's business: the management window's grid, or a workspace window's.
 *
 * Rows carry `data-workspace-path` / `data-workspace-name`; with
 * `dragSourceId` set they are also tagged `data-drag-source-id` (outside
 * delete mode), so the platform drag pipeline drags them as
 * `openp41ge/workspace-config` payloads.
 *
 * Renders into its light DOM (with its own scoped styles), so a host's
 * delegated listeners see the rows. Test seam: `deps`.
 */

import { html, nothing, LitElement, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { tooltipController } from "openp41ge-sdk-uikit";
import { createLogger } from "openp41ge-core-logger";
import type { WorkspaceFileData } from "../../layout/types";
import { workspaceFileService } from "../services/workspace-file-service";
import { REGEX_ICON, CASE_ON_ICON } from "./search-icons";

const log = createLogger("openp41ge", "workspaces-list");

/** One listed workspace: its file and contents. */
export interface WorkspaceListEntry {
  readonly filePath: string;
  readonly data: WorkspaceFileData;
}

/** What the list reads and changes (injectable for tests). */
export interface WorkspacesListDeps {
  list(): Promise<WorkspaceListEntry[]>;
  create(name: string): Promise<unknown>;
  /** Delete a workspace file, keeping its data dirs. */
  delete(filePath: string): Promise<unknown>;
  /** Call `fn` when any workspace file changes (in any window). */
  onChanged(fn: () => void): () => void;
}

const DEFAULT_DEPS: WorkspacesListDeps = {
  list: () => workspaceFileService.listWorkspaces(),
  create: (name) => workspaceFileService.createWorkspace(name),
  delete: (filePath) => window.openp41ge.dialog.deleteWorkspaceFile(filePath, false),
  onChanged: (fn) =>
    window.openp41ge?.workspaceController?.onWorkspaceFileChanged?.(fn) ?? (() => {}),
};

/** A workspace's name in the list. */
export function workspaceName(ws: { data: WorkspaceFileData }): string {
  return ws.data.name?.trim() || "Unnamed";
}

/** Whether a workspace matches the search query (name / repo URL / worktree). */
export function matchesWorkspaceQuery(
  ws: { data: WorkspaceFileData },
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): boolean {
  if (!query) return true;
  const haystacks = [
    workspaceName(ws),
    ...(ws.data.repos ?? []).map((r) => r.url),
    ...(ws.data.repos ?? []).flatMap((r) => r.worktrees ?? []),
  ];
  if (useRegex) {
    try {
      const re = new RegExp(query, caseSensitive ? "" : "i");
      return haystacks.some((h) => re.test(h));
    } catch (err) {
      log.debug("workspaces-list filter regex invalid:", query, err);
      return false;
    }
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return haystacks.some((h) =>
    caseSensitive ? h.includes(query) : h.toLowerCase().includes(needle),
  );
}

/** "2 repos" / "1 repo" style label. */
const countLabel = (n: number, singular: string): string =>
  `${n} ${n === 1 ? singular : singular + "s"}`;

const TRASH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>';
const SEARCH_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const CLOSE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';

/** The list's styles, scoped to the element (it renders into its light DOM). */
const STYLES = `
  openp41ge-workspaces-list { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-secondary, #161616); }
  openp41ge-workspaces-list .wsl-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
  openp41ge-workspaces-list ul { list-style: none; margin: 0; padding: 0; }
  openp41ge-workspaces-list li.ws-row { position: relative; display: flex; align-items: center; gap: 12px; padding: 7px 10px; cursor: pointer; border-bottom: 1px solid var(--divider, #2f3031); transition: background 0.1s ease; }
  openp41ge-workspaces-list li.ws-row:hover { background: var(--border-divider, #2d2d2d); }
  openp41ge-workspaces-list li.ws-row--last:not(.ws-row--last-visible) { border-bottom: none; }
  openp41ge-workspaces-list .ws-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  openp41ge-workspaces-list .ws-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: 600; }
  openp41ge-workspaces-list .ws-meta { color: var(--text-secondary, #999); font-size: 12px; }
  openp41ge-workspaces-list .ws-new-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  openp41ge-workspaces-list .ws-action { flex-shrink: 0; align-self: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary, #999); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.1s ease, color 0.1s ease; }
  openp41ge-workspaces-list .ws-action:hover { background: var(--bg-active, #37373d); color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .ws-action svg { display: block; }
  openp41ge-workspaces-list .ws-row--select { cursor: pointer; }
  openp41ge-workspaces-list .ws-row--new { cursor: default; }
  openp41ge-workspaces-list .ws-row--new:hover { background: var(--bg-hover, #2a2d2e); }
  openp41ge-workspaces-list .wm-new-ws-input { min-width: 0; background: transparent; border: none; outline: none; color: var(--text-primary, #ddd); font-size: 14px; font-family: inherit; font-weight: 600; padding: 0; height: auto; align-self: flex-start; }
  openp41ge-workspaces-list .wm-new-ws-input::placeholder { color: var(--text-secondary, #777); font-weight: 400; }
  @keyframes ws-skeleton-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
  openp41ge-workspaces-list .ws-skeleton { display: inline-block; border-radius: 4px; background: var(--bg-active, #37373d); animation: ws-skeleton-pulse 1.3s ease-in-out infinite; }
  openp41ge-workspaces-list .ws-skeleton--num { width: 118px; height: 12px; vertical-align: middle; margin-top: 4px; }
  openp41ge-workspaces-list .empty { color: var(--text-secondary, #777); font-size: 13px; padding: 0 16px; text-align: center; display: flex; align-items: center; justify-content: center; flex: 1; min-height: 0; }
  openp41ge-workspaces-list .wm-workspaces-bottom { flex: none; }
  openp41ge-workspaces-list .wm-search-bar { display: flex; align-items: stretch; height: 34px; padding: 0; box-sizing: border-box; background: var(--bg-secondary, #161616); border-top: 1px solid var(--divider, #333); }
  openp41ge-workspaces-list .wm-search { display: flex; align-items: stretch; flex: 1; min-width: 0; height: 100%; }
  openp41ge-workspaces-list .wm-search-input { flex: 1; min-width: 0; height: 100%; background: transparent; color: var(--text-primary, #ddd); border: none; padding: 0 10px 0 14px; font-size: 13px; outline: none; caret-color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .wm-search-input::placeholder { color: var(--text-secondary, #777); font-weight: 400; }
  openp41ge-workspaces-list .wm-search-toggle, openp41ge-workspaces-list .wm-search-clear { flex: none; display: flex; align-items: center; justify-content: center; height: 100%; aspect-ratio: 1 / 1; padding: 0; border: none; border-left: 1px solid var(--divider, #333); border-radius: 0; background: transparent; color: var(--text-secondary, #999); cursor: pointer; transition: color 0.1s ease, background 0.1s ease; }
  openp41ge-workspaces-list .wm-search-toggle:hover, openp41ge-workspaces-list .wm-search-clear:hover { color: var(--text-primary, #ddd); background: var(--bg-hover, #2a2d2e); }
  openp41ge-workspaces-list .wm-search-toggle--on, openp41ge-workspaces-list .wm-search-toggle--on:hover { color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .ws-list-footer { display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; height: 34px; padding: 0; border-top: 1px solid var(--divider, #333); background: var(--bg-secondary, #161616); }
  openp41ge-workspaces-list .wm-footer-spacer { flex: 1; }
  openp41ge-workspaces-list .dw-search { flex: none; border: none; background: transparent; color: var(--text-secondary, #999); border-radius: 0; height: 100%; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; border-right: 1px solid var(--divider, #333); box-sizing: content-box; padding-left: 8px; user-select: none; }
  openp41ge-workspaces-list .dw-search:hover, openp41ge-workspaces-list .dw-search[aria-pressed="true"] { background: var(--bg-active, #37373d); color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .dw-add { border: none; background: transparent; color: var(--text-secondary, #999); font-size: 20px; border-radius: 0; height: 100%; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; border-left: 1px solid var(--divider, #333); }
  openp41ge-workspaces-list .dw-add:hover { background: var(--bg-active, #37373d); color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .dw-delete { border: none; background: transparent; color: var(--text-secondary, #999); border-radius: 0; height: 100%; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; border-left: 1px solid var(--divider, #333); }
  openp41ge-workspaces-list .dw-delete:hover { background: var(--bg-active, #37373d); color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .dw-delete svg { fill: currentColor; }
  openp41ge-workspaces-list .dw-delete-confirm, openp41ge-workspaces-list .dw-delete-cancel { border: none; border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; background: transparent; color: var(--text-secondary, #999); }
  openp41ge-workspaces-list .dw-delete-confirm:hover, openp41ge-workspaces-list .dw-delete-cancel:hover { background: var(--bg-active, #37373d); color: var(--text-primary, #ddd); }
  openp41ge-workspaces-list .dw-delete-confirm:disabled { opacity: 0.4; cursor: default; }
  openp41ge-workspaces-list .dw-checkbox { width: 14px; height: 14px; border: 1px solid var(--text-secondary, #999); border-radius: 3px; flex-shrink: 0; align-self: center; display: inline-flex; align-items: center; justify-content: center; color: transparent; }
  openp41ge-workspaces-list .dw-checkbox--checked { background: var(--accent, #569cd6); border-color: var(--accent, #569cd6); color: #fff; }
  openp41ge-workspaces-list .dw-checkbox--checked::after { content: "✓"; font-size: 11px; line-height: 1; }
`;

/** Marks the injected style element (one per document / shadow root). */
const STYLE_ATTR = "data-openp41ge-workspaces-list";

/** Footer and search buttons that get the toolkit tooltip (their `data-tip`). */
const TOOLTIP_BUTTONS =
  ".dw-search, .wm-search-toggle, .wm-search-clear, .dw-add, .dw-delete, .dw-delete-cancel, .dw-delete-confirm";

export class Openp41geWorkspacesList extends LitElement {
  static override properties = {
    _workspaces: { state: true },
    _loaded: { state: true },
    _adding: { state: true },
    _deleteMode: { state: true },
    _selected: { state: true },
    _searchOpen: { state: true },
    _query: { state: true },
    _caseSensitive: { state: true },
    _useRegex: { state: true },
    _overflows: { state: true },
  };

  /** Open a workspace's editor (`pinned`: a double-click). */
  onOpen: ((ws: WorkspaceListEntry, pinned: boolean) => void) | null = null;
  /** Return true to swallow a row click (the click that ends a host's row drag). */
  ignoreClick: () => boolean = () => false;
  /** When set, rows are platform drag sources with this id (outside delete mode). */
  dragSourceId: string | null = null;
  /** Injectable for tests. */
  deps: WorkspacesListDeps = DEFAULT_DEPS;

  declare private _workspaces: WorkspaceListEntry[];
  declare private _loaded: boolean;
  declare private _adding: boolean;
  declare private _deleteMode: boolean;
  declare private _selected: Set<string>;
  declare private _searchOpen: boolean;
  declare private _query: string;
  declare private _caseSensitive: boolean;
  declare private _useRegex: boolean;
  declare private _overflows: boolean;

  private _offChanged: (() => void) | null = null;
  private _tooltipTargets: Element[] = [];
  private _seq = 0;

  constructor() {
    super();
    this._workspaces = [];
    this._loaded = false;
    this._adding = false;
    this._deleteMode = false;
    this._selected = new Set();
    this._searchOpen = false;
    this._query = "";
    this._caseSensitive = false;
    this._useRegex = false;
    this._overflows = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** The listed workspaces (all of them, not just the search's matches). */
  get workspaces(): readonly WorkspaceListEntry[] {
    return this._workspaces;
  }

  /** Rows select for deletion instead of opening. */
  get deleteMode(): boolean {
    return this._deleteMode;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._installStyles();
    this._offChanged = this.deps.onChanged(() => void this.reload());
    window.addEventListener("focus", this._onWindowFocus);
    window.addEventListener("resize", this._measureOverflow);
    document.addEventListener("keydown", this._onKeydown);
    void this.reload();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._offChanged?.();
    this._offChanged = null;
    window.removeEventListener("focus", this._onWindowFocus);
    window.removeEventListener("resize", this._measureOverflow);
    document.removeEventListener("keydown", this._onKeydown);
    for (const el of this._tooltipTargets) tooltipController.detach(el);
    this._tooltipTargets = [];
  }

  /** Add the list's styles to the document or shadow root it is in, once. */
  private _installStyles(): void {
    const root = this.getRootNode() as Document | ShadowRoot;
    const parent = root instanceof Document ? root.head : root;
    if (!parent || parent.querySelector(`style[${STYLE_ATTR}]`)) return;
    const style = document.createElement("style");
    style.setAttribute(STYLE_ATTR, "");
    style.textContent = STYLES;
    parent.appendChild(style);
  }

  /** Re-read the workspaces. */
  async reload(): Promise<void> {
    const seq = ++this._seq;
    let list: WorkspaceListEntry[];
    try {
      list = await this.deps.list();
    } catch (err) {
      log.error("workspaces-list list failed:", err, { skipToast: true });
      list = [];
    }
    if (seq !== this._seq) return;
    this._workspaces = list;
    this._loaded = true;
  }

  private readonly _onWindowFocus = (): void => void this.reload();

  /** Escape closes the new-workspace row, or leaves delete mode. */
  private readonly _onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this._adding) this._adding = false;
    else if (this._deleteMode) this._cancelDeleteMode();
  };

  /** The last row keeps its separator only while the list does not scroll. */
  private readonly _measureOverflow = (): void => {
    const el = this.querySelector(".wsl-scroll");
    if (!el) return;
    const overflow = el.scrollHeight > el.clientHeight + 1;
    if (overflow !== this._overflows) this._overflows = overflow;
  };

  override updated(): void {
    this._measureOverflow();
    const live = new Set<Element>();
    for (const btn of this.querySelectorAll<HTMLElement>(TOOLTIP_BUTTONS)) {
      const text = btn.getAttribute("data-tip");
      if (!text) continue;
      tooltipController.attach(btn, { type: "simple", text });
      live.add(btn);
    }
    for (const el of this._tooltipTargets) if (!live.has(el)) tooltipController.detach(el);
    this._tooltipTargets = [...live];
  }

  /** The workspaces the search shows. */
  private get _filtered(): WorkspaceListEntry[] {
    if (!this._query.trim()) return this._workspaces;
    return this._workspaces.filter((w) =>
      matchesWorkspaceQuery(w, this._query, this._caseSensitive, this._useRegex),
    );
  }

  // ── Search ────────────────────────────────────────────────────────────

  private _startSearch(): void {
    this._searchOpen = true;
    void this.updateComplete.then(() => {
      this.querySelector<HTMLInputElement>(".wm-search-input")?.focus();
    });
  }

  /** Collapse the search bar, clear the query, and reset the toggles. */
  private _exitSearch(): void {
    this._searchOpen = false;
    this._query = "";
    this._caseSensitive = false;
    this._useRegex = false;
  }

  // ── New workspace ─────────────────────────────────────────────────────

  private _toggleAdd(): void {
    this._deleteMode = false;
    this._adding = !this._adding;
    if (this._adding) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLInputElement>(".wm-new-ws-input")?.focus();
      });
    }
  }

  private _onNewKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void this._createFromInput();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this._adding = false;
    }
  }

  /** Create a workspace from the name row, then refresh the list. */
  private async _createFromInput(): Promise<void> {
    const name = this.querySelector<HTMLInputElement>(".wm-new-ws-input")?.value.trim() ?? "";
    this._adding = false;
    if (!name) return;
    try {
      await this.deps.create(name);
    } catch (err) {
      log.error("workspaces-list create failed:", name, err, { skipToast: true });
      return;
    }
    await this.reload();
  }

  // ── Delete mode ───────────────────────────────────────────────────────

  private _activateDeleteMode(): void {
    this._adding = false;
    this._deleteMode = true;
    this._selected = new Set();
  }

  private _cancelDeleteMode(): void {
    this._deleteMode = false;
    this._selected = new Set();
  }

  private _toggleSelected(filePath: string): void {
    const next = new Set(this._selected);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    this._selected = next;
  }

  /** Delete the selected workspace files (keeping their data dirs), then refresh. */
  private async _deleteSelected(): Promise<void> {
    const selected = this._selected;
    this._cancelDeleteMode();
    if (selected.size === 0) return;
    for (const path of selected) {
      try {
        await this.deps.delete(path);
      } catch (err) {
        log.error("workspaces-list delete failed:", path, err, { skipToast: true });
      }
    }
    await this.reload();
  }

  // ── Render ────────────────────────────────────────────────────────────

  private _onRowClick(e: Event, ws: WorkspaceListEntry): void {
    e.stopPropagation();
    if (this.ignoreClick()) return;
    if (this._deleteMode) {
      this._toggleSelected(ws.filePath);
      return;
    }
    this.onOpen?.(ws, false);
  }

  private _onRowDblClick(e: Event, ws: WorkspaceListEntry): void {
    e.stopPropagation();
    if (this._deleteMode) return;
    this.onOpen?.(ws, true);
  }

  private _newRow(): TemplateResult {
    return html`
      <li class="ws-row ws-row--new">
        <div class="ws-info">
          <input
            class="wm-new-ws-input"
            placeholder="Enter workspace name"
            spellcheck="false"
            @keydown=${(e: KeyboardEvent) => this._onNewKeydown(e)}
            @blur=${() => {
              if (this._adding) void this._createFromInput();
            }}
          />
          <div class="ws-meta"><span class="ws-skeleton ws-skeleton--num"></span></div>
        </div>
        <div class="ws-new-actions">
          <button
            class="ws-action ws-action--confirm"
            aria-label="Create workspace"
            title="Create workspace"
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${(e: Event) => {
              e.stopPropagation();
              void this._createFromInput();
            }}
          >
            ${unsafeHTML(CHECK_ICON)}
          </button>
          <button
            class="ws-action ws-action--cancel"
            aria-label="Cancel"
            title="Cancel"
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._adding = false;
            }}
          >
            ${unsafeHTML(CLOSE_ICON)}
          </button>
        </div>
      </li>
    `;
  }

  private _row(w: WorkspaceListEntry, isLast: boolean): TemplateResult {
    const name = workspaceName(w);
    const repos = w.data.repos?.length ?? 0;
    const worktrees = (w.data.repos ?? []).reduce((n, r) => n + (r.worktrees?.length ?? 0), 0);
    const draggable = !!this.dragSourceId && !this._deleteMode;
    return html`
      <li
        class="ws-row ${this._deleteMode ? "ws-row--select" : ""} ${isLast ? "ws-row--last" : ""} ${isLast && !this._overflows ? "ws-row--last-visible" : ""}"
        data-workspace-path=${w.filePath}
        data-workspace-name=${name}
        data-drag-source-id=${draggable ? this.dragSourceId! : nothing}
        @click=${(e: Event) => this._onRowClick(e, w)}
        @dblclick=${(e: Event) => this._onRowDblClick(e, w)}
      >
        <div class="ws-info">
          <div class="ws-name">${name}</div>
          <div class="ws-meta">
            ${countLabel(repos, "repo")} · ${countLabel(worktrees, "worktree")}
          </div>
        </div>
        ${
          this._deleteMode
            ? html`<span
                class="dw-checkbox ${this._selected.has(w.filePath) ? "dw-checkbox--checked" : ""}"
              ></span>`
            : nothing
        }
      </li>
    `;
  }

  private _searchBar(): TemplateResult {
    return html`
      <div class="wm-search-bar">
        <div class="wm-search">
          <input
            class="wm-search-input"
            placeholder="Search workspaces…"
            spellcheck="false"
            .value=${this._query}
            @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              this._exitSearch();
            }}
          />
          <button
            class="wm-search-toggle ${this._useRegex ? "wm-search-toggle--on" : ""}"
            aria-label="Regex search"
            aria-pressed=${this._useRegex}
            data-tip="Regex search"
            @click=${() => (this._useRegex = !this._useRegex)}
          >
            ${unsafeHTML(REGEX_ICON)}
          </button>
          <button
            class="wm-search-toggle ${this._caseSensitive ? "wm-search-toggle--on" : ""}"
            aria-label="Match case"
            aria-pressed=${this._caseSensitive}
            data-tip=${this._caseSensitive ? "Match case (on)" : "Match case (off)"}
            @click=${() => (this._caseSensitive = !this._caseSensitive)}
          >
            ${unsafeHTML(CASE_ON_ICON)}
          </button>
          <button
            class="wm-search-clear"
            aria-label="Clear search"
            data-tip="Close search"
            @click=${() => this._exitSearch()}
          >
            ✕
          </button>
        </div>
      </div>
    `;
  }

  private _footer(): TemplateResult {
    const stop =
      (fn: () => void) =>
      (e: Event): void => {
        e.stopPropagation();
        fn();
      };
    return html`
      <div class="ws-list-footer">
        <button
          class="dw-search"
          aria-label="Search workspaces"
          aria-pressed=${this._searchOpen}
          data-tip="Search workspaces"
          @click=${stop(() => (this._searchOpen ? this._exitSearch() : this._startSearch()))}
        >
          ${unsafeHTML(SEARCH_ICON)}
        </button>
        <span class="wm-footer-spacer"></span>
        ${
          this._deleteMode
            ? html`
                <button
                  class="dw-delete-cancel"
                  data-tip="Cancel"
                  @click=${stop(() => this._cancelDeleteMode())}
                >
                  Cancel
                </button>
                <button
                  class="dw-delete-confirm"
                  data-tip="Delete selected workspaces"
                  ?disabled=${this._selected.size === 0}
                  @click=${stop(() => void this._deleteSelected())}
                >
                  Delete
                </button>
              `
            : html`
                <button
                  class="dw-add"
                  aria-label="New workspace"
                  data-tip="New workspace"
                  @click=${stop(() => this._toggleAdd())}
                >
                  ＋
                </button>
                <button
                  class="dw-delete"
                  aria-label="Delete workspaces"
                  data-tip="Delete workspaces"
                  @click=${stop(() => this._activateDeleteMode())}
                >
                  ${unsafeHTML(TRASH_ICON)}
                </button>
              `
        }
      </div>
    `;
  }

  override render(): TemplateResult {
    const filtered = this._filtered;
    const body =
      this._loaded && this._workspaces.length === 0 && !this._adding
        ? html`<p class="empty">No workspaces yet.</p>`
        : this._searchOpen && this._workspaces.length > 0 && filtered.length === 0
          ? html`<p class="empty">No workspaces match “${this._query}”.</p>`
          : html`<ul>
              ${this._adding ? this._newRow() : nothing}
              ${filtered.map((w, i) => this._row(w, i === filtered.length - 1))}
            </ul>`;
    return html`
      <div class="wsl-scroll">${body}</div>
      <div class="wm-workspaces-bottom">
        ${this._searchOpen ? this._searchBar() : nothing} ${this._footer()}
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-workspaces-list")) {
  customElements.define("openp41ge-workspaces-list", Openp41geWorkspacesList);
}
