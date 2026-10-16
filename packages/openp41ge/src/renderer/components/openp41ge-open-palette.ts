/**
 * <openp41ge-open-palette> — the open palette (Cmd+N): a search field in the
 * middle of the window over everything that can be opened as a tab, each
 * result showing the tab type it opens in.
 *
 *   - ↑ / ↓ move; Tab / Shift+Tab switch the selected result's tab type;
 *   - Enter opens it in the focused column, Cmd+Enter in a new column;
 *   - Escape, or a click outside, closes with nothing opened.
 *
 * With nothing typed it lists what was opened before. Results arrive per
 * source (`services/open-palette/sources.ts`) and are ranked by
 * `services/open-palette/model.ts`. Renders into its light DOM, with its
 * styles added once to the document.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { emptyPaletteHistory, type PaletteHistory } from "../../shared/open-palette-ranking";
import {
  entriesFromHistory,
  rankEntries,
  type PaletteCatalog,
  type PaletteEntry,
  type RankedEntry,
  type TabTypeChoice,
} from "../services/open-palette/model";

export interface OpenPaletteDeps {
  readonly catalog: PaletteCatalog;
  history(): Promise<PaletteHistory>;
  /** Gather the entries for `query`, reporting each source's as it answers. */
  gather(query: string, onEntries: (entries: readonly PaletteEntry[]) => void): Promise<void>;
  open(entry: PaletteEntry, tabType: TabTypeChoice, newColumn: boolean, query: string): void;
  create(entry: PaletteEntry, query: string): Promise<void>;
  now(): number;
}

const STYLE_ATTR = "data-openp41ge-open-palette";
const STYLES = `
openp41ge-open-palette .op-mask { position: fixed; inset: 0; z-index: 9999; display: flex; justify-content: center; align-items: flex-start; padding-top: 18vh; background: rgba(0, 0, 0, 0.25); }
openp41ge-open-palette .op-panel { width: min(640px, calc(100vw - 32px)); max-height: 60vh; display: flex; flex-direction: column; background: var(--bg-tertiary, #252526); border: 1px solid var(--border-divider, #3a3a3a); border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); overflow: hidden; }
openp41ge-open-palette .op-input { flex: none; margin: 10px; padding: 8px 12px; border: 1px solid var(--border-divider, #333); border-radius: 6px; background: var(--bg-primary, #1e1e1e); color: var(--text-primary, #d4d4d4); font-size: 14px; font-family: inherit; outline: none; }
openp41ge-open-palette .op-input:focus { border-color: var(--accent, #4fc1ff); }
openp41ge-open-palette .op-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 6px; }
openp41ge-open-palette .op-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 6px; font-size: 13px; color: var(--text-primary, #ddd); cursor: pointer; white-space: nowrap; }
openp41ge-open-palette .op-row[aria-selected="true"] { background: color-mix(in srgb, var(--accent, #4fc1ff) 22%, transparent); }
openp41ge-open-palette .op-row:hover:not([aria-selected="true"]) { background: color-mix(in srgb, var(--text-primary, #ddd) 10%, transparent); }
openp41ge-open-palette .op-icon { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary, #aaa); font-size: 13px; }
openp41ge-open-palette .op-icon svg { width: 16px; height: 16px; }
openp41ge-open-palette .op-title { flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; }
openp41ge-open-palette .op-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted, #888); font-size: 12px; }
openp41ge-open-palette .op-type { flex: none; margin-left: auto; padding: 1px 7px; border-radius: 4px; background: var(--bg-active, #3f3f3f); font-size: 11px; color: var(--text-secondary, #aaa); }
openp41ge-open-palette .op-more { flex: none; font-size: 11px; color: var(--text-muted, #888); }
openp41ge-open-palette .op-empty { padding: 10px; font-size: 12px; color: var(--text-muted, #888); font-style: italic; }
openp41ge-open-palette .op-hint { flex: none; padding: 6px 14px; border-top: 1px solid var(--border-divider, #333); font-size: 11px; color: var(--text-muted, #888); }
`;

export class Openp41geOpenPalette extends LitElement {
  static override properties = {
    _query: { state: true },
    _ranked: { state: true },
    _selected: { state: true },
    _cycle: { state: true },
  };

  /** Set before it connects. */
  deps!: OpenPaletteDeps;
  /** Called once it closes (opened something or dismissed). */
  onclose: (() => void) | null = null;

  declare private _query: string;
  declare private _ranked: readonly RankedEntry[];
  declare private _selected: number;
  /** Per result key: how far Tab moved its tab type from the default. */
  declare private _cycle: ReadonlyMap<string, number>;

  private _history: PaletteHistory = emptyPaletteHistory();
  private _entries: PaletteEntry[] = [];
  private _generation = 0;
  private _closed = false;

  constructor() {
    super();
    this._query = "";
    this._ranked = [];
    this._selected = 0;
    this._cycle = new Map();
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!document.head.querySelector(`style[${STYLE_ATTR}]`)) {
      const style = document.createElement("style");
      style.setAttribute(STYLE_ATTR, "");
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
    void this.deps.history().then(
      (history) => {
        this._history = history;
        this._search(this._query);
      },
      () => this._search(this._query),
    );
  }

  override firstUpdated(): void {
    this.focusInput();
  }

  focusInput(): void {
    this.querySelector<HTMLInputElement>(".op-input")?.focus();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._generation++;
    this.remove();
    this.onclose?.();
  }

  private _search(query: string): void {
    const generation = ++this._generation;
    this._entries = query.trim() === "" ? entriesFromHistory(this._history, this.deps.now()) : [];
    this._cycle = new Map();
    this._selected = 0;
    this._rerank();
    void this.deps
      .gather(query, (entries) => {
        if (generation !== this._generation) return;
        this._entries = [...this._entries, ...entries];
        this._rerank();
      })
      .catch(() => {});
  }

  private _rerank(): void {
    const selectedKey = this._ranked[this._selected]?.key;
    this._ranked = rankEntries(
      this._entries,
      this._query.trim(),
      this.deps.catalog,
      this._history,
      this.deps.now(),
    );
    // Keep the selection on the same result as later sources arrive.
    const kept = selectedKey ? this._ranked.findIndex((r) => r.key === selectedKey) : -1;
    this._selected = kept >= 0 && this._selected !== 0 ? kept : 0;
  }

  /** The tab type `r` opens in now (after any Tab presses). */
  private _tabTypeOf(r: RankedEntry): TabTypeChoice | undefined {
    if (r.tabTypes.length === 0) return undefined;
    const shift = this._cycle.get(r.key) ?? 0;
    const n = r.tabTypes.length;
    return r.tabTypes[((shift % n) + n) % n];
  }

  private _choose(index: number, newColumn: boolean): void {
    const r = this._ranked[index];
    if (!r) return;
    const query = this._query;
    this.close();
    if (r.entry.type === "create") {
      void this.deps.create(r.entry, query);
      return;
    }
    const tabType = this._tabTypeOf(r);
    if (tabType) this.deps.open(r.entry, tabType, newColumn, query);
  }

  private _onKeydown(e: KeyboardEvent): void {
    // The palette owns the keyboard while it is open.
    e.stopPropagation();
    const n = this._ranked.length;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this.close();
        return;
      case "ArrowDown":
        e.preventDefault();
        if (n) this._selected = (this._selected + 1) % n;
        this._scrollSelectedIntoView();
        return;
      case "ArrowUp":
        e.preventDefault();
        if (n) this._selected = (this._selected - 1 + n) % n;
        this._scrollSelectedIntoView();
        return;
      case "Tab": {
        e.preventDefault();
        const r = this._ranked[this._selected];
        if (!r || r.tabTypes.length < 2) return;
        const next = new Map(this._cycle);
        next.set(r.key, (next.get(r.key) ?? 0) + (e.shiftKey ? -1 : 1));
        this._cycle = next;
        return;
      }
      case "Enter":
        e.preventDefault();
        this._choose(this._selected, e.metaKey || e.ctrlKey);
        return;
    }
  }

  private _scrollSelectedIntoView(): void {
    void this.updateComplete.then(() => {
      this.querySelector('.op-row[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    });
  }

  private _icon(icon: string | undefined): TemplateResult | typeof nothing {
    if (!icon) return nothing;
    return icon.trimStart().startsWith("<") ? html`${unsafeHTML(icon)}` : html`${icon}`;
  }

  /** The badge: the tab type, or for a tab offered on its own, where it opens. */
  private _typeLabel(r: RankedEntry, tabType: TabTypeChoice | undefined): string {
    if (!tabType) return "Create";
    if (r.entry.type === "tab") return tabType.placement === "sidebar" ? "Sidebar" : "Tab";
    return tabType.label;
  }

  private _row(r: RankedEntry, i: number): TemplateResult {
    const e = r.entry;
    const title = e.type === "open" ? e.item.title : e.title;
    const description = e.type === "open" ? e.item.description : e.description;
    const icon = e.type === "open" ? e.item.icon : e.icon;
    const tabType = this._tabTypeOf(r);
    return html`
      <div
        class="op-row"
        role="option"
        aria-selected=${i === this._selected ? "true" : "false"}
        @mousemove=${() => {
          if (this._selected !== i) this._selected = i;
        }}
        @click=${(ev: MouseEvent) => this._choose(i, ev.metaKey || ev.ctrlKey)}
      >
        ${icon ? html`<span class="op-icon">${this._icon(icon)}</span>` : nothing}
        <span class="op-title">${title}</span>
        <span class="op-desc">${description ?? ""}</span>
        ${r.tabTypes.length > 1 ? html`<span class="op-more" title="Tab: open in another tab type">⇥</span>` : nothing}
        <span class="op-type">${this._typeLabel(r, tabType)}</span>
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <div
        class="op-mask"
        @mousedown=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div class="op-panel" role="dialog" aria-label="Open">
          <input
            class="op-input"
            placeholder="Open a file, tab, chat, setting…"
            spellcheck="false"
            .value=${this._query}
            @input=${(e: Event) => {
              this._query = (e.target as HTMLInputElement).value;
              this._search(this._query);
            }}
            @keydown=${(e: KeyboardEvent) => this._onKeydown(e)}
          />
          <div class="op-list" role="listbox">
            ${
              this._ranked.length === 0
                ? html`<div class="op-empty">Nothing to open matches.</div>`
                : this._ranked.map((r, i) => this._row(r, i))
            }
          </div>
          <div class="op-hint">↵ open · ⌘↵ new column · ⇥ other tab type · esc close</div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-open-palette")) {
  customElements.define("openp41ge-open-palette", Openp41geOpenPalette);
}
