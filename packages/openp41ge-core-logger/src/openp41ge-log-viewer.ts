/**
 * <openp41ge-log-viewer> — Log viewer Lit component.
 *
 * Renders a flat, datetime-ordered list of log entries with a level filter
 * bar. It is **backward-paging**: it starts at the newest entries (scrolled to
 * the bottom) and, when you scroll up toward the top, loads older pages and
 * prepends them (optionally reading into prior daily files via a
 * file-backed `LogPageReader`).
 *
 * By default it reads the in-memory log bus via `MemLogPageReader`; the
 * platform injects a file-backed reader (over `~/.openp41ge-code/logs`) by setting
 * the `pageReader` property.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { LogLevel, LOG_LEVEL_LABELS } from "./log-buffer";
import {
  LOG_PAGE_DEFAULT_LIMIT,
  MemLogPageReader,
  logLineChars,
  type LogPageReader,
  type LogViewEntry,
} from "./log-page-reader";
import { LogListLayout } from "./log-list-layout";
import { findMatchRanges, type TextRange } from "./log-search";
import { OverlayScrollbar } from "openp41ge-core-scrollbar";

/**
 * One entry in the virtual list. Either the day-boundary confirmation row
 * (always index 0 when present) or a log entry.
 */
type ViewItem =
  | { kind: "boundary"; label: string; key: "__day-boundary" }
  | { kind: "entry"; entry: LogViewEntry; key: string };

/** A log entry's individually-searchable rendered fields. */
type SearchSegment = "level" | "time" | "source" | "message";

/** One individual matching occurrence — a range within one searchable segment
 * of one entry. Search counts and navigates occurrences, not whole rows. */
interface LogMatchOccurrence {
  entry: LogViewEntry;
  segment: SearchSegment;
  range: TextRange;
}

// Compact inline glyphs for the find toggles — kept as text so they read
// clearly at 11px (same intent as the file editor's find bar).
// The bottom-bar search icon matches the Explorer sidebar's Material
// magnifier+list searchIcon, so both use the same glyph.
const ICON_SEARCH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="20" height="20" fill="currentColor"><path d="M80-200v-80h400v80H80Zm0-200v-80h200v80H80Zm0-200v-80h200v80H80Zm744 400L670-354q-24 17-52.5 25.5T560-320q-83 0-141.5-58.5T360-520q0-83 58.5-141.5T560-720q83 0 141.5 58.5T760-520q0 29-8.5 57.5T726-410l154 154-56 56ZM560-400q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z"/></svg>';
// Funnel icon for the stream filter. Matches the Explorer sidebar's Material
// filter_list glyph. Uses currentColor so it tracks the button's state.
const ICON_FILTER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="20" height="20" fill="currentColor"><path d="M440-160q-17 0-28.5-11.5T400-200v-240L168-736q-15-20-4.5-42t36.5-22h560q26 0 36.5 22t-4.5 42L560-440v240q0 17-11.5 28.5T520-160h-80Zm40-308 198-252H282l198 252Zm0 0Z"/></svg>';
// Small × for the stream pills.
const ICON_CLOSE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="10" height="10" fill="currentColor"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
const ICON_REGEX =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><text x="0.5" y="11" font-size="11" font-family="Consolas,monospace" font-weight="600">.*</text></svg>';
const ICON_CASE =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><text x="0.5" y="10.5" font-size="10.5" font-family="sans-serif" font-weight="700">Aa</text></svg>';
const ICON_WORD =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><rect x="1" y="2" width="11" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1"/><text x="6.5" y="10" text-anchor="middle" font-size="7.5" font-family="sans-serif" font-weight="700">ab</text></svg>';
const ICON_PREV =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5v-5M2.2 4.8l2.8-2.8 2.8 2.8"/></svg>';
const ICON_NEXT =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5v5M2.2 5.2l2.8 2.8 2.8-2.8"/></svg>';

const LEVELS: LogLevel[] = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];

function levelClass(level: LogLevel): string {
  return LogLevel[level].toLowerCase();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
}

export class Openp41geLogViewer extends LitElement {
  static readonly tagName = "openp41ge-log-viewer";

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  @state() private _minLevel: LogLevel = LogLevel.DEBUG;
  @state() private _wrap = false;
  @state() private _entries: LogViewEntry[] = [];
  /** Monotonic longest rendered line (chars) — from the reader's maxLineChars
   *  (node/main computed) folded with local live entries. Drives the stable
   *  horizontal content width so the scrollbar doesn't flicker as the virtual
   *  window scrolls to different entries. */
  @state() private _maxLineChars = 0;

  private _pageReader: LogPageReader | null = null;
  private _system: string | null = null;
  private _source: string | null = null;
  private _cursor: unknown = null;
  private _hasOlder = false;
  private _nextDayCursor: unknown = null;
  private _nextDayLabel = "";
  private _loadingOlder = false;
  private _unsubscribeLive: (() => void) | null = null;
  private _isScrolledUp = false;
  private _scrollToBottomPending = false;
  /** The latest-page load started by `_start` (awaited by `revealError`). */
  private _initialLoad: Promise<void> = Promise.resolve();
  /** The entry `revealError` last revealed (marked in the list). */
  @state() private _revealedEntry: LogViewEntry | null = null;
  /** Custom overlay scrollbar (both axes) drawn over the log list. */
  private _scrollbar: OverlayScrollbar | null = null;
  /** Cached monospace glyph advance (px); measured on first use. */
  private _charWidthPx = 0;

  // Virtual list. Only the visible window of items is rendered; measured per-item
  // heights are cached by a stable key so they survive prepend/append/filter.
  private _layout = new LogListLayout();
  private _heightCache = new Map<string, number>();
  private _items: ViewItem[] = [];
  private _layoutDirty = true;
  private _viewStart = 0;
  private _viewEnd = 0;
  /** Guards the measure→re-render loop so a pathology can't spin the renderer. */
  private _measurePasses = 0;

  // In-log find bar (Cmd/Ctrl+F or the bottom-bar search icon). Spans today's
  // logs plus any day the user explicitly confirmed via the day-boundary row —
  // including entries not yet loaded into the virtual window.
  // Stream filter (bottom-bar funnel icon). Independent of the find bar — both
  // can be open at once, and each narrows the visible list. Multi-select: each
  // chosen stream `source` (the blue `[name]`, without brackets) becomes a pill,
  // and a matching auto-suggest popup (above the bar) adds/removes more.
  @state() private _filterOpen = false;
  @state() private _selectedStreams: string[] = [];
  @state() private _filterQuery = "";
  @state() private _filterSuggestOpen = false;
  @state() private _filterActiveIndex = 0;

  @state() private _searchOpen = false;
  @state() private _searchQuery = "";
  @state() private _searchRegex = false;
  @state() private _searchCase = false;
  @state() private _searchWholeWord = false;
  private _searchMatches: LogMatchOccurrence[] = [];
  private _activeMatchIndex = 0;
  private _activeEntry: LogViewEntry | null = null;
  private _activeSegment: SearchSegment | null = null;
  private _activeRange: TextRange | null = null;
  private _searchRangeMap = new Map<string, Record<SearchSegment, TextRange[]>>();
  /** Once the confirmed-day window has been fully drained, search is a pure
   * in-memory op (today + any explicitly-confirmed older days). */
  private _searchDrained = false;
  private _searchLoading = false;
  private _searchDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Optional backward-paging log source. Defaults to `MemLogPageReader`. */
  get pageReader(): LogPageReader | null {
    return this._pageReader;
  }

  set pageReader(value: LogPageReader | null) {
    if (value !== this._pageReader) {
      this._pageReader = value;
      if (this.isConnected) this._start();
    }
  }

  /** Optional system (plugin id / platform) filter; null = any system. */
  get system(): string | null {
    return this._system;
  }

  set system(value: string | null) {
    if (value !== this._system) {
      this._system = value;
      this.requestUpdate();
    }
  }

  /** Optional stream (logger namespace) filter; null = all logs. */
  get source(): string | null {
    return this._source;
  }

  set source(value: string | null) {
    if (value !== this._source) {
      this._source = value;
      this.requestUpdate();
    }
  }

  private get _listEl(): HTMLElement | null {
    return this.querySelector(".log-list");
  }

  connectedCallback(): void {
    super.connectedCallback();
    // If reconnecting after a disconnect (keep-alive), re-attach the overlay
    // scrollbar — firstUpdated only fires once per element lifetime.
    if (!this._scrollbar && this._listEl) this._attachScrollbar();
    // Cmd/Ctrl+F is listened on the host so it works whether focus is on the
    // host element or anywhere inside the viewer. Because the component renders
    // into light DOM, keydown events from .log-list bubble up through
    // .viewer-root to the host, so this one listener covers both. It only fires
    // when focus is actually inside THIS viewer — it must not open search when
    // focus is on the sidebar or another pane (there'd be no way to decide
    // which of several log viewers owns the shortcut).
    this.addEventListener("keydown", this._onListKeyDown);
    // Keep focus inside the viewer when the user clicks a non-interactive part
    // of the pane (gaps, padding, .log-list background). Without this, focus
    // falls back to <body> and the host listener stops catching Cmd/Ctrl+F.
    // Interactive controls (buttons, inputs, …) keep their own focus.
    this.addEventListener("pointerdown", this._onPointerDown);
    this._start();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._onListKeyDown);
    this.removeEventListener("pointerdown", this._onPointerDown);
    this._scrollbar?.destroy();
    this._scrollbar = null;
    this._teardown();
  }

  /** Attach the shared floating OverlayScrollbar (same component the file
   *  editor uses) over the log list, on both axes — the list scrolls
   *  vertically and (when wrap is off) horizontally. The native bar is hidden
   *  only on the list; the track/thumb are placed in `.viewer-root` (made
   *  position:relative), stopping at the bottom bar so the thumb overlays the
   *  list, not the filter toolbar. Pass the enclosing shadow root as
   *  styleTarget so the scoped scrollbar styles reach the list in a shadow
   *  tree (e.g. a log grid tab). */
  private _attachScrollbar(): void {
    if (this._scrollbar) return;
    // jsdom/test env has no ResizeObserver; skip attaching gracefully.
    if (typeof ResizeObserver === "undefined") return;
    const list = this._listEl;
    const container = this.querySelector<HTMLElement>(".viewer-root");
    if (!list || !container) return;
    const root = this.getRootNode();
    const styleTarget = root instanceof ShadowRoot ? root : undefined;
    this._scrollbar = OverlayScrollbar.attach(list, {
      axis: "both",
      container,
      // The bottom inset uses a CSS variable the viewer updates whenever the
      // filter/find bars open or close, so both the horizontal and vertical
      // scrollbars stop ABOVE the bars (which sit between the list and the
      // bottom bar) instead of extending down over them. Default 34px = the
      // bottom bar's height (the previous fixed value when no bars are shown).
      inset: { bottom: "var(--lw-scrollbar-bottom, 34px)" },
      styleTarget,
      size: 9,
      hoverSize: 12,
      autoHide: true,
    });
  }

  /** Height between the bottom of the log list and the bottom of the viewer,
   *  i.e. the filter/find bar(s) + the bottom bar. Drives the overlay
   *  scrollbar's bottom inset so the thumbs stop above the bars when they are
   *  shown. */
  private _updateScrollbarInset(): void {
    const container = this.querySelector<HTMLElement>(".viewer-root");
    const list = this._listEl;
    if (!container || !list) return;
    const below = container.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
    container.style.setProperty("--lw-scrollbar-bottom", `${Math.max(0, below)}px`);
  }

  protected firstUpdated(): void {
    this._attachScrollbar();
    this._updateScrollbarInset();
  }

  /** Advance width (px) of one glyph in the viewer's monospace font, measured
   *  once against a probe run and cached. Falls back to an estimate when the
   *  DOM can't lay out (tests). */
  private _measureCharWidth(): number {
    if (this._charWidthPx > 0) return this._charWidthPx;
    let w = 0;
    try {
      const s = document.createElement("span");
      s.textContent = "M".repeat(200);
      s.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:pre;" +
        "font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace;font-size:12px;";
      document.body.appendChild(s);
      w = s.getBoundingClientRect().width / 200;
      s.remove();
    } catch {
      w = 0;
    }
    this._charWidthPx = w > 0 ? w : 7.2;
    return this._charWidthPx;
  }

  /** Stable horizontal content width (px) anchored to the longest line. The
   *  log list's scrollWidth therefore only changes when a genuinely longer
   *  line is loaded — the node reports the longest line's char count (see
   *  `logLineChars`), and the viewer converts it to pixels (monospace advance
   *  × chars + the fixed per-row spacing: level/time/source margins + the
   *  row's horizontal padding). 0 = no content yet (no horizontal overflow). */
  private _contentWidthPx(): number {
    if (this._maxLineChars <= 0) return 0;
    return Math.ceil(this._measureCharWidth() * this._maxLineChars + 32);
  }

  private _onPointerDown = (e: PointerEvent): void => {
    // Don't steal focus from interactive controls the user is about to operate.
    const t = e.target as HTMLElement | null;
    if (t && t.closest("button, input, textarea, select, a, [contenteditable]")) return;
    // Keep focus inside the filter bar (input + suggest popup) while the user
    // clicks a pill or a suggestion, otherwise focusing the list blurs the
    // input and the popup closes on the very first option click.
    if (t && t.closest(".filter-bar-wrap")) return;
    this._listEl?.focus();
  };

  /** The entries that pass the current level + stream filter (all logs, datetime order). */
  private get _visible(): LogViewEntry[] {
    const streams = new Set(this._selectedStreams.map((s) => s.toLowerCase()));
    return this._entries.filter((e) => {
      if (e.level < this._minLevel) return false;
      if (streams.size && !streams.has(e.source.toLowerCase())) return false;
      return true;
    });
  }

  /** Stable key used to cache an item's measured pixel height. */
  private _entryKey(entry: LogViewEntry): string {
    return `${entry.timestamp}|${entry.level}|${entry.system}|${entry.source}|${entry.message}`;
  }

  /** Rebuild the virtual-item list (boundary row first, then filtered entries). */
  private _rebuildItems(): ViewItem[] {
    const items: ViewItem[] = [];
    if (this._nextDayCursor !== null) {
      items.push({ kind: "boundary", label: this._nextDayLabel, key: "__day-boundary" });
    }
    for (const entry of this._visible) {
      items.push({ kind: "entry", entry, key: this._entryKey(entry) });
    }
    this._items = items;
    return items;
  }

  /**
   * Reconcile the layout with the current item list after a mutation
   * (prepend, append, filter change, boundary appearance). Re-applies the
   * measured-height cache so previously measured rows keep their height even
   * when their index shifted after a prepend.
   */
  private _syncLayout(items: ViewItem[]): void {
    const n = items.length;
    if (this._layout.count !== n) {
      this._layout.setCount(n);
    }
    const updates: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const h = this._heightCache.get(items[i].key);
      if (h !== undefined) updates.push([i, h]);
    }
    if (updates.length > 0) this._layout.updateHeights(updates);
    this._layoutDirty = false;
    this._measurePasses = 0;
  }

  private _start(): void {
    this._teardown();
    const reader = this._pageReader || new MemLogPageReader();
    this._pageReader = reader;
    this._entries = [];
    this._maxLineChars = 0;
    this._cursor = null;
    this._hasOlder = false;
    this._nextDayCursor = null;
    this._nextDayLabel = "";
    this._loadingOlder = false;
    this._layout = new LogListLayout();
    this._heightCache = new Map<string, number>();
    this._items = [];
    this._layoutDirty = true;
    this._viewStart = 0;
    this._viewEnd = 0;
    this._measurePasses = 0;
    this._filterOpen = false;
    this._selectedStreams = [];
    this._filterQuery = "";
    this._filterSuggestOpen = false;
    this._filterActiveIndex = 0;
    this._searchOpen = false;
    this._searchQuery = "";
    this._searchMatches = [];
    this._activeMatchIndex = 0;
    this._activeEntry = null;
    this._activeSegment = null;
    this._activeRange = null;
    this._searchRangeMap = new Map<string, Record<SearchSegment, TextRange[]>>();
    this._searchDrained = false;
    this._searchLoading = false;
    if (this._searchDebounce) {
      clearTimeout(this._searchDebounce);
      this._searchDebounce = null;
    }
    this._unsubscribeLive = reader.subscribe((entry) => this._onLiveEntry(entry));
    this._revealedEntry = null;
    this._initialLoad = this._loadLatest(reader);
  }

  /** Fold a page's node-computed longest line into the local max (monotonic). */
  private _acceptMaxChars(n: number | undefined): void {
    if (typeof n === "number" && n > this._maxLineChars) this._maxLineChars = n;
  }

  private _teardown(): void {
    this._unsubscribeLive?.();
    this._unsubscribeLive = null;
  }

  private async _loadLatest(reader: LogPageReader): Promise<void> {
    try {
      const page = await reader.loadLatest(LOG_PAGE_DEFAULT_LIMIT);
      if (this._pageReader !== reader) return;
      // Merge, don't clobber: live entries may have arrived while the initial
      // page was being loaded (they are newer than the loaded window).
      this._entries = [...page.entries, ...this._entries];
      this._layoutDirty = true;
      this._cursor = page.cursor;
      this._hasOlder = page.hasOlder;
      this._acceptMaxChars(page.maxLineChars);
      this._nextDayCursor = page.nextDayCursor ?? null;
      this._nextDayLabel = page.nextDayLabel ?? "";
      this._scrollToBottomPending = true;
    } catch {
      // The injected reader failed (e.g. the file-backed bridge isn't wired
      // yet). Fall back to the in-memory bus so the pane is never blank.
      this._pageReader = new MemLogPageReader();
      this._unsubscribeLive?.();
      this._unsubscribeLive = this._pageReader.subscribe((e) => this._onLiveEntry(e));
      try {
        const page = await this._pageReader.loadLatest(LOG_PAGE_DEFAULT_LIMIT);
        this._entries = page.entries;
        this._layoutDirty = true;
        this._cursor = page.cursor;
        this._hasOlder = page.hasOlder;
        this._acceptMaxChars(page.maxLineChars);
        this._nextDayCursor = page.nextDayCursor ?? null;
        this._nextDayLabel = page.nextDayLabel ?? "";
        this._scrollToBottomPending = true;
      } catch {
        // ignore
      }
    }
  }

  /**
   * Load the next older page. Called by the scroll handler (within-day, auto)
   * with no argument, or by the day-boundary confirmation row with an explicit
   * `target` cursor to cross into an older day.
   */
  private async _loadOlder(target?: unknown): Promise<void> {
    if (this._loadingOlder || !this._pageReader) return;
    if (target === undefined && !this._hasOlder) return;
    this._loadingOlder = true;
    const list = this._listEl;
    const oldScrollTop = list?.scrollTop ?? 0;
    const oldScrollHeight = list?.scrollHeight ?? 0;
    const reader = this._pageReader;
    const cursor = target !== undefined ? target : this._cursor;
    try {
      const page = await reader.loadOlder(cursor, LOG_PAGE_DEFAULT_LIMIT);
      if (this._pageReader !== reader) return;
      this._entries = [...page.entries, ...this._entries];
      this._layoutDirty = true;
      this._cursor = page.cursor;
      this._hasOlder = page.hasOlder;
      this._acceptMaxChars(page.maxLineChars);
      this._nextDayCursor = page.nextDayCursor ?? null;
      this._nextDayLabel = page.nextDayLabel ?? "";
      await this.updateComplete;
      const newList = this._listEl;
      if (newList) {
        newList.scrollTop = oldScrollTop + (newList.scrollHeight - oldScrollHeight);
      }
      // A day-boundary click crossed into an explicitly-confirmed older day:
      // that day is now part of the searchable window. Mark it undrained (so the
      // next search re-drains the rest of that day) and re-run the search so
      // matches span the newly-confirmed entries too.
      if (target !== undefined) {
        this._searchDrained = false;
        if (this._searchOpen) this._scheduleSearch();
      }
    } catch {
      // ignore — the next scroll will retry.
    } finally {
      this._loadingOlder = false;
    }
  }

  private _onLiveEntry(entry: LogViewEntry): void {
    this._entries = [...this._entries, entry];
    this._layoutDirty = true;
    this._acceptMaxChars(logLineChars(entry));
    // If the user is at the bottom, auto-scroll to it on the next paint.
    if (!this._isScrolledUp) this._scrollToBottomPending = true;
    // Live entries may match the active query → refresh the search result set.
    if (this._searchOpen) this._scheduleSearch();
  }

  private _setLevel(lvl: LogLevel): void {
    this._minLevel = lvl;
    this._layoutDirty = true;
    if (this._searchOpen) this._computeSearchMatches();
  }

  private _toggleWrap(): void {
    this._wrap = !this._wrap;
    // Wrapping changes every row's height, so discard measured heights.
    this._heightCache = new Map<string, number>();
    this._layoutDirty = true;
  }

  // ═══ Stream filter (bottom-bar funnel) ────────────────────────────────

  /** Unique stream (source) names currently loaded, sorted for the popup. */
  private get _availableStreams(): string[] {
    const set = new Set<string>();
    for (const e of this._entries) set.add(e.source);
    return [...set].sort();
  }

  /** Streams shown in the popup, narrowed by what the user has typed. */
  private get _suggestStreams(): string[] {
    const query = this._filterQuery.trim().toLowerCase();
    const streams = this._availableStreams;
    if (!query) return streams;
    return streams.filter((s) => s.toLowerCase().includes(query));
  }

  private _isSelected(stream: string): boolean {
    return this._selectedStreams.some((s) => s.toLowerCase() === stream.toLowerCase());
  }

  /** Open the filter bar; if a stream is given, add it to the selection. */
  private _openFilter(source?: string): void {
    this._filterOpen = true;
    if (source) this._addStream(source);
    // Focus AFTER Lit has rendered the input (openFilter only marks state).
    setTimeout(() => this._focusFilter(), 0);
  }

  private _closeFilter(): void {
    this._filterOpen = false;
    this._selectedStreams = [];
    this._filterQuery = "";
    this._filterSuggestOpen = false;
    this._filterActiveIndex = 0;
    this._layoutDirty = true;
    if (this._searchOpen) this._computeSearchMatches();
    this.requestUpdate();
  }

  private _toggleFilter(): void {
    if (this._filterOpen) this._closeFilter();
    else this._openFilter();
  }

  /** Replace the selection, mark the list dirty so `_visible` is re-rendered,
   * and recompute any active search over it. */
  private _setSelectedStreams(streams: string[]): void {
    this._selectedStreams = streams;
    this._layoutDirty = true;
    if (this._searchOpen) this._computeSearchMatches();
    this.requestUpdate();
  }

  /** Add a stream (if absent) — used by clicking a stream name in a log row. */
  private _addStream(stream: string): void {
    if (this._isSelected(stream)) return;
    this._setSelectedStreams([...this._selectedStreams, stream]);
  }

  /** Add or remove a stream — used by the popup (click / Enter / Space). */
  private _toggleStream(stream: string): void {
    this._setSelectedStreams(
      this._isSelected(stream)
        ? this._selectedStreams.filter((s) => s.toLowerCase() !== stream.toLowerCase())
        : [...this._selectedStreams, stream],
    );
  }

  /** Remove a stream — used by the pill's × button. */
  private _removeStream(stream: string): void {
    const lowered = stream.toLowerCase();
    this._setSelectedStreams(this._selectedStreams.filter((s) => s.toLowerCase() !== lowered));
  }

  private _openSuggest(): void {
    this._filterSuggestOpen = true;
    this.requestUpdate();
  }

  private _closeSuggest(): void {
    this._filterSuggestOpen = false;
    this._filterActiveIndex = 0;
    this.requestUpdate();
  }

  private _focusFilter(): void {
    this.querySelector<HTMLInputElement>("[data-testid=log-filter-input]")?.focus();
  }

  private _onFilterInput = (e: InputEvent): void => {
    this._filterQuery = (e.target as HTMLInputElement).value;
    this._filterActiveIndex = 0;
    this._openSuggest();
  };

  private _onFilterFocusOut = (e: FocusEvent): void => {
    // Keep the popup open when focus moves within the filter bar (e.g. to a
    // pill's × button); close it when focus leaves entirely (clicking away).
    const next = e.relatedTarget as Node | null;
    const wrap = this.querySelector<HTMLElement>(".filter-bar-wrap");
    if (wrap && next && wrap.contains(next)) return;
    this._closeSuggest();
  };

  private _onFilterKeyDown = (e: KeyboardEvent): void => {
    const streams = this._suggestStreams;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!this._filterSuggestOpen) {
        this._openSuggest();
        this._filterActiveIndex = 0;
      } else if (streams.length) {
        this._filterActiveIndex = Math.min(this._filterActiveIndex + 1, streams.length - 1);
      }
      this.requestUpdate();
      void this.updateComplete.then(() => this._scrollActiveSuggestIntoView());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!this._filterSuggestOpen) {
        this._openSuggest();
        this._filterActiveIndex = Math.max(streams.length - 1, 0);
      } else if (streams.length) {
        this._filterActiveIndex = Math.max(this._filterActiveIndex - 1, 0);
      }
      this.requestUpdate();
      void this.updateComplete.then(() => this._scrollActiveSuggestIntoView());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!this._filterSuggestOpen) {
        this._openSuggest();
      } else if (streams.length) {
        const idx = Math.min(this._filterActiveIndex, streams.length - 1);
        this._toggleStream(streams[idx]);
      }
    } else if (e.key === "Escape") {
      if (this._filterSuggestOpen) {
        this._closeSuggest();
      } else {
        this._closeFilter();
        this._listEl?.focus();
      }
    }
  };

  private _scrollActiveSuggestIntoView(): void {
    const el = this.querySelector<HTMLElement>(
      `[data-filter-suggest-index="${this._filterActiveIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }

  // ═══ In-log find (Cmd/Ctrl+F) ─────────────────────────────────────────

  private _searchSegments(entry: LogViewEntry): Array<{ segment: SearchSegment; text: string }> {
    return [
      { segment: "level", text: LOG_LEVEL_LABELS[entry.level] },
      { segment: "time", text: formatTime(entry.timestamp) },
      { segment: "source", text: entry.source },
      { segment: "message", text: entry.message },
    ];
  }

  private _openSearch(): void {
    this._searchOpen = true;
    void this._refreshSearch();
    // Focus AFTER Lit has rendered the find input (openSearch just marks
    // state; the DOM node exists on the next tick).
    setTimeout(() => this._focusSearch(), 0);
  }

  private _closeSearch(): void {
    this._searchOpen = false;
    this._searchMatches = [];
    this._activeMatchIndex = 0;
    this._activeEntry = null;
    this._activeSegment = null;
    this._activeRange = null;
    this._searchRangeMap = new Map<string, Record<SearchSegment, TextRange[]>>();
  }

  /**
   * Focus the log list so keyboard shortcuts (Cmd/Ctrl+F, arrow nav) apply.
   * Called by the platform when the log-viewer tab becomes active, since a
   * freshly-activated grid tab does not otherwise move focus into its content.
   */
  focus(): void {
    void this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(".log-list")?.focus();
    });
  }

  /**
   * Programmatically open the find bar with `query`, highlight the matching
   * lines, and jump to the first match. Used by a log tab when a
   * cross-stream search result is opened, so the viewer lands on that hit.
   */
  /**
   * Show the ERROR entry with this `errorId`: page older (crossing day
   * boundaries) until it is loaded, clear a stream filter that hides it, scroll
   * to it, mark it, and open its detail — a `log-row-click`, as a click on the
   * row would. Resolves to the entry, or null when no page has it.
   */
  async revealError(errorId: string): Promise<LogViewEntry | null> {
    await this._initialLoad;
    const reader = this._pageReader;
    const find = (): LogViewEntry | null =>
      this._entries.findLast((e) => e.errorId === errorId) ?? null;
    let entry = find();
    for (let pages = 0; !entry && pages < 1000; pages++) {
      let target: unknown;
      if (this._hasOlder) target = undefined;
      else if (this._nextDayCursor !== null) target = this._nextDayCursor;
      else break;
      const before = this._entries.length;
      await this._loadOlder(target);
      if (this._pageReader !== reader) return null;
      // Nothing was added: the source is exhausted (or the load failed).
      if (this._entries.length === before) break;
      entry = find();
    }
    if (!entry) return null;
    if (!this._visible.includes(entry)) this._setSelectedStreams([]);
    this._revealedEntry = entry;
    this._layoutDirty = true;
    await this.updateComplete;
    this._scrollToEntry(entry);
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent("log-row-click", { detail: { entry }, bubbles: true, composed: true }),
    );
    return entry;
  }

  setFindQuery(query: string): void {
    this._searchQuery = query;
    this._searchOpen = true;
    void this._refreshSearch().then(() => {
      if (this._searchMatches.length > 0) {
        // Start from index -1 so `_nextMatch(1)` lands on (and scrolls to) 0.
        this._activeMatchIndex = -1;
        void this._nextMatch(1);
      }
    });
    this.requestUpdate();
  }

  private _focusSearch(): void {
    const input = this.querySelector<HTMLInputElement>("[data-testid=log-find-input]");
    input?.focus();
    input?.select();
  }

  private _onListKeyDown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      this._openSearch();
    }
  };

  private _onFindInput = (e: InputEvent): void => {
    this._searchQuery = (e.target as HTMLInputElement).value;
    this._scheduleSearch();
  };

  private _onFindKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      void this._nextMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      this._closeSearch();
      this._listEl?.focus();
    }
  };

  private _toggleRegex = (): void => {
    this._searchRegex = !this._searchRegex;
    if (this._searchOpen) this._computeSearchMatches();
  };

  private _toggleCase = (): void => {
    this._searchCase = !this._searchCase;
    if (this._searchOpen) this._computeSearchMatches();
  };

  private _toggleWholeWord = (): void => {
    this._searchWholeWord = !this._searchWholeWord;
    if (this._searchOpen) this._computeSearchMatches();
  };

  private _scheduleSearch(): void {
    if (this._searchDebounce) clearTimeout(this._searchDebounce);
    this._searchDebounce = setTimeout(() => {
      this._searchDebounce = null;
      void this._refreshSearch();
    }, 150);
  }

  /** Drain the confirmed-day window (today + any explicitly-confirmed older
   * days) fully so search covers entries the user hasn't scrolled to yet. Stops
   * at the next day boundary — it never auto-crosses into an unconfirmed
   * previous day. Pages are accumulated and applied in a single `_entries`
   * assignment so the drain does not re-render (and scroll-anchor) once per
   * page — that repetition is what made typing "scroll". */
  private async _drainSearchWindow(): Promise<void> {
    if (this._searchDrained || this._searchLoading || !this._pageReader) return;
    this._searchLoading = true;
    // Hold the page lock so the scroll handler's auto-load doesn't race us.
    this._loadingOlder = true;
    const reader = this._pageReader;
    const list = this._listEl;
    const oldScrollTop = list?.scrollTop ?? 0;
    const oldScrollHeight = list?.scrollHeight ?? 0;
    let cursor = this._cursor;
    let hasOlder = this._hasOlder;
    let nextDayCursor = this._nextDayCursor;
    let nextDayLabel = this._nextDayLabel;
    let guard = 0;
    const collected: LogViewEntry[] = [];
    try {
      while (hasOlder && guard < 20000) {
        guard++;
        const page = await reader.loadOlder(cursor, LOG_PAGE_DEFAULT_LIMIT);
        if (this._pageReader !== reader) return;
        collected.push(...page.entries);
        cursor = page.cursor;
        hasOlder = page.hasOlder;
        this._acceptMaxChars(page.maxLineChars);
        nextDayCursor = page.nextDayCursor ?? null;
        nextDayLabel = page.nextDayLabel ?? "";
      }
      this._searchDrained = true;
      // Apply the whole drain in one state change (one render), not per page.
      this._entries = [...collected, ...this._entries];
      this._cursor = cursor;
      this._hasOlder = hasOlder;
      this._nextDayCursor = nextDayCursor;
      this._nextDayLabel = nextDayLabel;
      this._layoutDirty = true;
    } finally {
      this._searchLoading = false;
      this._loadingOlder = false;
      // Let the render rebuild the spacers, then reposition exactly once so the
      // content the user was viewing stays put. The drain only prepends, so the
      // single delta keeps the viewport anchored (no jump, no scroll-animating).
      await this.updateComplete;
      const newList = this._listEl;
      if (newList) {
        newList.scrollTop = oldScrollTop + (newList.scrollHeight - oldScrollHeight);
      }
      this.requestUpdate();
    }
  }

  private async _refreshSearch(): Promise<void> {
    if (!this._searchOpen) return;
    // Only drain the confirmed-day window once a query is typed. Opening the
    // bar with an empty query must not prepend all of today's entries — that
    // reflows the virtual list and (via the scroll-preserve delta) yanks a
    // top-scrolled view down to the bottom the moment Cmd/Ctrl+F is pressed.
    if (this._searchQuery.trim()) {
      await this._drainSearchWindow();
      if (!this._searchOpen) return;
    }
    this._computeSearchMatches();
    this.requestUpdate();
  }

  private _computeSearchMatches(): void {
    const q = this._searchQuery.trim();
    this._searchMatches = [];
    this._searchRangeMap = new Map<string, Record<SearchSegment, TextRange[]>>();
    this._activeMatchIndex = 0;
    this._activeEntry = null;
    this._activeSegment = null;
    this._activeRange = null;
    if (!this._searchOpen || !q) return;
    const opts = {
      regex: this._searchRegex,
      caseSensitive: this._searchCase,
      wholeWord: this._searchWholeWord,
    };
    for (const entry of this._visible) {
      const ranges: Record<SearchSegment, TextRange[]> = {
        level: [],
        time: [],
        source: [],
        message: [],
      };
      const segments = this._searchSegments(entry);
      for (const seg of segments) {
        const rr = findMatchRanges(seg.text, q, opts);
        if (rr.length > 0) ranges[seg.segment] = rr;
      }
      if (!segments.some((s) => ranges[s.segment].length > 0)) continue;
      // Keep ranges for highlighting every occurrence in the entry.
      this._searchRangeMap.set(this._entryKey(entry), ranges);
      // Count each occurrence individually, in the visual order of the row
      // (level → time → source → message).
      for (const seg of segments) {
        for (const range of ranges[seg.segment]) {
          this._searchMatches.push({ entry, segment: seg.segment, range });
        }
      }
    }
    if (this._searchMatches.length > 0) {
      const first = this._searchMatches[0];
      this._activeEntry = first.entry;
      this._activeSegment = first.segment;
      this._activeRange = first.range;
    }
  }

  private async _nextMatch(dir: 1 | -1): Promise<void> {
    if (this._searchMatches.length === 0) return;
    this._activeMatchIndex =
      (this._activeMatchIndex + dir + this._searchMatches.length) % this._searchMatches.length;
    const occ = this._searchMatches[this._activeMatchIndex];
    this._activeEntry = occ.entry;
    this._activeSegment = occ.segment;
    this._activeRange = occ.range;
    await this.updateComplete;
    this._scrollToEntry(this._activeEntry);
  }

  /** Jump the list to `entry` (a visible, rendered entry). */
  private _scrollToEntry(entry: LogViewEntry): void {
    const visibleIndex = this._visible.indexOf(entry);
    if (visibleIndex < 0) return;
    const itemIndex = visibleIndex + (this._nextDayCursor !== null ? 1 : 0);
    const list = this._listEl;
    if (list) {
      const top = Math.max(0, this._layout.offsetAt(itemIndex));
      // Jump straight to the match — never animate. The offset table is exact
      // now that unmeasured items use the measured row height, so this lands
      // on the match (not drifted by accumulated estimate error).
      if (typeof list.scrollTo === "function") {
        list.scrollTo({ top, behavior: "instant" });
      } else {
        // jsdom has no scrollTo; assign scrollTop directly.
        list.scrollTop = top;
      }
      this._measurePasses = 0;
    }
    this.requestUpdate();
  }

  /** Render a searchable field with `<mark>` highlight(s) for the matching ranges. */
  private _highlighted(
    entry: LogViewEntry,
    segment: SearchSegment,
    displayText?: string,
  ): TemplateResult {
    const text: string =
      displayText ??
      {
        level: LOG_LEVEL_LABELS[entry.level],
        time: formatTime(entry.timestamp),
        source: entry.source,
        message: entry.message,
      }[segment];
    const allRanges = this._searchRangeMap.get(this._entryKey(entry))?.[segment];
    // The row may show a truncated message (first line only); clip the search
    // highlight ranges to the displayed text so range indices stay valid.
    const ranges = allRanges?.filter((r) => r.end <= text.length) ?? [];
    if (!this._searchOpen || ranges.length === 0) {
      return html`${this._escapeHtml(text)}`;
    }
    const parts: TemplateResult[] = [];
    let last = 0;
    for (const r of ranges) {
      if (r.start > last) parts.push(html`${this._escapeHtml(text.slice(last, r.start))}`);
      const isActive =
        this._activeEntry === entry &&
        this._activeSegment === segment &&
        this._activeRange?.start === r.start &&
        this._activeRange?.end === r.end;
      parts.push(
        html`<mark class="${isActive ? "find-match-active" : "find-match"}"
          >${this._escapeHtml(text.slice(r.start, r.end))}</mark
        >`,
      );
      last = r.end;
    }
    if (last < text.length) parts.push(html`${this._escapeHtml(text.slice(last))}`);
    return html`${parts}`;
  }

  /** One icon toggle for the find strip (regex / match-case / whole-word). */
  private _findToggle(
    icon: string,
    title: string,
    active: boolean,
    testId: string,
    onClick: () => void,
  ): TemplateResult {
    return html`<button
      type="button"
      data-testid=${testId}
      title=${title}
      class="find-toggle${active ? " active" : ""}"
      @click=${onClick}
    >
      ${unsafeHTML(icon)}
    </button>`;
  }

  /** The first line of a message — what the row shows. The rest of the
   *  message (typically an appended stack trace) is shown in the detail drawer. */
  private _messageFirstLine(message: string): string {
    const nl = message.indexOf("\n");
    return nl < 0 ? message : message.slice(0, nl);
  }

  /** A click on a log row (not its stream name) opens the detail drawer: emit
   *  a bubbling custom event carrying the full entry so the log tab's host
   *  can show its details. The stream-name click is left to `_openFilter`. */
  private _onLogListClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(".log-name")) return;
    const row = target.closest(".log-entry") as (HTMLElement & { entry?: LogViewEntry }) | null;
    const entry = row?.entry;
    if (!entry) return;
    this.dispatchEvent(
      new CustomEvent("log-row-click", { detail: { entry }, bubbles: true, composed: true }),
    );
  };

  private _onScroll(): void {
    const el = this._listEl;
    if (!el) return;
    this._isScrolledUp = el.scrollTop + el.clientHeight < el.scrollHeight - 10;
    // Near the top → load the next (older) page.
    if (this._isScrolledUp && el.scrollTop < 48) {
      this._loadOlder();
    }
    // Re-render the window for the new scroll position. Lit coalesces these
    // into one update per microtask.
    this._measurePasses = 0;
    this.requestUpdate();
  }

  private _escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  updated(): void {
    const el = this._listEl;
    if (!el) return;
    // The overlay scrollbar reads scrollWidth/scrollHeight; a width change to
    // the longest-line spacer (an attribute change, not a childList mutation
    // the scrollbar's observer watches) won't repaint it on its own. Refresh it
    // on every render so the thumb tracks the current content width/height.
    // Also recompute the bottom inset when the filter/find bars open or close.
    this._updateScrollbarInset();
    this._scrollbar?.update();

    // Measure the rendered window so offset math stays accurate (rows may wrap
    // to variable heights). Cache by stable key and re-render once if anything
    // changed; converges after one correction because heights stop changing.
    const updates: Array<[number, number]> = [];
    el.querySelectorAll<HTMLElement>("[data-item-key]").forEach((node, idx) => {
      const key = node.getAttribute("data-item-key") ?? "";
      const h = node.offsetHeight;
      if (this._heightCache.get(key) !== h) {
        this._heightCache.set(key, h);
        updates.push([this._viewStart + idx, h]);
      }
    });
    this._measurePasses += 1;
    if (updates.length > 0) {
      this._layout.updateHeights(updates);
      // If the visible rows share a consistent real height, use it as the
      // estimate for every *unmeasured* item. Otherwise a far-away match is
      // offset by the accumulated estimate error (rows are ~20px but the
      // default estimate is 18px), so jump-to-match lands in the wrong place.
      const counts = new Map<number, number>();
      let mode = 0;
      let best = 0;
      for (const [, h] of updates) {
        const c = (counts.get(h) ?? 0) + 1;
        counts.set(h, c);
        if (c > best) {
          best = c;
          mode = h;
        }
      }
      if (mode > 0) this._layout.setDefaultHeight(mode);
      // Re-render so the offset table reflects measured heights — but stop after
      // a few corrections so a pathological height oscillation can't loop.
      if (this._measurePasses <= 3) {
        this.requestUpdate();
      }
    }

    if (this._scrollToBottomPending) {
      this._scrollToBottomPending = false;
      this._isScrolledUp = false;
      el.scrollTop = el.scrollHeight;
    }
  }

  render() {
    const items = this._layoutDirty ? this._rebuildItems() : this._items;
    if (this._layoutDirty) this._syncLayout(items);
    const list = this._listEl;
    const viewportH = list?.clientHeight ?? 300;
    const scrollTop = list?.scrollTop ?? 0;
    // When auto-scrolling to the bottom, seed the window at the bottom so the
    // user never sees a flash of the top of the list.
    const winScroll = this._scrollToBottomPending
      ? Math.max(0, this._layout.totalHeight - viewportH)
      : scrollTop;
    const { start, end, offsetTop, offsetBottom } = this._layout.window(winScroll, viewportH);
    this._viewStart = start;
    this._viewEnd = end;
    const windowItems = items.slice(start, end);
    const searchCount =
      this._searchMatches.length > 0
        ? `${this._activeMatchIndex + 1}/${this._searchMatches.length}`
        : this._searchQuery.trim()
          ? "No matches"
          : "";
    return html`
      <style>
        /* Light-DOM component: the :host selector is ignored here, so the host
           is matched by tag selector to fill its pane container. */
        openp41ge-log-viewer {
          display: block;
          width: 100%;
          height: 100%;
          overflow: hidden;
          box-sizing: border-box;
        }
        .viewer-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #d4d4d4);
          font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace;
          font-size: 12px;
          overflow: hidden;
          /* Serves as the positioned container for the floating overlay
             scrollbar (its track/thumb are absolutely placed inside). */
          position: relative;
        }
        .log-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
          /* Never let the browser re-anchor scrollTop when the drain prepends
             content above the viewport. Without this, every re-render during a
             search drain nudges scrollTop down (appearing as "scrolling"). */
          overflow-anchor: none;
        }
        /* The app injects a global [tabindex]:focus-visible { outline: 2px solid
           #4a9eff }. The log list is focused on any click in the pane (to keep
           ⌘F working), which would paint a distracting blue box around the whole
           tab content view. Suppress it here (same treatment as the find/filter
           inputs below). */
        .log-list:focus,
        .log-list:focus-visible {
          outline: none;
        }
        .bottom-bar {
          display: flex;
          align-items: center;
          height: 34px;
          padding: 0;
          box-sizing: border-box;
          background: var(--bg-primary, #1e1e1e);
          border-top: 1px solid var(--border-divider, #2d2d2d);
          color: var(--text-secondary, #999);
          font-size: 12px;
          flex-shrink: 0;
        }
        .level-btn {
          position: relative;
          overflow: visible;
          display: flex;
          align-items: center;
          justify-content: center;
          align-self: stretch;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary, #999);
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
          padding: 0 10px;
          height: auto;
          box-sizing: border-box;
        }
        /* Hovering a level button highlights it and every more-severe level —
           the same cumulative set that becomes active when it is selected
           (hover INFO lights INFO+WARN+ERROR, hover DEBUG lights all four). */
        .level-btn:hover,
        .level-btn:hover ~ .level-btn {
          background: rgba(255, 255, 255, 0.07);
          color: var(--text-primary, #fff);
        }
        .level-btn.active {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
        }
        .spacer {
          flex: 1;
        }
        .sep {
          flex-shrink: 0;
          width: 1px;
          align-self: stretch;
          margin: 0;
          background: var(--border-divider, #2d2d2d);
        }
        .wrap-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          align-self: stretch;
          width: calc(34px + var(--grid-edge-right-pad, 0px));
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary, #999);
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
          padding: 0 var(--grid-edge-right-pad, 0px) 0 0;
          box-sizing: border-box;
          flex-shrink: 0;
        }
        .wrap-btn svg {
          display: block;
        }
        .wrap-btn:hover {
          background: rgba(255, 255, 255, 0.07);
          color: var(--text-primary, #fff);
        }
        .wrap-btn.active {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
        }
        .day-boundary {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 6px 8px;
          margin: 4px 8px;
          border: 1px solid var(--border-divider, #3c3c3c);
          border-radius: 4px;
          background: #2a2a2a;
          color: var(--text-secondary, #999);
          cursor: pointer;
          user-select: none;
        }
        .day-boundary:hover {
          background: #333;
          color: var(--text-primary, #d4d4d4);
        }
        .day-boundary-label {
          color: #569cd6;
        }
        .day-boundary-hint {
          font-size: 11px;
          opacity: 0.7;
        }
        .log-entry {
          display: block;
          padding: 1px 8px;
          line-height: 1.5;
          word-break: break-all;
        }
        .log-entry:hover {
          background: #2a2a2a;
        }
        .log-entry.level-debug {
          color: #6a9955;
        }
        .log-entry.level-info {
          color: #d4d4d4;
        }
        .log-entry.level-warn {
          color: #d7ba7d;
        }
        .log-entry.level-error {
          color: #f44747;
        }
        .log-entry.revealed {
          background: #3a2a2a;
          box-shadow: inset 2px 0 0 #f44747;
        }
        .log-level-tag {
          display: inline;
          font-weight: bold;
          opacity: 0.7;
          margin-right: 6px;
        }
        .log-time {
          display: inline;
          color: #666;
          margin-right: 6px;
        }
        .log-name {
          display: inline;
          color: #569cd6;
          margin-right: 4px;
          cursor: pointer;
        }
        .log-name:hover {
          text-decoration: underline;
        }
        .log-text {
          display: inline;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .log-list.nowrap {
          overflow-x: auto;
        }
        .log-list.nowrap .log-entry {
          white-space: nowrap;
        }
        .log-list.nowrap .log-text {
          white-space: pre;
          word-break: normal;
        }
        .vspacer {
          flex-shrink: 0;
        }
        /* Invisible row that pins the log list's content (scroll) width to the
           longest line, so the horizontal scrollbar only changes when a
           genuinely longer line is loaded. height:0 so it adds no row. */
        .log-width-spacer {
          height: 0;
          flex-shrink: 0;
        }
        .empty-msg {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #555;
          font-size: 13px;
        }
        .find-bar {
          display: flex;
          align-items: center;
          gap: 0;
          height: 34px;
          box-sizing: border-box;
          padding: 0 0 0 8px;
          flex-shrink: 0;
          background: var(--bg-primary, #1e1e1e);
          border-top: 1px solid var(--border-divider, #2d2d2d);
          font-size: 11px;
          color: var(--text-secondary, #999);
        }
        .find-input {
          flex: 1 1 auto;
          min-width: 0;
          height: 100%;
          margin-right: 8px;
          padding: 0;
          box-sizing: border-box;
          background: transparent;
          border: none;
          border-radius: 0;
          color: var(--text-primary, #ccc);
          font-size: 12px;
          font-family: inherit;
          outline: none;
        }
        /* The app injects a global input:focus-visible { outline: 2px solid
           #4a9eff }. This input sits in a dark strip and gets a distracting
           blue box around it, so suppress it here (higher specificity wins). */
        .find-input:focus,
        .find-input:focus-visible {
          outline: none;
        }
        .find-count {
          flex-shrink: 0;
          margin-right: 8px;
          color: var(--text-secondary, #888);
          font-size: 11px;
        }
        .find-toggle {
          flex-shrink: 0;
          align-self: stretch;
          aspect-ratio: 1 / 1;
          display: grid;
          place-items: center;
          padding: 0;
          cursor: pointer;
          background: transparent;
          border: 1px solid transparent;
          border-left-color: var(--border-divider, #2d2d2d);
          border-radius: 0;
          color: var(--text-muted, #888);
          box-sizing: border-box;
        }
        .find-toggle:hover {
          background: rgba(255, 255, 255, 0.07);
          color: var(--text-primary, #d4d4d4);
        }
        .find-toggle.active {
          background: rgba(255, 255, 255, 0.1);
          color: #4a9eff;
        }
        .find-entry-btn {
          flex-shrink: 0;
          align-self: stretch;
          display: grid;
          place-items: center;
          width: calc(34px + var(--grid-edge-left-pad, 0px));
          padding: 0 0 0 var(--grid-edge-left-pad, 0px);
          cursor: pointer;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary, #999);
          box-sizing: border-box;
        }
        .find-entry-btn:hover {
          background: rgba(255, 255, 255, 0.07);
          color: var(--text-primary, #fff);
        }
        .find-entry-btn.active {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
        }
        .filter-bar-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .filter-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 34px;
          padding: 3px 8px;
          box-sizing: border-box;
          background: var(--bg-primary, #1e1e1e);
          border-top: 1px solid var(--border-divider, #2d2d2d);
          font-size: 11px;
          color: var(--text-secondary, #999);
        }
        .filter-pills {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          flex: 1 1 auto;
          min-width: 0;
        }
        .filter-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1px 3px 1px 8px;
          background: rgba(86, 156, 214, 0.16);
          border-radius: 999px;
          color: #569cd6;
          font-size: 11px;
          line-height: 20px;
          white-space: nowrap;
        }
        .filter-pill-label {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .filter-pill-x {
          display: grid;
          place-items: center;
          width: 16px;
          height: 16px;
          padding: 0;
          border: none;
          border-radius: 50%;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .filter-pill-x:hover {
          background: rgba(255, 255, 255, 0.16);
        }
        .filter-input {
          flex: 1 1 100px;
          min-width: 60px;
          height: 22px;
          padding: 0;
          box-sizing: border-box;
          background: transparent;
          border: none;
          border-radius: 0;
          color: var(--text-primary, #ccc);
          font-size: 12px;
          font-family: inherit;
          outline: none;
        }
        .filter-input:focus,
        .filter-input:focus-visible {
          outline: none;
        }
        .filter-suggest {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          max-height: 180px;
          overflow-y: auto;
          background: var(--bg-primary, #1e1e1e);
          border: 1px solid var(--border-divider, #2d2d2d);
          border-bottom: none;
          box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.35);
          z-index: 10;
        }
        .filter-suggest-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 12px;
          color: var(--text-primary, #ccc);
        }
        .filter-suggest-item:hover,
        .filter-suggest-item.active {
          background: rgba(255, 255, 255, 0.08);
        }
        .filter-suggest-item.selected {
          color: #569cd6;
        }
        .filter-suggest-check {
          color: #569cd6;
          font-size: 11px;
          line-height: 1;
        }
        .filter-suggest-empty {
          padding: 6px 10px;
          font-size: 12px;
          color: var(--text-secondary, #999);
        }
        .filter-entry-btn {
          flex-shrink: 0;
          align-self: stretch;
          display: grid;
          place-items: center;
          width: 34px;
          padding: 0;
          cursor: pointer;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary, #999);
          box-sizing: border-box;
        }
        .filter-entry-btn:hover {
          background: rgba(255, 255, 255, 0.07);
          color: var(--text-primary, #fff);
        }
        .filter-entry-btn.active {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
        }
        mark.find-match {
          background: rgba(234, 140, 0, 0.32);
          color: inherit;
        }
        mark.find-match-active {
          background: rgba(255, 158, 0, 0.6);
          color: #000;
        }
      </style>
      <div class="viewer-root">
        <div
          class="log-list${this._wrap ? "" : " nowrap"}"
          tabindex="0"
          @scroll=${this._onScroll}
          @click=${this._onLogListClick}
        >
          ${offsetTop > 0 ? html`<div class="vspacer" style="height:${offsetTop}px"></div>` : ""}
          ${
            windowItems.length === 0
              ? html`<div class="empty-msg">No log entries</div>`
              : windowItems.map((item) =>
                  item.kind === "boundary"
                    ? html`
                        <div
                          class="day-boundary"
                          data-item-key="${item.key}"
                          title="Load the previous day's logs (the next day is not loaded until you confirm)"
                          @click=${() => this._loadOlder(this._nextDayCursor)}
                        >
                          <span class="day-boundary-label">${this._escapeHtml(item.label)}</span>
                          <span class="day-boundary-hint">click to load</span>
                        </div>
                      `
                    : html`
                        <div
                          class="log-entry level-${levelClass(item.entry.level)}${
                            item.entry === this._revealedEntry ? " revealed" : ""
                          }"
                          data-item-key="${item.key}"
                          .entry=${item.entry}
                        >
                          <span class="log-level-tag"
                            >${this._highlighted(item.entry, "level")}</span
                          >
                          <span class="log-time">${this._highlighted(item.entry, "time")}</span>
                          <span
                            class="log-name"
                            role="button"
                            title="Filter to this stream"
                            @click=${() => this._openFilter(item.entry.source)}
                            >[${this._highlighted(item.entry, "source")}]</span
                          >
                          <span class="log-text"
                            >${this._highlighted(
                              item.entry,
                              "message",
                              this._messageFirstLine(item.entry.message),
                            )}</span
                          >
                        </div>
                      `,
                )
          }
          ${offsetBottom > 0 ? html`<div class="vspacer" style="height:${offsetBottom}px"></div>` : ""}
          ${
            !this._wrap && this._contentWidthPx() > 0
              ? html`<div class="log-width-spacer" style="width:${this._contentWidthPx()}px"></div>`
              : ""
          }
        </div>
        ${
          this._filterOpen || this._searchOpen
            ? html`
                ${
                  this._filterOpen
                    ? html`
                        <div class="filter-bar-wrap" @focusout=${this._onFilterFocusOut}>
                          <div class="filter-bar">
                            <div class="filter-pills">
                              ${this._selectedStreams.map(
                                (stream) => html`
                                  <span class="filter-pill" data-stream=${stream}>
                                    <span class="filter-pill-label">${stream}</span>
                                    <button
                                      type="button"
                                      class="filter-pill-x"
                                      aria-label="Remove ${stream}"
                                      @click=${(e: Event) => {
                                        e.stopPropagation();
                                        this._removeStream(stream);
                                        this._focusFilter();
                                      }}
                                    >
                                      ${unsafeHTML(ICON_CLOSE)}
                                    </button>
                                  </span>
                                `,
                              )}
                              <input
                                class="filter-input"
                                data-testid="log-filter-input"
                                type="text"
                                placeholder="Filter by stream"
                                spellcheck="false"
                                .value=${this._filterQuery}
                                @input=${this._onFilterInput}
                                @keydown=${this._onFilterKeyDown}
                                @focus=${this._openSuggest}
                                @click=${this._openSuggest}
                              />
                            </div>
                          </div>
                          ${
                            this._filterSuggestOpen
                              ? html`
                                  <div class="filter-suggest" data-testid="log-filter-suggest">
                                    ${
                                      this._suggestStreams.length
                                        ? this._suggestStreams.map(
                                            (stream, i) => html`
                                              <div
                                                class="filter-suggest-item${this._isSelected(stream) ? " selected" : ""}${i === this._filterActiveIndex ? " active" : ""}"
                                                data-stream=${stream}
                                                data-filter-suggest-index=${i}
                                                @pointerdown=${(e: PointerEvent) => e.preventDefault()}
                                                @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                                @click=${() => this._toggleStream(stream)}
                                              >
                                                <span class="filter-suggest-label">${stream}</span>
                                                ${this._isSelected(stream) ? html`<span class="filter-suggest-check">✓</span>` : ""}
                                              </div>
                                            `,
                                          )
                                        : html`<div class="filter-suggest-empty">
                                            No streams found
                                          </div>`
                                    }
                                  </div>
                                `
                              : ""
                          }
                        </div>
                      `
                    : ""
                }
                ${
                  this._searchOpen
                    ? html`
                        <div class="find-bar">
                          <input
                            class="find-input"
                            data-testid="log-find-input"
                            type="text"
                            placeholder="Search today's logs"
                            spellcheck="false"
                            .value=${this._searchQuery}
                            @input=${this._onFindInput}
                            @keydown=${this._onFindKeyDown}
                          />
                          ${searchCount ? html`<span class="find-count">${searchCount}</span>` : ""}
                          ${this._findToggle(ICON_PREV, "Previous match", this._searchMatches.length > 0, "log-find-prev", () => void this._nextMatch(-1))}
                          ${this._findToggle(ICON_NEXT, "Next match", this._searchMatches.length > 0, "log-find-next", () => void this._nextMatch(1))}
                          ${this._findToggle(ICON_REGEX, "Regex search", this._searchRegex, "log-find-regex", this._toggleRegex)}
                          ${this._findToggle(ICON_CASE, "Match case", this._searchCase, "log-find-case", this._toggleCase)}
                          ${this._findToggle(ICON_WORD, "Whole word", this._searchWholeWord, "log-find-whole-word", this._toggleWholeWord)}
                        </div>
                      `
                    : ""
                }
              `
            : ""
        }
        <div class="bottom-bar">
          <button
            type="button"
            class="find-entry-btn${this._searchOpen ? " active" : ""}"
            title="Find in logs (⌘F)"
            data-testid="log-find-btn"
            @click=${() => (this._searchOpen ? this._closeSearch() : this._openSearch())}
          >
            ${unsafeHTML(ICON_SEARCH)}
          </button>
          <span class="sep"></span>
          <button
            type="button"
            class="filter-entry-btn${this._filterOpen ? " active" : ""}"
            title="Filter by stream"
            data-testid="log-filter-btn"
            @click=${() => this._toggleFilter()}
          >
            ${unsafeHTML(ICON_FILTER)}
          </button>
          <span class="sep"></span>
          <span class="spacer"></span>
          <span class="sep"></span>
          ${LEVELS.map(
            (lvl) => html`
              <button
                class="level-btn${lvl >= this._minLevel ? " active" : ""}"
                @click=${() => this._setLevel(lvl)}
              >
                ${LOG_LEVEL_LABELS[lvl]}
              </button>
            `,
          )}
          <span class="sep"></span>
          <button
            class="wrap-btn${this._wrap ? " active" : ""}"
            title="Toggle line wrapping"
            @click=${() => this._toggleWrap()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M2 4h12" />
              <path d="M2 8h8" />
              <path d="M2 12h6" />
              <path d="M13 10l2 2-2 2" />
              <path d="M15 12h-5" />
            </svg>
          </button>
        </div>
      </div>
    `;
  }
}

let _registered = false;
export function registerOpenp41geLogViewer(): void {
  if (!_registered) {
    _registered = true;
    customElements.define(Openp41geLogViewer.tagName, Openp41geLogViewer);
  }
}
registerOpenp41geLogViewer();
