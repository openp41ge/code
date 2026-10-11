/**
 * openp41ge-core-editor-gutter — a framework-agnostic, reusable gutter for code
 * editors.
 *
 * The host (`Gutter`) owns everything that is general about a gutter:
 *   - a strip of fixed-width columns pinned left of the text (sticky),
 *   - per-row geometry (top/height) and cache-aware cell updates,
 *   - a single shared hovered-row model with an optional unified highlight box,
 *   - click / drag row selection across the "mousey" cells.
 *
 * Each column (`GutterColumn`) owns only its per-row cell content. Built-in
 * columns live in `src/columns` (line numbers, fold chevrons, …).
 */

/** A row in the gutter. `top`/`height` are document offsets within the
 * scrollable content (scroll-invariant), so cells scroll natively. */
export interface GutterRow {
  /** Stable key for the row (e.g. the 1-based model line number). */
  key: number;
  /** Vertical offset (px) of the row's top from the top of the content. */
  top: number;
  /** Height (px) of the row. */
  height: number;
}

/** Context passed to a column every time it updates a cell. */
export interface GutterCellCtx {
  /** Whether this row is the hovered row (shared across all columns). */
  hovered: boolean;
  /** Whether this row is the active/cursor row. */
  active: boolean;
  /** Editor-provided per-row data (line text, fold info, error flag, …). */
  data: unknown;
}

/**
 * A single vertical column of the gutter. Columns are presentation-agnostic:
 * each owns only its cell content and how it reacts to clicks.
 */
export interface GutterColumn {
  /** Unique id (becomes `.eg-col--{id}`). */
  readonly id: string;
  /** Current width in px. May change over time; the host reflows. */
  width(): number;
  /** Column background override; the host default is used when null. */
  background?(): string | null;
  /** Extra class name on the column wrapper. */
  className?(): string;
  /**
   * Whether the column is currently shown. When false the column wrapper is
   * hidden (`display:none`) but keeps its place in the column list (so the
   * host re-shows it on reflow). Used e.g. by the editor's diff "before"
   * column, which only appears when a diff is attached.
   */
  visible?(): boolean;
  /**
   * Whether this column's cell participates in the row-level highlight and
   * the click/drag selection for `row`. A foldable row's chevron cell returns
   * false (its button owns hover/click), so the unified box stays on the
   * line-number column; an empty fold cell returns true, so the box spans it.
   */
  highlightable?(row: GutterRow, data: unknown): boolean;
  /** Create one fresh cell element for a row. */
  create(): HTMLElement;
  /** Update an existing cell for a row; must cheaply diff to avoid churn. */
  update(cell: HTMLElement, row: GutterRow, ctx: GutterCellCtx): void;
  /** Cell click; return true to consume it (fold toggle, breakpoint, …). */
  onClick?(row: GutterRow, data: unknown): boolean | void;
}

/** Events emitted by the host, wired by the editor. */
export interface GutterEvents {
  /** A row's highlightable cell was clicked (select that line). */
  onRowClick?(row: GutterRow): void;
  /** A highlightable-cell drag selected the range [anchor, row] (inclusive). */
  onRowSelectRange?(anchor: GutterRow, row: GutterRow): void;
  /** The pointer entered/left a gutter cell (row hover changed). */
  onHoverChange?(key: number | null): void;
}

/** Options for constructing a `Gutter` host. */
export interface GutterHostOptions {
  /** Default column background (used when a column has no override). */
  background?: string;
  /** Events wired by the editor (line selection, hover, …). */
  events?: GutterEvents;
  /**
   * Whether the host paints the unified hover highlight box (the JSON editor's
   * long box spanning the highlightable columns). Default true. Editors that
   * highlight each cell individually (the file editor) set this false.
   */
  hoverBox?: boolean;
}

interface ColumnState {
  column: GutterColumn;
  root: HTMLElement;
  cells: Map<number, HTMLElement>;
}

/** A band cell with its cached geometry, so scrolling a stable band writes
 * no styles (top/height are scroll-invariant). */
type CachedCell = HTMLElement & { __top?: number; __height?: number };

const DRAG_THRESHOLD_PX = 3;

export class Gutter {
  /** `.eg-gutter` host element, mounted by the editor inside its scrollable
   * content. Sticky-left; columns are its flex children. */
  readonly root: HTMLElement;

  private _columns: ColumnState[] = [];
  private _rows: GutterRow[] = [];
  private _hoverKey: number | null = null;
  private _activeKey: number | null = null;
  private _background: string | undefined;
  private _events: GutterEvents;
  private _hoverBox: boolean;
  private _disposeDoc: (() => void) | null = null;
  /** The hovered row + box geometry, used to re-derive the portalled box's
   *  viewport position each frame so it tracks the gutter's scroll. */
  private _hoverBoxState: { row: GutterRow; width: number; topOverlap: number } | null = null;

  // Drag state (click / drag row selection).
  private _anchor: GutterRow | null = null;
  private _dragging = false;
  private _dragMoved = false;
  private _dragStartX = 0;
  private _dragStartY = 0;

  constructor(opts: GutterHostOptions = {}) {
    this._background = opts.background;
    this._events = opts.events ?? {};
    this._hoverBox = opts.hoverBox ?? true;
    this.root = document.createElement("div");
    this.root.className = "eg-gutter";
    // The host is a horizontal row of columns. Editors may override via CSS
    // (e.g. the JSON editor makes it sticky-left); these inline defaults are
    // the generic layout the host needs to lay its columns out side by side.
    this.root.style.display = "flex";
    this.root.style.flexDirection = "row";
    this.root.addEventListener("mouseover", this._onMouseOver);
    this.root.addEventListener("mouseout", this._onMouseOut);
  }

  // ── Columns ──────────────────────────────────────────────────────────────

  setColumns(columns: GutterColumn[]): void {
    for (const state of this._columns) {
      state.root.remove();
    }
    this._columns = [];
    for (const column of columns) {
      const root = document.createElement("div");
      root.className =
        "eg-col" + (column.className ? " " + column.className() : "") + " eg-col--" + column.id;
      const bg = column.background?.() ?? this._background;
      root.style.width = column.width() + "px";
      root.style.background = bg ?? "";
      root.style.display = column.visible?.() === false ? "none" : "";
      // Cells are absolutely positioned within each column; the column must
      // be its containing block, and it must not shrink/grow in the flex row.
      root.style.position = "relative";
      root.style.flexShrink = "0";
      this._columns.push({ column, root, cells: new Map() });
      this.root.appendChild(root);
    }
    this._syncHoverBox(false);
  }

  /** Update the width/background/visibility of every column (call when they change). */
  reflow(): void {
    for (const state of this._columns) {
      state.root.style.width = state.column.width() + "px";
      const bg = state.column.background?.() ?? this._background;
      state.root.style.background = bg ?? "";
      state.root.style.display = state.column.visible?.() === false ? "none" : "";
      state.root.style.position = "relative";
      state.root.style.flexShrink = "0";
    }
    this._syncHoverBox(false);
  }

  // ── Rows ─────────────────────────────────────────────────────────────────

  /** Replace the row set. Cells are created/updated for visible rows and
   * pruned for rows that no longer exist. Columns diff cheaply via `update`. */
  setRows(rows: GutterRow[], dataFor?: (key: number) => unknown): void {
    this._rows = rows;
    this._dataFor = dataFor;
    const seen = new Set<number>();
    for (const state of this._columns) {
      const cells = state.cells;
      for (const row of rows) {
        seen.add(row.key);
        let cell = cells.get(row.key) as CachedCell | undefined;
        const data = dataFor?.(row.key);
        if (!cell) {
          cell = state.column.create() as CachedCell;
          cell.className = "eg-cell" + (cell.className ? " " + cell.className : "");
          // Absolute positioning inside `.eg-col`.
          cell.style.position = "absolute";
          cell.style.left = "0";
          cell.style.right = "0";
          cell.style.top = row.top + "px";
          cell.style.height = row.height + "px";
          cell.addEventListener("mousedown", (e) => this._onCellMousedown(state, row, e));
          cell.dataset.key = String(row.key);
          cells.set(row.key, cell);
          state.root.appendChild(cell);
        } else {
          // Reused cell: geometry handled below (only rewritten on change).
        }
        if (cell.__top !== row.top) {
          cell.style.top = row.top + "px";
          cell.__top = row.top;
        }
        if (cell.__height !== row.height) {
          cell.style.height = row.height + "px";
          cell.__height = row.height;
        }
        state.column.update(cell, row, this._ctxFor(row, data));
      }
      // Prune cells that no longer have a row.
      for (const key of Array.from(cells.keys())) {
        if (!seen.has(key)) {
          const cell = cells.get(key)!;
          cell.remove();
          cells.delete(key);
        }
      }
    }
    this._syncHoverBox(false);
  }

  // ── Hover / active ───────────────────────────────────────────────────────

  /** Set the hovered row (null to clear). Broadcast to all cells and paints
   * the unified highlight box. Editor-driven; does not emit `onHoverChange`. */
  setHoverRow(key: number | null): void {
    this._applyHover(key);
  }

  setActiveRow(key: number | null): void {
    if (key === this._activeKey) return;
    this._activeKey = key;
    this._applyHoverToCells();
  }

  /**
   * Force a full repaint of every cell with fresh `data`. Call when row data
   * that is not reflected in `setRows`/`setActiveRow`/`setHoverRow` changed
   * (e.g. relative line-number mode, where every label depends on the cursor).
   */
  refresh(): void {
    this._applyHoverToCells();
  }

  // ── Geometry helpers ─────────────────────────────────────────────────────

  /** The row whose [top, top+height) contains the given client-space Y
   * coordinate, or null. Used to track drags. */
  rowAtClientY(clientY: number): GutterRow | null {
    const rect = this.root.getBoundingClientRect();
    const offset = clientY - rect.top;
    for (const row of this._rows) {
      if (offset >= row.top && offset < row.top + row.height) return row;
    }
    return null;
  }

  dispose(): void {
    this._detachDoc();
    this._untrackHoverBox();
    this._hoverBoxState = null;
    this._columns = [];
    this._rows = [];
    this.root.remove();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _ctxFor(row: GutterRow, data?: unknown): GutterCellCtx {
    return {
      hovered: row.key === this._hoverKey,
      active: row.key === this._activeKey,
      data,
    };
  }

  private _applyHover(key: number | null): void {
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    this._applyHoverToCells();
    this._syncHoverBox(true);
  }

  /** Delegate `mouseover` to the cell under the pointer → row hover. */
  private _onMouseOver = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    // A fold chevron button owns its hover: never light the row's other cells
    // (the collapse icon keeps its own background hover).
    const chevron = (target && target.closest?.(".eg-fold-chevron")) as HTMLElement | null;
    if (chevron) {
      if (this._hoverKey !== null) this._applyHover(null);
      return;
    }
    const cell = (target && target.closest?.(".eg-cell")) as HTMLElement | null;
    if (!cell || !cell.dataset.key) return;
    const key = Number(cell.dataset.key);
    const state = this._columns.find((c) => c.root.contains(cell));
    const row = this._rows.find((r) => r.key === key);
    if (!state || !row) return;
    // Interactive cells that own their own hover (e.g. a fold chevron) must
    // not light the row's other cells — clear any row highlight so hovering
    // the chevron never lights the line-number cell next to it.
    if (!this._columnHighlightable(state, row)) {
      if (this._hoverKey !== null) this._applyHover(null);
      return;
    }
    if (key !== this._hoverKey) {
      this._applyHover(key);
      this._events.onHoverChange?.(key);
    }
  };

  /** Clear the hover when the pointer leaves the gutter entirely. */
  private _onMouseOut = (event: MouseEvent): void => {
    const related = event.relatedTarget as Node | null;
    if (related && this.root.contains(related)) return;
    if (this._hoverKey !== null) {
      this._applyHover(null);
      this._events.onHoverChange?.(null);
    }
  };

  private _applyHoverToCells(): void {
    for (const state of this._columns) {
      for (const row of this._rows) {
        const cell = state.cells.get(row.key);
        if (!cell) continue;
        cell.classList.toggle("eg-cell--hover", row.key === this._hoverKey);
        cell.classList.toggle("eg-cell--active", row.key === this._activeKey);
        const data = this._dataFor?.(row.key);
        state.column.update(cell, row, this._ctxFor(row, data));
      }
    }
  }

  private _dataFor?: (key: number) => unknown;

  /** Paint (or clear) the unified highlight box across the highlightable
   * columns for the hovered row. */
  private _syncHoverBox(force: boolean): void {
    if (!this._hoverBox) return;
    let box = this.root.querySelector<HTMLElement>(".eg-hoverbox");
    if (this._hoverKey === null) {
      if (box && (force || box.style.display !== "none")) box.style.display = "none";
      return;
    }
    const row = this._rows.find((r) => r.key === this._hoverKey);
    if (!row) {
      if (box) box.style.display = "none";
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.className = "eg-hoverbox";
      box.style.display = "none";
      // Made position:fixed (kept inside the gutter root so the .eg-hoverbox
      // styles and the inheritable --eg-hover-* custom props still apply).
      // Fixed positioning removes it from the editor host's overflow clip, so
      // its inset ring can overlap the 1px boundary lines (the settings
      // drawer's border-left / head border-bottom, the file editor's content
      // divider) without being clipped. Because it is fixed, it tracks the
      // gutter's viewport position per frame.
      box.style.position = "fixed";
      this.root.appendChild(box);
      this._trackHoverBox(box);
    }
    // Find the rightmost highlightable, VISIBLE column; the box spans all
    // visible columns from the left edge through it (matching the JSON
    // editor's unified long box). Hidden columns (e.g. a fold column that is
    // collapsed away for non-code files) occupy no layout space, so they must
    // be excluded from both the scan and the width sum.
    let lastHighlightable = -1;
    this._columns.forEach((state, index) => {
      if (state.column.visible?.() === false) return;
      if (this._columnHighlightable(state, row)) lastHighlightable = index;
    });
    if (lastHighlightable < 0) {
      if (box) box.style.display = "none";
      return;
    }
    let width = 0;
    for (let i = 0; i <= lastHighlightable; i++) {
      if (this._columns[i].column.visible?.() === false) continue;
      width += this._columns[i].column.width();
    }
    box.style.display = "";
    // The gutter sits at its container's CONTENT edge, just right of a 1px
    // boundary line (the settings drawer's border-left, the file editor's
    // content divider), and the first row sits just below the editor's top
    // boundary line (the drawer head's bottom border). The box's inset ring
    // would otherwise sit 1px right/below those lines and the two read as a
    // double border. Position the fixed box at viewport coordinates, starting
    // 1px left of the gutter (and, on the first row, 1px up), extending the
    // width/height by the same 1px so the far edges stay aligned — the box's
    // ring then paints ON each boundary line as a single bright line instead
    // of a dim boundary + a bright ring.
    const gr = this.root.getBoundingClientRect();
    const topOverlap = row.top === 0 ? 1 : 0;
    box.style.left = `${gr.left - 1}px`;
    box.style.top = `${gr.top + row.top - topOverlap}px`;
    box.style.width = `${width + 1}px`;
    box.style.height = `${row.height + topOverlap}px`;
    this._hoverBoxState = { row, width, topOverlap };
  }

  private _columnHighlightable(state: ColumnState, row: GutterRow): boolean {
    const fn = state.column.highlightable;
    return fn ? fn(row, this._dataFor?.(row.key)) : true;
  }

  /** Track the (fixed-position) hover box each frame so it follows the gutter
   *  as it scrolls. The box is fixed so its inset ring can overlap the 1px
   *  boundary lines at the editor's content edge without being clipped. */
  private _hoverBoxRaf = 0;

  private _trackHoverBox(box: HTMLElement): void {
    if (this._hoverBoxRaf) return;
    const loop = (): void => {
      const s = this._hoverBoxState;
      if (box.isConnected && s) {
        const gr = this.root.getBoundingClientRect();
        box.style.left = `${gr.left - 1}px`;
        box.style.top = `${gr.top + s.row.top - s.topOverlap}px`;
        box.style.width = `${s.width + 1}px`;
        box.style.height = `${s.row.height + s.topOverlap}px`;
      }
      this._hoverBoxRaf = requestAnimationFrame(loop);
    };
    this._hoverBoxRaf = requestAnimationFrame(loop);
  }

  private _untrackHoverBox(): void {
    if (this._hoverBoxRaf) {
      cancelAnimationFrame(this._hoverBoxRaf);
      this._hoverBoxRaf = 0;
    }
  }

  private _onCellMousedown(state: ColumnState, row: GutterRow, event: MouseEvent): void {
    if (event.button !== 0) return;
    // Only highlightable cells drive line selection; chevron/breakpoint cells
    // consume their own clicks.
    if (!this._columnHighlightable(state, row)) return;
    event.preventDefault();
    event.stopPropagation();

    this._anchor = row;
    this._dragStartX = event.clientX;
    this._dragStartY = event.clientY;
    this._dragMoved = false;
    this._dragging = true;
    this._events.onRowClick?.(row);

    // Attach document listeners to track the drag (the mouse may leave the
    // gutter).
    this._detachDoc();
    const move = (e: MouseEvent) => this._onDocMove(e);
    const up = () => this._onDocUp();
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    this._disposeDoc = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }

  private _onDocMove(event: MouseEvent): void {
    if (!this._dragging || !this._anchor) return;
    const dx = Math.abs(event.clientX - this._dragStartX);
    const dy = Math.abs(event.clientY - this._dragStartY);
    if (!this._dragMoved && dx + dy < DRAG_THRESHOLD_PX) return;
    if ((event.buttons & 1) !== 1) {
      this._endDrag();
      return;
    }
    this._dragMoved = true;
    const row = this.rowAtClientY(event.clientY);
    if (row && row.key !== this._anchor.key) {
      this._events.onRowSelectRange?.(this._anchor, row);
    }
  }

  private _onDocUp(): void {
    this._endDrag();
  }

  private _endDrag(): void {
    this._dragging = false;
    this._dragMoved = false;
    this._anchor = null;
    this._detachDoc();
  }

  private _detachDoc(): void {
    if (this._disposeDoc) {
      this._disposeDoc();
      this._disposeDoc = null;
    }
  }
}
