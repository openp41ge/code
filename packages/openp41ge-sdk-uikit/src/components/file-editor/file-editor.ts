/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, no-console */
/**
 * FileEditorElement — the <file-editor> web component.
 *
 * LitElement facade with custom rendering pipeline.
 * See AGENTS.md for architecture details.
 */

import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OverlayScrollbar } from "openp41ge-core-scrollbar";

import {
  EVENT_TITLE_CHANGED,
  EVENT_DIRTY_CHANGED,
  EVENT_FILE_SAVED,
} from "openp41ge-core-editor-engine/events";
import type {
  TitleChangedDetail,
  DirtyChangedDetail,
  FileSavedDetail,
} from "openp41ge-core-editor-engine/events";

import type { PieceTreeTextContentModel } from "openp41ge-core-editor-engine/model/piece-tree-text-content-model";
import type { TextContentChangeEvent, TextSelection } from "openp41ge-core-editor-engine/model";
import { ViewModel } from "openp41ge-core-editor-engine/model/view-model";
import { saveCleanupEdits, type SaveCleanupOptions } from "./save-cleanup";
import type { ViewModelEvent } from "openp41ge-core-editor-engine/model/view-model";
import { ViewLines } from "openp41ge-core-editor-engine/view/view-lines";
import { computeWrapSegments } from "openp41ge-core-editor-engine/view/word-wrap-helper";
import { ViewportWrapColumnCalculator } from "openp41ge-core-editor-engine/view/wrap-column-calculator";
import type { IWrapColumnCalculator } from "openp41ge-core-editor-engine/view/wrap-column-calculator";
import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";
import { ScrollManager } from "openp41ge-core-editor-engine/view/scroll-manager";
import { CursorController } from "openp41ge-core-editor-engine/cursor/cursor-controller";
import { TextAreaInput } from "openp41ge-core-editor-engine/input/text-area-input";
import { KeyboardHandler } from "openp41ge-core-editor-engine/input/keyboard-handler";
import { CursorRenderer } from "openp41ge-core-editor-engine/rendering/cursor-renderer";
import { SelectionRenderer } from "openp41ge-core-editor-engine/rendering/selection-renderer";
import { FindMatchRenderer, toFindViewSpans } from "openp41ge-core-editor-engine/rendering";
import type { IFindViewConverter } from "openp41ge-core-editor-engine/rendering";
import { FindInEditor } from "openp41ge-core-editor-engine/input";
import type { FindMatch } from "openp41ge-core-editor-engine/input";
import {
  Gutter,
  type GutterRow,
  foldColumn,
  type FoldData,
  GUTTER_DEFAULT_CSS,
} from "openp41ge-core-editor-gutter";
import { CurrentLineHighlight } from "openp41ge-core-editor-engine/rendering/current-line-highlight";
import { IndentationGuides } from "openp41ge-core-editor-engine/rendering/indentation-guides";
import { findMatchingBracket } from "openp41ge-core-editor-engine/rendering/bracket-matching";
import { BracketPairService } from "openp41ge-core-editor-engine/rendering/bracket-pair-service";
import type { BracketLineInput } from "openp41ge-core-editor-engine/rendering/bracket-pair-service";
import { initTextMate } from "openp41ge-core-syntax-highlighting/textmate-init";
import { TokenRegistry } from "openp41ge-core-syntax-highlighting/token-registry";

// ── Global TokenRegistry singleton ──
// Declared at module top level to avoid temporal dead zone (TDZ) issues
// when the class references it during connectedCallback / firstUpdated.
let _tokenRegistryInstance: TokenRegistry | null = null;
import {
  getThemeById,
  generateThemeCSS,
  generateGlobalEditorCSS,
} from "openp41ge-core-editor-engine/themes";
import type { SyntaxTheme } from "openp41ge-core-editor-engine/themes";
import { InlineDiffHighlightsRenderer, type InlineDiffRow } from "./inline-diff-highlights";
import {
  makeFeNumberColumn,
  makeFeDiffBeforeColumn,
  type FeGutterRowData,
} from "./fe-gutter-columns";
import { computeFoldRegions, type FoldRegion } from "./fe-fold";
import { ClipboardHandler } from "openp41ge-core-editor-engine/input/clipboard-handler";
import { CompositionHandler } from "openp41ge-core-editor-engine/input/composition-handler";
import { MouseHandler } from "openp41ge-core-editor-engine/input/mouse-handler";
import {
  checkAutoClose,
  shouldSkipClose,
} from "openp41ge-core-editor-engine/input/auto-closing-pairs";
import "./openp41ge-bottom-bar";
import type { FeStatusBar } from "./openp41ge-bottom-bar";
import { LineWidthTracker } from "./line-width-tracker";
import type { ILineWidthTracker } from "./line-width-tracker";
import { VersionBasedDirtyTracker } from "./dirty-state-tracker";
import type { IDirtyStateTracker } from "./dirty-state-tracker";
import type { IFormatterRegistry } from "openp41ge-core-editor-engine/interfaces/formatter-registry";

export type FileEditorState = "loading" | "ready" | "error" | "empty" | "too-large";

// Width of the floating vertical OverlayScrollbar track (also its hover size).
const VERTICAL_SCROLLBAR_WIDTH = 10;
// Height of the custom horizontal .fe-hscroll bar. While the bar can appear the
// content gets this much bottom padding, so the bottom-most line never sits
// under the bar when the user scrolls to the end of the file.
const HSCROLL_HEIGHT = 10;
// Delay before the custom horizontal bar fades out after the cursor leaves.
const HSCROLL_AUTO_HIDE_DELAY = 2500;

@customElement("file-editor")
export class FileEditorElement extends LitElement {
  // ── Lit-reactive properties ──

  @property({ type: String, attribute: "data-file-path" })
  filePath: string = "";

  @property({ type: String, attribute: "data-file-name" })
  fileName: string = "";

  @state()
  private _isDirty: boolean = false;

  @state()
  private _state: FileEditorState = "empty";

  /** Display info for the "file is too large to open" message pane. */
  private _tooLargeInfo: { fileName: string; sizeBytes: number; limitBytes: number } | null = null;

  /**
   * True when the most recent render drew at least one visible line with no
   * cached tokens (plain text). The rAF catch-up tokenizes the visible range
   * and re-renders, then clears this flag.
   */
  private _renderHadUncachedTokens = false;

  /** rAF handle for the async tokenize-then-highlight pass (debounced). */
  private _tokenizeFrame: number | null = null;

  /**
   * True while this editor's tab is inactive (hidden behind another tab in
   * its cell). Suspended editors skip all re-render work — see setActive().
   */
  private _paused: boolean = false;

  /**
   * True when the model content changed while the editor was paused. Resume
   * refreshes the visible window (and the exact scrollbar width, which is not
   * tracked while hidden) only when this is set.
   */
  private _pausedContentChanged: boolean = false;

  /**
   * Content-width tracker (injectable, SOLID DIP). The scrollbar is exact from
   * the start: measured synchronously on load, re-measured only on edited
   * lines. Tests may swap in a spy-wrapped instance before the editor loads.
   */
  _lineWidthTracker: ILineWidthTracker = new LineWidthTracker((line) =>
    this._measureLineColumns(line),
  );

  /**
   * Dirty-state tracker (injectable, SOLID DIP). O(1) version comparison
   * instead of the old `_savedContent` full-string compare on every keystroke.
   */
  _dirtyTracker: IDirtyStateTracker = new VersionBasedDirtyTracker();
  private _statusBar: FeStatusBar | null = null;
  /** setStatusInfo text set before the status bar existed (applied in
   * firstUpdated). undefined = never set, so we don't clobber a default. */
  private _pendingStatusInfo: string | null | undefined = undefined;
  private _viewportResizeObserver: ResizeObserver | null = null;

  // ── Injected dependencies ──

  textContentModel: PieceTreeTextContentModel | null = null;
  tokenRegistry: TokenRegistry | null = null;

  /** Formatter registry for format-on-demand. */
  formatterRegistry: IFormatterRegistry | null = null;

  /** Bracket pair colorization service — injectable for testing. */
  _bracketPairService: BracketPairService = new BracketPairService();

  /** Cached bracket depth map for the current visible range. */
  private _bracketDepths: Map<string, number> | null = null;
  private _bracketRangeStart: number = 0;
  private _bracketRangeEnd: number = 0;

  /**
   * Exposed for tests to query cursor position and selection state.
   */
  get cursorController(): CursorController | null {
    return this._cursorController;
  }

  // ── Custom pipeline (not managed by Lit) ──

  private _viewModel: ViewModel | null = null;
  private _viewLines: ViewLines | null = null;
  private _scrollManager: ScrollManager | null = null;
  private _cursorController: CursorController | null = null;
  private _textAreaInput: TextAreaInput | null = null;
  private _keyboardHandler: KeyboardHandler | null = null;
  private _cursorRenderer: CursorRenderer | null = null;
  private _selectionRenderer: SelectionRenderer | null = null;
  private _findRenderer: FindMatchRenderer | null = null;

  // In-editor find state (Cmd/Ctrl+F) — the built-in search.
  private _findOpen = false;
  private _findQuery = "";
  private _findRegex = false;
  private _findCase = false;
  private _findWholeWord = false;
  private _findMatches: FindMatch[] = [];
  private _findActiveIndex = -1;
  /** Externally provided highlight source (e.g. the Git sidebar's query). */
  private _externalHighlight: {
    query: string;
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
  } | null = null;
  private _gutter: Gutter | null = null;
  private _currentLineHighlight: CurrentLineHighlight | null = null;
  private _indentationGuides: IndentationGuides | null = null;
  private _clipboardHandler: ClipboardHandler | null = null;
  private _compositionHandler: CompositionHandler | null = null;
  private _mouseHandler: MouseHandler | null = null;

  /**
   * When true, _scrollToRevealCursor is a no-op.
   * Set before Cmd+A to prevent viewport from scrolling to the last line
   * during select-all. Cleared after each scroll check.
   */
  private _suppressScroll: boolean = false;

  private _viewportEl!: HTMLElement;
  /** AFTER (normal) gutter column width, in px. */
  private _gutterRightWidth = 48;
  /** BEFORE (inline-diff) gutter column width, in px (0 when hidden). */
  private _gutterLeftWidth = 0;

  // ── Folding (indentation-based) state ──
  /** Whether this file is foldable (has a recognized code grammar). */
  private _foldEnabled = false;
  /** All indentation-based fold regions for the current buffer. */
  private _foldRegions: FoldRegion[] = [];
  /** Fold-header lines currently collapsed (their bodies are hidden). */
  private _collapsedHeaders = new Set<number>();
  /** Model lines hidden by collapsed folds (derived, fed to ViewLines). */
  private _hiddenLines = new Set<number>();
  /** rAF handle for the debounced fold recompute after content edits. */
  private _foldRecomputeFrame: number | null = null;
  /** Native-scroll flex row inside the viewport: [BEFORE] [AFTER] [text]. */
  private _scrollContentEl!: HTMLElement;
  /** Sticky-left group holding both number columns (horizontal pinning). */
  private _gutterGroupEl!: HTMLElement;
  private _textRegionEl!: HTMLElement;

  private _textMateInitPromise: Promise<void> | null = null;
  private _initDone: boolean = false;
  private _verticalScrollbar: OverlayScrollbar | null = null;
  private _charWidth: number = 0;
  private _lineHeight: number = 20;
  private _fontSize: number = 14;
  /** Document-relative word wrap is PER-FILE: a saved override for the open
   * path wins, otherwise this editor's default (Editor-settings) applies. */
  private _wordWrapEnabled: boolean = false;
  /** Default wrap for files with no per-file preference (Editor settings). */
  private _wordWrapDefault: boolean = false;
  private _wrapCalculator: IWrapColumnCalculator = new ViewportWrapColumnCalculator();
  // @ts-expect-error unused
  private _mouseDownLine = 0;
  // @ts-expect-error unused
  private _mouseDownCol = 0;
  private _isMouseDown: boolean = false;

  /** Whether this editor's textarea is focused — only a focused editor shows carets. */
  private _isFocused: boolean = false;
  private _onDocumentMouseMove: ((e: MouseEvent) => void) | null = null;
  private _onDocumentMouseUp: (() => void) | null = null;

  /** Current syntax theme ID. */
  @property({ type: String, attribute: "data-theme-id" })
  themeId: string = "openp41ge-dark";

  /** Whether this editor is in read-only mode (no edits, no caret). */
  private _readOnly: boolean = false;
  /** What a save tidies first (`setSaveCleanup`). */
  private _saveCleanup: SaveCleanupOptions = {
    trimTrailingWhitespace: false,
    insertFinalNewline: false,
  };

  /** Whether this editor is in read-only mode. */
  get isReadOnly(): boolean {
    return this._readOnly;
  }

  /**
   * Enable/disable read-only mode. Read-only editors accept no edits (typing,
   * paste, cut, delete, new-line, Tab, undo/redo all no-op), never show a
   * caret, and make save()/formatDocument() inert — but mouse selection and
   * copy still work. Used e.g. for the git commit-message viewer pane.
   */
  setReadOnly(readOnly: boolean): void {
    if (this._readOnly === readOnly) return;
    this._readOnly = readOnly;
    if (readOnly) {
      // Hide the caret immediately if the textarea happens to be focused.
      this._cursorRenderer?.hide();
    }
    this.requestUpdate();
  }

  /** Right-aligned info text in the bottom bar (e.g. the short commit ID of
   * the commit-file diff). Pass ""/null to clear it. Value is held until the
   * status bar exists (firstUpdated), so callers may set it before connect. */
  setStatusInfo(text: string | null): void {
    this._pendingStatusInfo = text ?? "";
    this._statusBar?.setInfo(this._pendingStatusInfo);
  }

  // ── Inline commit-diff decorations (real buffer + colored rows) ──
  //
  // An inline diff is a NORMAL loaded buffer — the file at the commit with its
  // removed lines spliced back in — PLUS per-row decorations:
  //   - added rows   → green full-width background,
  //   - removed rows → the re-injected deleted lines, red background, and the
  //                    gutter blanks their number,
  //   - context rows → unchanged.
  // Because it is a real buffer, the file keeps full syntax highlighting, real
  // line numbers (the gutter is overridden to the file's true numbers) and
  // normal scroll/find/selection — there are NO @@ section headers.

  /** Per-buffer-row decorations, or null when showing a plain buffer. */
  private _inlineRows: readonly InlineDiffRow[] | null = null;
  /** Paints the red/green row bands inside the viewport. */
  private _inlineHighlights: InlineDiffHighlightsRenderer | null = null;
  /** Model lines covered by the current selection(s) — their NUMBER CELLs
   * (BEFORE and AFTER) get the grey active background. Includes the plain
   * cursor line (single empty selection). */
  private _selectedDiffLines: ReadonlySet<number> = new Set();

  /** Custom horizontal scrollbar confined to the CONTENT area. */
  private _hScrollTrack: HTMLElement | null = null;
  private _hScrollThumb: HTMLElement | null = null;
  // Auto-hide (fade) state for the custom horizontal scrollbar. Matches the
  // vertical OverlayScrollbar's autoHide so both bars fade together after the
  // cursor leaves the editor content area.
  private _hScrollHideTimer = 0;
  private _hScrollPointerInside = false;
  private _onContentPointerEnter: () => void = () => {};
  private _onContentPointerLeave: () => void = () => {};

  /** True while the editor is showing an inline commit diff. */
  get hasInlineDiff(): boolean {
    return this._inlineRows !== null;
  }

  /**
   * Decorate the currently-loaded buffer as an inline commit diff. Pass null to
   * clear the decorations. `rows` must have exactly one entry per buffer line.
   * Safe to call after loadFile/paint — the gutter labels and row tints refresh.
   */
  setInlineDiff(rows: readonly InlineDiffRow[] | null): void {
    this._inlineRows = rows ? [...rows] : null;
    if (
      this._viewModel &&
      this._inlineRows &&
      this._viewModel.lineCount !== this._inlineRows.length
    ) {
      // The buffer was replaced meanwhile — decorations no longer align.
      this._inlineRows = null;
    }
    if (!this._inlineRows) {
      // Leaving diff mode: drop the active-cell highlight in both columns.
      this._selectedDiffLines = new Set();
    }

    // Two line-number columns only (BEFORE left / AFTER middle); the +/− sign
    // column is gone — the number CELLS carry the colour instead (red BEFORE
    // cell on deleted rows, green AFTER cell on added rows).
    // The AFTER (middle/rightmost) column is sized by the file's total line
    // count, exactly like the plain editor gutter. The BEFORE (left) column is
    // hidden entirely when there is no diff.
    this._applyGutterWidths();

    // Re-paint both number columns with the file's real numbers (left = old
    // before, middle = new after) and their coloured cells.
    if (this._viewLines && this._viewModel) {
      const start = this._viewLines.startLineNumber || 1;
      const end = this._viewLines.endLineNumber || Math.min(100, this._viewModel.lineCount);
      this._syncGutterBand(start, end);
    }
    this._updateInlineHighlights();
    this._updateHScroll();
  }

  // ── Shared gutter host (openp41ge-core-editor-gutter) ────────────────────────

  /**
   * Size the two gutter columns for the current buffer + diff state and reflow
   * the shared `Gutter` host. The AFTER column follows the file's line count;
   * in a diff view BOTH columns take the widest number that can appear on
   * either side (so their right-aligned place values line up).
   */
  private _applyGutterWidths(): void {
    if (!this._viewModel) {
      this._gutterRightWidth = 48;
      this._gutterLeftWidth = 0;
    } else if (this._inlineRows) {
      const charW = this._charWidth > 0 ? this._charWidth : 8;
      let maxOld = 0;
      let maxNew = 0;
      for (const row of this._inlineRows) {
        // BEFORE (left) is full except gaps where a line has no old side (an
        // addition); AFTER (middle) is full except gaps where a line has no
        // new side (a deletion).
        if (row.kind !== "added" && row.oldLine != null) {
          maxOld = Math.max(maxOld, String(row.oldLine).length);
        }
        if (row.kind !== "removed" && row.newLine != null) {
          maxNew = Math.max(maxNew, String(row.newLine).length);
        }
      }
      const sharedWidth = Math.max(32, Math.ceil(Math.max(maxOld, maxNew) * charW) + 16);
      this._gutterRightWidth = sharedWidth;
      this._gutterLeftWidth = sharedWidth;
    } else {
      this._gutterRightWidth = this._computeGutterWidth(this._viewModel.lineCount);
      this._gutterLeftWidth = 0;
    }
    this._gutter?.reflow();
  }

  /** Build the band's gutter rows (top/height account for word wrap and fold). */
  private _gutterRows(start: number, end: number): GutterRow[] {
    const lh = this._lineHeight;
    const wg = this._inlineWrapGetters();
    const max = Math.max(1, this._viewModel?.lineCount ?? end);
    const rows: GutterRow[] = [];
    for (let ln = start; ln <= Math.min(end, max); ln++) {
      // Folded (hidden) lines don't appear in the gutter band.
      if (this.isLineFolded(ln)) continue;
      const vStart = wg.getViewLineStart(ln);
      const vCount = wg.getViewLineCount(ln);
      rows.push({ key: ln, top: (vStart - 1) * lh, height: vCount * lh });
    }
    return rows;
  }

  /** Per-model-line data both gutter columns render from. */
  private _gutterDataFor(line: number): FeGutterRowData & FoldData {
    const row = this._inlineRows ? this._inlineRows[line - 1] : undefined;
    let afterLabel = String(line);
    if (this._inlineRows && row) {
      // AFTER (middle) — the new file number. Full on context + added rows; a
      // GAP where the line has no new side (a deletion).
      afterLabel = row.kind !== "removed" && row.newLine != null ? String(row.newLine) : "";
    }
    const afterParts: string[] = [];
    if (row?.kind === "added") afterParts.push("fe-inline-added-cell");
    if (row?.kind === "removed") afterParts.push("fe-inline-removed-cell");
    // Selected rows (cursor line or a multi-row drag selection) get the grey
    // active-line-number background in BOTH normal and diff mode. In a diff
    // view the number cells of every selected row light up; in normal mode
    // the cursor line's number is highlighted (restores the old overlay's
    // setActiveLine behaviour).
    if (this._selectedDiffLines.has(line)) {
      afterParts.push("active-line-number");
    }
    let beforeLabel = "";
    const beforeParts: string[] = [];
    if (this._inlineRows && row) {
      // BEFORE (left) — the old file number. Full on context + deleted rows; a
      // GAP where the line has no old side (an addition).
      if (row.kind !== "added" && row.oldLine != null) beforeLabel = String(row.oldLine);
      if (row.kind === "removed") beforeParts.push("fe-inline-removed-cell");
      if (this._selectedDiffLines.has(line)) beforeParts.push("fe-inline-left-active");
    }
    // Fold-column data: a chevron on every fold header, pointing right when
    // collapsed. Only present when this file is foldable.
    const region = this._foldRegionAt(line);
    const hasChevron = this._foldEnabled && !!region;
    const folded = hasChevron && this._collapsedHeaders.has(line);
    return {
      afterLabel,
      afterCls: afterParts.join(" "),
      beforeLabel,
      beforeCls: beforeParts.join(" "),
      hasChevron,
      folded,
    };
  }

  /** (Re)sync the gutter's visible band with fresh data. */
  private _syncGutterBand(start: number, end: number): void {
    this._gutter?.setRows(this._gutterRows(start, end), (k) => this._gutterDataFor(k));
  }

  // ── Folding (indentation-based) ────────────────────────────────────────

  /** Whether a model line is currently hidden by a collapsed fold. */
  isLineFolded(line: number): boolean {
    return this._hiddenLines.has(line);
  }

  /** The fold region whose header is at `line` (regions are sorted by start). */
  private _foldRegionAt(line: number): FoldRegion | null {
    if (!this._foldEnabled) return null;
    for (const r of this._foldRegions) {
      if (r.startLine === line) return r;
      if (r.startLine > line) break;
    }
    return null;
  }

  /** Leading indentation of a model line, in visible columns (tabs expanded). */
  private _indentOf(line: number): number {
    if (!this._viewModel) return 0;
    const s = this._viewModel.getLineContent(line);
    const m = /^[ \t]*/.exec(s);
    if (!m || !m[0]) return 0;
    const tabSize = this._viewModel.tabSize || 4;
    let cols = 0;
    for (const ch of m[0]) cols += ch === "\t" ? tabSize : 1;
    return cols;
  }

  /** (Re)compute the fold regions from the current buffer's indentation. */
  private _computeFolds(): void {
    const model = this._viewModel;
    if (!model) {
      this._foldRegions = [];
      this._rebuildHiddenLines();
      return;
    }
    this._foldRegions = computeFoldRegions({
      lineCount: model.lineCount,
      indentOf: (l) => this._indentOf(l),
      isBlank: (l) => /^\s*$/.test(model.getLineContent(l)),
      // A line that is just a closing bracket (optionally followed by a
      // comma/semicolon) closes the block, so it gets absorbed into the fold
      // region — a collapsed block then reads as one line.
      isClosing: (l) => /^[}\])]\s*[,;]?\s*$/.test(model.getLineContent(l).trim()),
    });
    // Drop collapsed headers whose fold vanished after a content change.
    const stillFoldable = new Set(this._foldRegions.map((r) => r.startLine));
    for (const h of Array.from(this._collapsedHeaders)) {
      if (!stillFoldable.has(h)) this._collapsedHeaders.delete(h);
    }
    this._rebuildHiddenLines();
  }

  /** Derive the hidden-line set from the currently collapsed regions. */
  private _rebuildHiddenLines(): void {
    const next = new Set<number>();
    for (const r of this._foldRegions) {
      if (this._collapsedHeaders.has(r.startLine)) {
        for (let l = r.startLine + 1; l <= r.endLine; l++) next.add(l);
      }
    }
    this._hiddenLines = next;
  }

  /** Enable folding for a code file and render the fold column + regions. */
  private _enableFolds(): void {
    if (this._foldEnabled) return;
    this._foldEnabled = true;
    this._computeFolds();
    this._applyFolds();
  }

  /** Reset all fold state when the loaded file changes. */
  private _teardownFolds(): void {
    this._foldEnabled = false;
    this._foldRegions = [];
    this._collapsedHeaders.clear();
    this._hiddenLines.clear();
    if (this._foldRecomputeFrame !== null) {
      if (typeof cancelAnimationFrame !== "undefined")
        cancelAnimationFrame(this._foldRecomputeFrame);
      this._foldRecomputeFrame = null;
    }
    this._viewLines?.setHiddenLines(null);
    // Hide the fold column (visibility changed) — the gutter host persists
    // across pipeline rebuilds.
    this._gutter?.reflow();
  }

  /** Toggle a fold header's collapsed state and re-render. */
  private _toggleFoldAt(line: number): void {
    if (!this._foldEnabled) return;
    const region = this._foldRegionAt(line);
    if (!region) return;
    if (this._collapsedHeaders.has(line)) {
      this._collapsedHeaders.delete(line);
    } else {
      this._collapsedHeaders.add(line);
    }
    this._rebuildHiddenLines();
    this._applyFolds();
  }

  /** Push the current hidden-line set into the view layer and refresh. */
  private _applyFolds(): void {
    if (!this._viewLines || !this._viewModel) return;
    const hidden = this._foldEnabled && this._hiddenLines.size > 0 ? this._hiddenLines : null;
    this._viewLines.setHiddenLines(hidden);
    this._clampCursorToVisible();
    const start = this._viewLines.startLineNumber || 1;
    const end = this._viewLines.endLineNumber || this._viewModel.lineCount;
    this._syncGutterBand(start, end);
    this._renderVisibleLines();
    // Fold-column visibility (or a width change) reflows the gutter host.
    this._gutter?.reflow();
  }

  /** Move any caret that wound up inside a collapsed region onto its header. */
  private _clampCursorToVisible(): void {
    if (!this._cursorController || this._hiddenLines.size === 0) return;
    const moved = (ln: number): number => {
      if (!this._hiddenLines.has(ln)) return ln;
      // Jump to the header of the region containing this hidden line.
      for (const r of this._foldRegions) {
        if (ln > r.startLine && ln <= r.endLine) return r.startLine;
      }
      return ln;
    };
    const states = this._cursorController.getAllCursors().map((c) => {
      const anchor = { ...c.selectionAnchor };
      const position = { ...c.position };
      anchor.lineNumber = moved(anchor.lineNumber);
      position.lineNumber = moved(position.lineNumber);
      return { selectionAnchor: anchor, position };
    });
    this._cursorController.setCursorStates(states);
  }

  /** (Re)paint the red/green row bands for the visible window. */
  private _updateInlineHighlights(): void {
    if (!this._inlineHighlights) return;
    if (!this._viewLines || !this._viewModel || !this._inlineRows) {
      this._inlineHighlights.render(null, 0, 0, this._lineHeight);
      return;
    }
    const start = this._viewLines.startLineNumber || 1;
    const end = this._viewLines.endLineNumber || Math.min(100, this._viewModel.lineCount);
    // Full TEXT width, not the viewport's: the tint bands live INSIDE the text
    // region, so they must span the text region's box, not the whole scroll row
    // (which also includes the two number columns). In the unified-scroll layout
    // the text region's box equals its content width, so this still covers the
    // empty scrollable space after a single very long line — without the extra
    // gutter-wide overhang that created a phantom horizontal scrollbar.
    const region = this._textRegionEl;
    const contentWidth = region ? region.clientWidth : (this._viewportEl?.clientWidth ?? 0);
    // Pass the same wrap mapping the number columns use so the red/green rows
    // align with the TEXT — a wrapped line's tint spans all its segments.
    const wg = this._inlineWrapGetters();
    this._inlineHighlights.render(
      this._inlineRows,
      start,
      end,
      this._lineHeight,
      contentWidth,
      wg.getViewLineStart,
      wg.getViewLineCount,
    );
  }

  // ── Custom content-scoped horizontal scrollbar ─────────────────────────

  /** Native scroll of the viewport keeps the custom thumb in sync. */
  private _onViewportScroll = (): void => this._updateHScroll();

  private _onHScrollPointerDown = (e: PointerEvent): void => {
    const track = this._hScrollTrack;
    const vp = this._viewportEl;
    if (!track || !vp) return;
    const range = vp.scrollWidth - vp.clientWidth;
    if (range <= 0) return;
    const rect = track.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const thumb = (e.target as HTMLElement).classList.contains("fe-hscroll-thumb");
    if (thumb) {
      const onMove = (ev: PointerEvent) => {
        const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / width));
        vp.scrollLeft = frac * range;
      };
      const endMove = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endMove);
        window.removeEventListener("pointercancel", endMove);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endMove);
      window.addEventListener("pointercancel", endMove);
      e.preventDefault();
      e.stopPropagation();
    } else {
      // Click on the track: jump the bar to the cursor.
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / width));
      vp.scrollLeft = frac * range;
    }
  };

  /** Show/hide and position the custom horizontal scrollbar thumb. Starts at
   * the edge of the pinned number columns and ends at the content's right edge. */
  private _updateHScroll(): void {
    const track = this._hScrollTrack;
    const thumb = this._hScrollThumb;
    const vp = this._viewportEl;
    if (!track || !thumb || !vp) return;
    const total = vp.scrollWidth;
    const view = vp.clientWidth;
    const overflowing = !this._wordWrapEnabled && total > view;
    // While the horizontal bar can appear, reserve space below the last line so
    // it is never covered when the user scrolls to the end of the file. This is
    // cleared as soon as the content stops overflowing horizontally.
    const pad = overflowing ? `${HSCROLL_HEIGHT}px` : "";
    if (this._scrollContentEl.style.paddingBottom !== pad) {
      this._scrollContentEl.style.paddingBottom = pad;
    }
    if (!overflowing) {
      if (track.style.display !== "none") track.style.display = "none";
      return;
    }
    if (track.style.display !== "") track.style.display = "";
    // Activity (scroll / layout) keeps the bar visible then re-arms the fade.
    this._hScrollPoke();
    // The track spans the full editor width: it runs under the pinned
    // line-number gutter and the floating vertical bar (the horizontal bar is
    // the topmost layer at the bottom-right corner).
    if (track.style.left !== "0px") track.style.left = "0px";
    if (track.style.right !== "0px") track.style.right = "0px";
    const trackW = track.clientWidth;
    if (trackW <= 0) return;
    const range = Math.max(1, total - view);
    const frac = Math.min(1, Math.max(0, vp.scrollLeft / range));
    const thumbW = Math.max(24, Math.round((view / total) * trackW));
    if (thumb.style.width !== `${thumbW}px`) thumb.style.width = `${thumbW}px`;
    const thumbLeft = Math.round(frac * (trackW - thumbW));
    if (thumb.style.left !== `${thumbLeft}px`) thumb.style.left = `${thumbLeft}px`;
  }

  /** Show the custom horizontal bar and cancel any pending auto-hide. */
  private _hScrollShow(): void {
    this._hScrollSetVisible(true);
    this._hScrollClearHideTimer();
  }

  /** Show on scroll activity, then re-arm the fade timer. */
  private _hScrollPoke(): void {
    this._hScrollSetVisible(true);
    this._hScrollScheduleHide();
  }

  /** Start (or restart) the delay before fading out after the cursor leaves. */
  private _hScrollScheduleHide(): void {
    this._hScrollClearHideTimer();
    this._hScrollHideTimer = window.setTimeout(() => {
      this._hScrollHideTimer = 0;
      // Keep it visible while the cursor is inside the editor content area.
      if (this._hScrollPointerInside) {
        this._hScrollSetVisible(true);
        return;
      }
      this._hScrollSetVisible(false);
    }, HSCROLL_AUTO_HIDE_DELAY);
  }

  private _hScrollSetVisible(visible: boolean): void {
    if (!this._hScrollTrack) return;
    this._hScrollTrack.classList.toggle("fe-hscroll-hidden", !visible);
  }

  private _hScrollClearHideTimer(): void {
    if (this._hScrollHideTimer) {
      window.clearTimeout(this._hScrollHideTimer);
      this._hScrollHideTimer = 0;
    }
  }

  /** Word-wrap view mapping for the BEFORE (left) column — mirrors the normal
   * gutter: first view segment + wrapped segment count per model line. When
   * word wrap is off these return the identity, so the left labels behave
   * exactly as single-row cells. */
  private _inlineWrapGetters(): {
    getViewLineStart: (modelLine: number) => number;
    getViewLineCount: (modelLine: number) => number;
  } {
    return {
      // Fold-aware in both modes: `ViewLines.getViewLineStart` compacts for
      // hidden (folded) lines, so the gutter top aligns with the content.
      getViewLineStart: (modelLine: number) =>
        this._viewLines?.getViewLineStart(modelLine) ?? modelLine,
      getViewLineCount: (modelLine: number) => {
        if (!this._wordWrapEnabled || !this._viewModel) return 1;
        const content = this._viewModel.getLineContent(modelLine);
        const cw = this._charWidth > 0 ? this._charWidth : 8;
        const vw = this._viewportEl?.clientWidth ?? 600;
        const wrapCol = Math.max(10, Math.floor((vw - 16) / (cw || 8)));
        return computeWrapSegments(content, wrapCol).length;
      },
    };
  }

  /** Current syntax theme object. */
  private _theme: SyntaxTheme = getThemeById("openp41ge-dark");

  /** Style element for theme CSS. */
  private _themeStyleEl: HTMLStyleElement | null = null;

  /** Set the theme and re-apply styles. */
  setTheme(themeId: string): void {
    this.themeId = themeId;
    this._theme = getThemeById(themeId);
    this._applyThemeStyles();
    // The vertical scrollbar thumb colour follows the theme (matches .fe-hscroll).
    this._attachVerticalScrollbar();
  }

  /** Update line height and rebuild the rendering pipeline. */
  setEditorLineHeight(lineHeight: number): void {
    if (lineHeight === this._lineHeight) return;
    this._lineHeight = Math.max(14, Math.min(40, lineHeight));
    // Rebuild pipeline if model is already loaded
    if (this.textContentModel) {
      this._teardownPipeline();
      this._initWithModel(this.textContentModel);
    }
  }

  /** Update font size and rebuild the rendering pipeline. */
  setEditorFontSize(fontSize: number): void {
    if (fontSize === this._fontSize) return;
    this._fontSize = Math.max(10, Math.min(30, fontSize));
    if (this._viewportEl) {
      this._viewportEl.style.fontSize = this._fontSize + "px";
    }
    const charWidth = this._measureCharWidth();
    if (charWidth > 0) this._charWidth = charWidth;
    // Rebuild pipeline if model is already loaded
    if (this.textContentModel) {
      this._teardownPipeline();
      this._initWithModel(this.textContentModel);
    }
  }

  // ── Lit template (shell only — no viewport) ──

  render() {
    const tooLarge = this._tooLargeInfo;
    if (this._state === "too-large" && tooLarge) {
      return html`
        <div
          class="fe-root"
          style="display:flex;flex-direction:column;width:100%;height:100%;background:var(--fe-bg, #161616);overflow:hidden;"
        >
          <div
            class="fe-too-large"
            style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;overflow:auto;"
          >
            <div class="fe-too-large-icon" style="font-size:28px;line-height:1;opacity:0.7;">⚠</div>
            <div
              class="fe-too-large-title"
              style="font-size:16px;font-weight:600;color:var(--fe-text, #d4d4d4);"
            >
              This file is too large to open in the editor.
            </div>
            <div
              class="fe-too-large-detail"
              style="font-size:13px;color:var(--fe-text-secondary, #9d9d9d);max-width:520px;"
            >
              ${tooLarge.fileName} (${this._formatBytes(tooLarge.sizeBytes)}) exceeds the
              ${this._formatBytes(tooLarge.limitBytes)} editor limit. Adjust the limit in Editor to
              open larger files.
            </div>
          </div>
          <fe-status-bar></fe-status-bar>
        </div>
      `;
    }

    return html`
      <div
        class="fe-root"
        style="display:flex;flex-direction:column;width:100%;height:100%;background:var(--fe-bg, #161616);overflow:hidden;"
      >
        <div
          class="fe-content"
          style="flex:1;min-height:0;display:flex;flex-direction:row;overflow:hidden;"
        >
          <div
            class="fe-viewport-container"
            style="flex:1;display:flex;flex-direction:column;min-width:0;position:relative;"
          ></div>
        </div>
        <fe-status-bar></fe-status-bar>
      </div>
    `;
  }

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this; // Light DOM
  }

  /** Inject theme-dependent styles. */
  private _applyThemeStyles(): void {
    // Remove old theme style element
    if (this._themeStyleEl && this._themeStyleEl.parentNode) {
      this._themeStyleEl.parentNode.removeChild(this._themeStyleEl);
    }

    const style = document.createElement("style");
    style.setAttribute("data-fe-theme", this.themeId);
    const scopeCSS = generateThemeCSS(this._theme);
    const globalCSS = generateGlobalEditorCSS();
    const c = this._theme.colors;
    const isLight = this._theme.type === "light";
    style.textContent = `
      :root {
        --fe-cursor-color: ${c.cursor};
        --fe-selection-bg: ${c.selectionBg};
        --fe-current-line: ${c.currentLine};
        --fe-bg: ${c.editorBg};
        --fe-gutter-bg: ${c.gutterBg};
        --fe-border-color: ${isLight ? "#d4d4d4" : "#2a2a2a"};
        --fe-secondary-color: ${isLight ? "#666" : "#888"};
      }
      /* Standard token types */
      .view-line .token-other { color: ${c.default}; }
      .view-line .token-comment { color: ${c.cmt}; }
      .view-line .token-string { color: ${c.str}; }
      .view-line .token-regex { color: ${c.rgx}; }
      .view-line .token-number { color: ${c.num}; }
      .view-line .token-keyword { color: ${c.kw}; }
      .view-line .token-type { color: ${c.type}; }
      /* Editor background applied to root and gutter (line numbers blend with
         the content area: both use --fe-bg). */
      .fe-root { background: var(--fe-bg) !important; }
      .fe-gutter { background: var(--fe-bg) !important; }
      /* Scrollbar styling — match the editor background */
      .fe-viewport::-webkit-scrollbar-track {
        background: var(--fe-bg);
        box-sizing: border-box;
        /* Faded content-facing edge on the whole scroll zone. */
        border-left: 1px solid rgba(128,128,128,0.25);
      }
      .fe-viewport::-webkit-scrollbar-corner {
        background: var(--fe-bg);
      }
      .fe-viewport::-webkit-scrollbar-thumb {
        background: ${isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.16)"};
        border-radius: 0;
      }
      .fe-viewport::-webkit-scrollbar-thumb:hover {
        background: ${isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.32)"};
      }
      .fe-viewport::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      /* The NATIVE horizontal scrollbar spans the whole row — starting UNDER
         the pinned line-number columns. It is hidden; a custom .fe-hscroll bar
         that spans the full editor width (under the columns and the floating
         vertical bar) replaces it. The vertical bar stays native. */
      .fe-viewport::-webkit-scrollbar:horizontal {
        height: 0;
      }
      .fe-hscroll {
        background: transparent;
        box-sizing: border-box;
        /* Faded content-facing (top) edge on the whole scroll zone. */
        border-top: 1px solid rgba(128,128,128,0.25);
        /* Fade in/out with the vertical bar when the cursor leaves. */
        opacity: 1;
        transition: opacity 250ms ease;
      }
      .fe-hscroll.fe-hscroll-hidden {
        opacity: 0;
        pointer-events: none;
      }
      .fe-hscroll-thumb {
        background: ${isLight ? "#c1c1c1" : "#424242"};
        opacity: 0.9;
        border-radius: 0;
      }
      .fe-hscroll-thumb:hover {
        background: ${isLight ? "#b0b0b0" : "#555"};
      }
      /* Folded (collapsed) header suffix — the grey “{ … }” summary appended to
         a collapsed block so its opening/closing brackets read as inline
         metadata (rather than source text), matching the JSON editor. */
      .fe-fold-ellipsis {
        color: var(--fe-secondary-color, #888);
      }
      /* Status bar theme support */
      fe-status-bar {
        --sbb-bg: var(--bg-secondary);
        --sbb-color: ${c.default};
      }
      /* Search-match highlights (built-in find + external highlight sources) —
         rounded corners match the selection highlight (3px, see themes). */
      .find-match,
      .find-match-active {
        pointer-events: none;
        border-radius: 3px;
      }
      .find-match {
        background: var(--fe-find-match-bg, rgba(234, 140, 0, 0.32));
      }
      .find-match-active {
        background: var(--fe-find-match-bg, rgba(255, 158, 0, 0.6));
      }
      /* Inline commit-diff row tints (red/deleted, green/added) — painted
         behind the (syntax-highlighted) text rows so tokens stay legible. */
      .fe-inline-diff-added   { background: ${isLight ? "rgba(46,160,67,0.14)" : "rgba(46,160,67,0.16)"}; }
      .fe-inline-diff-removed { background: ${isLight ? "rgba(248,81,73,0.13)" : "rgba(248,81,73,0.16)"}; }

      /* Inline commit-diff gutter columns: the leftmost BEFORE column shares
         the editor background (a separate group from the normal gutter). The
         cell of a changed row is tinted all the way across its column - the
         BEFORE cell of a deleted row is red; the AFTER cell of an added row
         is green (on the normal line-number label). No sign column anymore. */
      .fe-inline-left { background: var(--fe-bg) !important; }
      .fe-inline-left-label.fe-inline-removed-cell {
        background: ${isLight ? "rgba(248,81,73,0.22)" : "rgba(248,81,73,0.24)"};
      }
      .fe-gutter .line-number.fe-inline-added-cell {
        background: ${isLight ? "rgba(46,160,67,0.22)" : "rgba(46,160,67,0.24)"};
      }
      /* A deleted row fills its empty AFTER number cell with red too, so the
         red is ONE continuous block across the gutter (left cell + right cell
         + text row), not two isolated blocks. */
      .fe-gutter .line-number.fe-inline-removed-cell {
        background: ${isLight ? "rgba(248,81,73,0.22)" : "rgba(248,81,73,0.24)"};
      }
      /* Selected rows (cursor line or a multi-row selection): neutral number
         CELLs get the grey background used for border lines and active tabs.
         Changed rows (red cells on deleted rows, green AFTER cell on added
         rows) KEEP their colour — the selection grey must not replace them. */
      .fe-inline-left-label.fe-inline-left-active:not(.fe-inline-removed-cell),
      .fe-gutter .line-number.active-line-number:not(.fe-inline-added-cell):not(.fe-inline-removed-cell) {
        background: var(--fe-border-color, #2a2a2a);
      }
      /* The full-height gutter wrapper carries the same cell decorations as
         the one-row label (line-number-wrapper), so WRAPPED rows tint every
         segment, not just the first one. */
      .fe-gutter .line-number-wrapper.fe-inline-added-cell {
        background: ${isLight ? "rgba(46,160,67,0.22)" : "rgba(46,160,67,0.24)"};
      }
      .fe-gutter .line-number-wrapper.fe-inline-removed-cell {
        background: ${isLight ? "rgba(248,81,73,0.22)" : "rgba(248,81,73,0.24)"};
      }
      .fe-gutter .line-number-wrapper.active-line-number:not(.fe-inline-added-cell):not(.fe-inline-removed-cell) {
        background: var(--fe-border-color, #2a2a2a);
      }
      /* Mouse-over highlight for the number cells. The shared gutter host
         paints ONE unified .eg-hoverbox that stretches across every
         highlightable column (line numbers + fold column) — matching the
         JSON editor. It sits over the cells so coloured inline-diff cells
         keep their tint; the neutral fill + inner ring come from the box
         (styled by the shared GUTTER_DEFAULT_CSS, themed via the --eg-hover-*
         tokens set on .fe-gutter). The per-cell hover classes are no longer
         styled — the box is the single source of the hover highlight. */
      /* (hover box styling is provided by GUTTER_DEFAULT_CSS) */
      /* Fold/collapse gutter column (right of the line numbers). The shared
         host gives it the generic eg-cell; the file editor supplies the
         layout + chevron styles here (matching the JSON editor's fold column).
         The chevron button fills its cell and owns its hover; empty fold cells
         stay clickable (line selection) and are covered by the unified hover
         box that spans the number + fold columns on non-foldable rows. The
         shared GUTTER_DEFAULT_CSS provides the cell layout, chevron structure
         and hover box; the file editor only themes the tokens (below) and
         keeps its editor-specific column background + active-line fill. */
      .fe-gutter {
        /* Colour tokens consumed by GUTTER_DEFAULT_CSS. */
        --eg-fold-color: var(--fe-fold-color, #79c0ff);
        --eg-fold-hover-bg: rgba(121, 192, 255, 0.18);
        --eg-fold-hover-color: #a5d6ff;
        --eg-hover-fill: ${isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.09)"};
        --eg-hover-ring: ${isLight ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.16)"};
      }
      .fe-gutter .eg-col--fold {
        background: var(--fe-bg) !important;
      }
      .fe-gutter .eg-col--fold .eg-cell:not(.eg-cell--fold).eg-cell--active {
        background: var(--fe-border-color, #2a2a2a);
      }
      ${scopeCSS}
      ${globalCSS}
      ${GUTTER_DEFAULT_CSS}
    `;
    document.head.appendChild(style);
    this._themeStyleEl = style;
  }

  firstUpdated(): void {
    if (this._initDone) return;
    this._applyThemeStyles();
    this._initDone = true;

    const content = this.renderRoot.querySelector(".fe-content") as HTMLElement;
    if (!content) return;

    const viewportContainer = content.querySelector(".fe-viewport-container") as HTMLElement;
    if (!viewportContainer) return;

    // Find and store the status bar reference
    this._statusBar = this.renderRoot.querySelector("fe-status-bar") as FeStatusBar | null;
    // Status-info set before firstUpdated (e.g. the pane's short commit ID).
    if (this._statusBar && this._pendingStatusInfo !== undefined) {
      this._statusBar.setInfo(this._pendingStatusInfo);
    }

    // Remove any existing viewport (from a previous firstUpdated call after
    // reconnection). When the editor's container is orphaned by a grid re-render
    // and then re-appended via mountController, connectedCallback re-runs
    // firstUpdated, which would create a duplicate viewportEl in the container.
    if (this._viewportEl && this._viewportEl.parentNode) {
      this._viewportEl.parentNode.removeChild(this._viewportEl);
    }

    // Create viewport programmatically (not in Lit's template)
    this._viewportEl = document.createElement("div");
    this._viewportEl.className = "fe-viewport";
    this._viewportEl.style.cssText =
      "flex:1;overflow-y:auto;overflow-x:hidden;position:relative;outline:none;cursor:text;user-select:text;-webkit-user-select:text;";
    this._viewportEl.style.fontFamily =
      "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace";
    this._viewportEl.style.fontSize = this._fontSize + "px";
    this._viewportEl.style.lineHeight = this._lineHeight + "px";
    // Insert viewport into the viewport-container
    viewportContainer.appendChild(this._viewportEl);

    // ── Native-scroll layout for the number columns ──
    // The BEFORE column, AFTER column and the text live in ONE scroll
    // container (the viewport) in a flex row — the same spatial model VSCode
    // uses (margin + content scroll together). The numbers therefore scroll
    // compositor-natively WITH the content: no transform follower, no
    // per-frame main-thread band repaint, and the band is revealed by native
    // scroll exactly like the text lines (numbers always continue below the
    // fold once you scroll). The `view-lines` element drives the row's full
    // content height, so the columns stretch to the whole document.
    this._scrollContentEl = document.createElement("div");
    this._scrollContentEl.className = "fe-scroll-content";
    this._scrollContentEl.style.cssText =
      "position:relative;display:flex;flex-direction:row;align-items:stretch;width:max-content;min-width:100%;min-height:100%;";
    this._viewportEl.appendChild(this._scrollContentEl);

    this._gutterGroupEl = document.createElement("div");
    this._gutterGroupEl.className = "fe-gutter-group";
    // BOTH number columns pin together at the LEFT during horizontal scroll
    // (position:sticky; left:0). Vertical scroll stays NATIVE: a sticky box as
    // tall as its containing block cannot stick vertically (it is clamped), so
    // the numbers still scroll with the content. The overlay forces the AFTER
    // column to `relative`, so pinning has to come from this GROUP, not the
    // column itself.
    this._gutterGroupEl.style.cssText =
      "flex-shrink:0;display:flex;flex-direction:row;align-items:stretch;position:sticky;left:0;top:0;z-index:6;";
    this._scrollContentEl.appendChild(this._gutterGroupEl);

    // The shared gutter host (openp41ge-core-editor-gutter) owns BOTH number
    // columns (BEFORE old-numbers on the left, AFTER on the right) inside the
    // sticky group. Its cells scroll compositor-natively with the content
    // (the group is the flex-row gap between the pinned columns and the text;
    // the host root is sticky-left for horizontal pinning).
    this._gutter = new Gutter({
      // Unified hover box (like the JSON editor): the host paints a single
      // `.eg-hoverbox` that stretches across the highlightable columns. On a
      // foldable row the fold column is non-highlightable (the chevron owns
      // its hover), so the box stays on the line-number column; on every
      // other row it spans BOTH the number and fold columns.
      hoverBox: true,
      events: {
        onRowClick: (row) => this._cursorController?.selectLine(row.key),
        onRowSelectRange: (_anchor, row) => {
          // Dragging over the number cells extends the selection from the
          // mousedown line to the current line, selecting every line in
          // between. `selectLine` set the anchor at the mousedown line's
          // start; `selectTo` moves the position to the target line's end,
          // clamping to its full length. The cursor controller's
          // selection-changed event updates _selectedDiffLines and repaints
          // the gutter, so the whole range lights up.
          this._cursorController?.selectTo(row.key, Number.MAX_SAFE_INTEGER);
        },
      },
    });
    const gutterRoot = this._gutter.root;
    gutterRoot.classList.add("fe-gutter");
    // Keep the host's row layout (the shared Gutter needs display:flex so its
    // columns sit side by side) alongside the file editor's pinning styles.
    gutterRoot.style.cssText =
      "display:flex;flex-direction:row;align-items:stretch;" +
      "flex-shrink:0;position:relative;overflow:hidden;user-select:none;" +
      "font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace;";
    this._gutterGroupEl.appendChild(gutterRoot);
    this._gutter.setColumns([
      makeFeDiffBeforeColumn({
        width: () => this._gutterLeftWidth,
        lineHeight: () => this._lineHeight,
        visible: () => this._inlineRows !== null,
      }),
      makeFeNumberColumn({
        width: () => this._gutterRightWidth,
        lineHeight: () => this._lineHeight,
      }),
      // Fold/collapse column — right of the line numbers (matches the JSON
      // editor's [numbers, fold] order). Only shown on foldable files. The
      // column is as wide as a row is tall so the full-width chevron button
      // is always a square (matching the JSON editor's fold column).
      {
        ...foldColumn({
          width: () => Math.max(14, Math.round(this._lineHeight)),
          onToggle: (line) => this._toggleFoldAt(line),
        }),
        visible: () => this._foldEnabled,
      },
    ]);

    this._textRegionEl = document.createElement("div");
    this._textRegionEl.className = "fe-text-region";
    // Not a scroll container: the viewport owns the (single) horizontal + vertical
    // scrollbars. overflow:hidden keeps this box from ever showing its own bar.
    this._textRegionEl.style.cssText =
      "position:relative;flex:1 1 auto;min-width:0;overflow:hidden;";
    this._scrollContentEl.appendChild(this._textRegionEl);

    // Custom horizontal scrollbar — spans the FULL editor width (it runs under
    // the pinned line-number columns and the floating vertical bar; the bar is
    // the topmost layer at the bottom-right corner). It is NOT a child of the
    // scroll container (the viewport scrolls, so an absolutely-positioned child
    // there would slide with the content). Instead it lives in the
    // non-scrolling .fe-viewport-container (position:relative) and stays pinned
    // to the viewport's bottom edge while the content scrolls. It maps 1:1 onto
    // the native scrollLeft/scrollWidth/clientWidth held by the viewport, so
    // trackpad / Shift+wheel still scroll (the native horizontal bar is hidden
    // in CSS).
    this._hScrollTrack = document.createElement("div");
    this._hScrollTrack.className = "fe-hscroll";
    this._hScrollTrack.style.cssText = `position:absolute;left:0;right:0;bottom:0;height:${HSCROLL_HEIGHT}px;z-index:8;display:none;user-select:none;`;
    this._hScrollThumb = document.createElement("div");
    this._hScrollThumb.className = "fe-hscroll-thumb";
    // Square corners (match the native bar). No border-radius.
    this._hScrollThumb.style.cssText =
      "position:absolute;top:0;bottom:0;cursor:pointer;touch-action:none;";
    this._hScrollTrack.appendChild(this._hScrollThumb);
    viewportContainer.appendChild(this._hScrollTrack);
    this._hScrollTrack.addEventListener("pointerdown", this._onHScrollPointerDown);
    this._viewportEl.addEventListener("scroll", this._onViewportScroll);

    // Auto-hide the custom horizontal bar (and the vertical OverlayScrollbar)
    // when the cursor leaves the editor content area. Both listen on the same
    // hover zone so they fade out together after a short delay.
    this._onContentPointerEnter = () => {
      this._hScrollPointerInside = true;
      this._hScrollShow();
    };
    this._onContentPointerLeave = () => {
      this._hScrollPointerInside = false;
      this._hScrollScheduleHide();
    };
    viewportContainer.addEventListener("pointerenter", this._onContentPointerEnter);
    viewportContainer.addEventListener("pointerleave", this._onContentPointerLeave);

    // The shared gutter host's delegated mouseover/mouseout handles the
    // row-hover highlight for BOTH columns (each cell adds its own hover class).

    this._updateHScroll();

    // Prevent mousedown from bubbling to grid drag handler
    const root = this.renderRoot.querySelector(".fe-root") as HTMLElement;
    root.addEventListener("mousedown", (e: MouseEvent) => e.stopPropagation());

    // Handle viewport click to position cursor and focus textarea
    this._viewportEl.addEventListener("mousedown", this._onViewportMouseDown);

    // Load file if path is already set (TextMate init started in connectedCallback)
    if (this.filePath && this.textContentModel) {
      this._initWithModel(this.textContentModel);
    }

    // Floating vertical scrollbar must be attached AFTER the model is initialised
    // (_initWithModel's _teardownPipeline destroys any prior one on rebuild, and
    // re-running firstUpdated on reconnect re-creates the viewport).
    this._attachVerticalScrollbar();
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Start TextMate init as early as possible so language detection
    // is ready when loadFile() is called from the controller.
    if (!this._textMateInitPromise) {
      this._textMateInitPromise = this._initTextMateOnce();
    }
    // On reconnect (pane move), re-init viewport if needed.
    // Check both viewport connection state AND pipeline state:
    //   - !_viewportEl.isConnected: viewport was removed from DOM with the container
    //   - !this._viewModel: pipeline was torn down by _teardownPipeline() but
    //     the viewport was reconnected (container moved within document by
    //     mountController's appendChild). The viewport DOM node came back but
    //     the rendering pipeline is destroyed.
    if (
      this._initDone &&
      (!this._viewportEl || !this._viewportEl.isConnected || !this._viewModel)
    ) {
      this._initDone = false;
      this.firstUpdated();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._teardownPipeline();
    // Remove the horizontal scrollbar auto-hide listeners (kept across in-connect
    // rebuilds, removed only when the editor fully disconnects).
    this._hScrollClearHideTimer();
    const hoverZone = this._viewportEl?.parentElement;
    if (hoverZone) {
      hoverZone.removeEventListener("pointerenter", this._onContentPointerEnter);
      hoverZone.removeEventListener("pointerleave", this._onContentPointerLeave);
    }
  }

  // ── Public API ──

  /**
   * Show the VSCode-style "file is too large to open" message pane instead of
   * loading content. Sets the editor to the "too-large" state; nothing is read
   * into a model and no view lines are created.
   *
   * @param filePath - The disk path of the file (used to derive a display name).
   * @param sizeBytes - The file's actual size in bytes.
   * @param limitBytes - The configured editor.maxFileSize limit in bytes.
   */
  showTooLarge(filePath: string, sizeBytes: number, limitBytes: number): void {
    const name = filePath.split("/").filter(Boolean).pop() || filePath;
    this.filePath = filePath;
    this.fileName = name;
    this._tooLargeInfo = { fileName: name, sizeBytes, limitBytes };
    this._state = "too-large";
    this._isDirty = false;
    this.requestUpdate();
  }

  async loadFile(path: string, fileName?: string): Promise<void> {
    this.filePath = path;
    if (fileName !== undefined) this.fileName = fileName;

    this._state = "loading";

    // Do NOT block first paint on the TextMate WASM bootstrap (~500KB decode).
    // Kick it off (memoized module-wide) and render plain lines immediately;
    // when it resolves, _applyLanguageToCurrentModel() highlights the visible
    // range. For all files after the first, the registry is already warm.
    if (!this._textMateInitPromise) {
      this._textMateInitPromise = this._initTextMateOnce();
    }
    void this._textMateInitPromise;

    // Model must be set externally by the platform via textContentModel.
    // The platform's ModelRegistry creates and shares models across tabs.
    if (!this.textContentModel) {
      throw new Error(
        "FileEditorElement.loadFile() requires textContentModel to be set. " +
          "The platform should set textContentModel before calling loadFile().",
      );
    }

    // If the path changed, the caller should have set a new textContentModel.
    if (this.textContentModel.uri !== path) {
      throw new Error(
        "FileEditorElement.loadFile(): textContentModel.uri does not match path. " +
          `Expected "${path}", got "${this.textContentModel.uri}".`,
      );
    }

    this._initWithModel(this.textContentModel);
    this._state = "ready";

    this._dispatchTitleChanged();
  }

  /**
   * What a save tidies first (`./save-cleanup.ts`): trailing whitespace and
   * a final newline. Both off until the host turns them on.
   */
  setSaveCleanup(opts: SaveCleanupOptions): void {
    this._saveCleanup = { ...opts };
  }

  async save(): Promise<boolean> {
    if (this._readOnly) return false;
    if (!this.textContentModel || !this.filePath) return false;

    // Tidy the buffer itself (one undoable edit), so what is shown is what is saved.
    const cleanup = saveCleanupEdits(this.textContentModel, this._saveCleanup);
    if (cleanup.length > 0) this.textContentModel.pushEditOperations(cleanup);

    const content = this.textContentModel.getValue();

    // Persist to disk via IPC if available
    if (window.openp41ge?.file?.writeFile) {
      try {
        await window.openp41ge.file.writeFile(this.filePath, content);
      } catch (err) {
        console.error("[file-editor] Failed to save file:", err);
        return false;
      }
    }

    this._isDirty = false;
    this.textContentModel.markClean();
    // Record the current document version so undo-to-clean is correctly detected
    // (O(1), no full-string copy).
    this._dirtyTracker.markSaved(this.textContentModel.versionId);
    this._dispatchDirtyChanged(false);
    this._dispatchFileSaved();
    if (this._statusBar) {
      this._statusBar.setDirty(false);
    }
    return true;
  }

  formatDocument(): void {
    if (this._readOnly) return;
    if (!this.formatterRegistry || !this.textContentModel) return;
    const ext = this.filePath.split(".").pop()?.toLowerCase() || "";
    const formatter = this.formatterRegistry.get(ext);
    if (!formatter) return;
    const content = this.textContentModel.getValue();
    const formatted = formatter.format(content);
    if (formatted === content) return;
    this.textContentModel.pushEditOperations([
      {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: this.textContentModel.lineCount,
          endColumn:
            this.textContentModel.getLineContent(this.textContentModel.lineCount).length + 1,
        },
        text: formatted,
      },
    ]);
  }

  getState(): { state: FileEditorState; isDirty: boolean } {
    return {
      state: this._state,
      isDirty: this._isDirty,
    };
  }

  /**
   * Called by the platform when the tab hosting this editor is shown/hidden.
   * Hidden editors suspend all rendering work (re-render on model changes,
   * resize handling, async tokenize catch-up) and refresh the visible window
   * when shown again if the content changed while hidden.
   *
   * Only file editors need this — streaming/terminal tab types never re-render
   * hidden stale content, so they don't forward visibility to their content.
   */
  setActive(visible: boolean): void {
    if (visible) {
      this._resumeWork();
    } else {
      this._pauseWork();
    }
  }

  /** Suspend rendering while this editor's tab is inactive. */
  private _pauseWork(): void {
    if (this._paused) return;
    this._paused = true;
    // Cancel any pending async tokenize catch-up pass.
    if (this._tokenizeFrame !== null) {
      cancelAnimationFrame(this._tokenizeFrame);
      this._tokenizeFrame = null;
    }
    this._renderHadUncachedTokens = false;
    // Stop observing resize — re-rendering on resize of a hidden editor is wasted.
    this._viewportResizeObserver?.disconnect();
  }

  /** Resume rendering when this editor's tab becomes active again. */
  private _resumeWork(): void {
    if (!this._paused) return;
    this._paused = false;
    if (!this._viewModel || !this._viewLines) return;

    // Re-observe resize so future resizes update the visible range again.
    if (this._viewportResizeObserver && this._viewportEl && typeof ResizeObserver !== "undefined") {
      this._viewportResizeObserver.observe(this._viewportEl);
    }

    // If the model changed while hidden, bring the view up to date: re-measure
    // the scrollbar width (skipped while hidden) and re-render the visible window.
    if (this._pausedContentChanged) {
      this._pausedContentChanged = false;
      this._lineWidthTracker.reset();
      this._lineWidthTracker.measureRange(1, this._viewModel.lineCount);
      this._reRenderAll();
      this._refreshContentWidth();
      this._syncCursorView();
    }
  }

  // ── Private ──

  private async _initTextMateOnce(): Promise<void> {
    if (_tokenRegistryInstance) return;
    try {
      const { registry } = await initTextMate(this._theme.rawTheme);
      _tokenRegistryInstance = new TokenRegistry(registry);
      // A file may have been opened (and rendered plain) while WASM was still
      // bootstrapping — highlight it now that the grammar machinery is ready.
      this._applyLanguageToCurrentModel();
    } catch (err) {
      console.warn("[file-editor] TextMate init failed, tokenization disabled:", err);
      // Don't set a broken TokenRegistry — _initWithModel checks for null
      _tokenRegistryInstance = null as any;
    }
  }

  /**
   * Apply the language grammar for this.filePath to the current model.
   *
   * Detects the language from the file name and, when a grammar is ready,
   * applies it (tokenizing the top of the file and re-rendering the visible
   * range so it highlights). Called from `_initWithModel` (grammar already
   * bootstrapped) and from TextMate init completion (WASM was still loading
   * when the file opened and rendered plain).
   */
  private _applyLanguageToCurrentModel(): void {
    if (!this._viewModel) return;
    const tokenRegistry = this.tokenRegistry ?? _tokenRegistryInstance;
    if (!tokenRegistry) return;
    // A grammar is already applied for this model — don't restart it.
    if (this._viewModel.hasTokenizer) return;

    const fileName = this.filePath.split("/").filter(Boolean).pop() || "";
    const parts = fileName.split(".");
    const hasExt = parts.length > 1;
    const rawExt = hasExt ? parts[parts.length - 1].toLowerCase() : fileName.toLowerCase();
    const tryExt = (ext: string) => tokenRegistry.getLanguageId(ext);
    const langId =
      tryExt(rawExt) ||
      (hasExt ? tryExt(parts.slice(0, -1).join(".").toLowerCase()) : undefined) ||
      tryExt(fileName.toLowerCase());
    if (!langId) return;

    tokenRegistry.getTokenizer(langId).then((tokenizer) => {
      if (!this._viewModel || !this._viewLines) return; // torn down meanwhile
      this._viewModel.setTokenizer(tokenizer);
      // A recognized code grammar means this file is foldable (indentation
      // folding applies). Show the fold column + regions.
      this._enableFolds();
      if (this._paused) {
        // Hidden tab — a grammar just became ready. Apply it to the model but
        // skip the DOM rebuild (wasted on a hidden editor); mark the view stale
        // so resume re-renders and picks the tokens up.
        this._pausedContentChanged = true;
        return;
      }
      const count = this._viewModel.lineCount;
      this._viewModel.tokenizeVisibleRange(1, Math.min(100, count));
      this._viewLines.clearContentCache();
      this._bracketDepths = null;
      this._bracketRangeStart = 0;
      this._bracketRangeEnd = 0;
      this._computeBracketDepths(
        this._viewLines.startLineNumber || 1,
        this._viewLines.endLineNumber || Math.min(50, count),
      );
      this._viewLines.refresh();
    });
  }

  /**
   * Debounce-schedule the async tokenize-then-highlight pass. Runs a single
   * rAF after any render that left visible lines without cached tokens, then
   * tokenizes the visible range OFF the paint path and re-renders it.
   *
   * No-ops when every rendered line had tokens (flag not set) or when no
   * grammar is ready yet (the grammar-load path triggers its own pass).
   */
  private _scheduleAsyncTokenize(): void {
    if (!this._renderHadUncachedTokens) return;
    if (!this._viewModel?.hasTokenizer) {
      // Grammar not ready — nothing to catch up yet; the grammar-load path
      // re-renders and will flag any still-un-tokenized visible lines.
      this._renderHadUncachedTokens = false;
      return;
    }
    if (this._tokenizeFrame !== null) return; // already scheduled
    this._tokenizeFrame = requestAnimationFrame(() => {
      this._tokenizeFrame = null;
      this._asyncTokenizeVisible();
    });
  }

  /** Tokenize the current visible range and re-render it once tokens exist. */
  private _asyncTokenizeVisible(): void {
    if (!this._viewModel || !this._viewLines) return;
    const start = this._viewLines.startLineNumber || 1;
    const end = Math.min(
      this._viewModel.lineCount,
      this._viewLines.endLineNumber || Math.min(50, this._viewModel.lineCount),
    );
    // Synchronous here, but runs one frame AFTER paint and covers only the
    // visible window (dozens of lines), so the UI never blocks on TextMate.
    this._viewModel.tokenizeVisibleRange(start, end);
    if (this._renderHadUncachedTokens) {
      this._renderHadUncachedTokens = false;
      // Lines now have cached tokens — rebuild the visible window so the
      // token spans appear. refresh() bypasses the onScroll no-change guard.
      this._viewLines.refresh();
    }
  }

  private _initWithModel(model: PieceTreeTextContentModel): void {
    // Guard against double init
    if (this._viewModel && this._viewModel.model === model) return;
    this._teardownPipeline();
    // Folding is per-file: reset the fold state so a non-code file that
    // follows a code file doesn't keep the fold column / collapsed blocks.
    this._teardownFolds();

    // Create ViewModel
    this._viewModel = new ViewModel(model, {
      lineHeight: this._lineHeight,
      tabSize: 4,
    });

    // Detect language from file extension.
    // Strategy:
    //   1. For files with a visible extension ("file.ts"): use the extension ("ts").
    //   2. For extensionless files ("Dockerfile"): use the full lowercase basename.
    //   3. For hidden files (".eslintrc.json"): skip leading dot, use extension.
    //   4. For compound names ("Dockerfile.prod"): try extension first, then prefix.
    this._applyLanguageToCurrentModel();

    // Create ViewLines (rendering layer). Parented to the TEXT REGION (the
    // flex child that starts after the number columns) so all coordinate bases
    // — lines, cursor, selection, search, tints — shift together into the one
    // native scroll container with the gutters.
    this._viewLines = new ViewLines(this._textRegionEl, {
      lineHeight: this._lineHeight,
      tabSize: 4,
    });
    this._viewLines.setTotalLineCount(model.lineCount);
    this._viewLines.lineContentProvider = {
      getLineContent: (ln) => this._viewModel?.getLineContent(ln) ?? "",
      getLineTokens: (ln) => {
        // Cache-only access: never tokenize synchronously inside the render
        // loop. Uncached lines draw plain; the async catch-up highlights them.
        const tokens = this._viewModel?.getLineTokensIfCached(ln) ?? null;
        this._noteRenderedLineTokens(tokens);
        return tokens;
      },
      tabSize: 4,
    };

    // Create CursorController
    this._cursorController = new CursorController(model);
    this._cursorController.setCoordinatesConverter(this._viewModel.coordinatesConverter);

    // Create KeyboardHandler
    this._keyboardHandler = new KeyboardHandler(this._cursorController);

    // Create ClipboardHandler (uses a dedicated hidden textarea for clipboard)
    const clipboardTextArea = document.createElement("textarea");
    this._clipboardHandler = new ClipboardHandler({
      model,
      cursorController: this._cursorController,
      textArea: clipboardTextArea,
    });

    // Create CompositionHandler
    this._compositionHandler = new CompositionHandler(this._cursorController);

    // Create TextAreaInput
    this._textAreaInput = new TextAreaInput({
      parentElement: this._viewportEl,
      cursorController: this._cursorController,
      onType: (char) => {
        if (this._readOnly) return;
        if (!this._cursorController) return;
        const pos = this._cursorController.position;

        // Auto-closing pairs: skip matching closer
        if (char.length === 1 && shouldSkipClose(char, model, pos)) {
          this._cursorController!.moveRight();
          return;
        }

        // Auto-closing pairs: auto-insert closer
        if (char.length === 1) {
          const autoClose = checkAutoClose(char, model, pos);
          if (autoClose) {
            this._cursorController!.insertChar(autoClose.text);
            for (let i = 0; i < autoClose.text.length - autoClose.cursorOffset; i++) {
              this._cursorController!.moveLeft();
            }
            return;
          }
        }

        this._cursorController!.insertChar(char);
      },
      onNewLine: () => {
        if (this._readOnly) return;
        this._cursorController!.insertNewLine();
      },
      onDeleteLeft: () => {
        if (this._readOnly) return;
        this._cursorController!.deleteLeft();
      },
      onDeleteRight: () => {
        if (this._readOnly) return;
        this._cursorController!.deleteRight();
      },
      onComposition: (text) => {
        if (this._readOnly) return;
        this._compositionHandler?.onCompositionUpdate(text);
      },
      onCopy: () => {
        return this._clipboardHandler?.onCopy() || "";
      },
      onFocus: () => {
        this._isFocused = true;
        // Read-only editors keep the hidden textarea focused (so selection /
        // copy work) but never show a caret.
        if (!this._readOnly) {
          this._cursorRenderer?.show();
        }
      },
      onBlur: () => {
        this._isFocused = false;
        this._cursorRenderer?.hide();
      },
      onPaste: (text) => {
        if (this._readOnly) return;
        this._clipboardHandler?.onPaste(text);
      },
      onCut: () => {
        if (this._readOnly) return "";
        return this._clipboardHandler?.onCut() || "";
      },
      onKey: (e) => {
        // In-editor find + navigation (Cmd/Ctrl+F, Cmd/Ctrl+G) and save. These
        // are handled here (like Cmd+A below) so they work in both edit and
        // read-only modes.
        if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
          e.preventDefault();
          this._openFind();
          return true;
        }
        if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) {
          e.preventDefault();
          this._findNext(e.shiftKey ? -1 : 1);
          return true;
        }
        // Save (Cmd/Ctrl+S). save() is inert in read-only mode.
        if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
          e.preventDefault();
          void this.save();
          return true;
        }
        if (this._readOnly) {
          // Read-only: allow navigation/selection/copy but never model edits.
          // Plain-char typing arrives via onType (already gated); undo/redo
          // and the delete/new-line/tab keys are blocked here so the model
          // can never change.
          if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
            return true;
          }
          if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter" || e.key === "Tab") {
            return true;
          }
          // Alt/Option+ArrowUp/Down moves a line — an edit — so block it.
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            return true;
          }
          return this._keyboardHandler!.handleKeyDown(e);
        }
        // Suppress scroll-to-reveal for Cmd+A (select all)
        if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
          this._suppressScroll = true;
        }
        return this._keyboardHandler!.handleKeyDown(e);
      },
    });

    // Measure char width once before creating the MouseHandler
    this._measureCharWidth();

    // Create MouseHandler (double-click word selection)
    this._mouseHandler = new MouseHandler({
      viewportEl: this._viewportEl,
      cursorController: this._cursorController,
      lineHeight: this._lineHeight,
      charWidth: this._charWidth || 8,
      wordWrapEnabled: this._wordWrapEnabled,
      getCharacterMapping: (viewLineNumber: number) => {
        return this._viewLines?.getViewLine(viewLineNumber)?.characterMapping ?? null;
      },
      convertViewToModelPosition:
        this._viewModel?.coordinatesConverter && this._wordWrapEnabled
          ? (vl: number, vc: number) =>
              this._viewModel!.coordinatesConverter!.convertViewToModelPosition(vl, vc)
          : null,
    });

    // Create CursorRenderer
    this._cursorRenderer = new CursorRenderer(this._textRegionEl, this._cursorController);

    // Create SelectionRenderer
    this._selectionRenderer = new SelectionRenderer(this._textRegionEl, this._cursorController);

    // Create FindMatchRenderer (search-result highlights; empty until a find or
    // external highlight source provides matches)
    this._findRenderer = new FindMatchRenderer(this._textRegionEl);

    // Create CurrentLineHighlight
    this._currentLineHighlight = new CurrentLineHighlight(this._textRegionEl);

    // Create inline-diff row-tint renderer (red/removed, green/added)
    this._inlineHighlights = new InlineDiffHighlightsRenderer(this._textRegionEl);

    // Create IndentationGuides
    this._indentationGuides = new IndentationGuides({
      tabSize: 4,
      charWidth: this._charWidth || 8,
      enabled: true,
    });

    // The shared gutter host was created in firstUpdated with its two columns.
    // Size them for the current buffer/diff state (the host keeps the same DOM
    // across pipeline rebuilds; only the band + per-row data change here).
    this._applyGutterWidths();

    // Create ScrollManager
    this._scrollManager = new ScrollManager(this._viewportEl, this._viewLines);

    // Observe viewport resize (including from CSS zoom on parent) so the
    // visible line range recalculates when the viewport shrinks or grows.
    // Guard: ResizeObserver may not exist in test environments (jsdom).
    if (typeof ResizeObserver !== "undefined") {
      this._viewportResizeObserver = new ResizeObserver(() => {
        this._scrollManager?.updateDimensions();
        if (this._wordWrapEnabled && this._viewportEl) {
          const newWrapCol = this._computeWrapColumn();
          // Detect wrap column change: store last used column on this._viewLines
          // which tracks _wrapColumn. If different, re-wrap.
          const currentViewWrap = this._viewLines ? (this._viewLines as any)._wrapColumn : -1;
          if (currentViewWrap >= 0 && newWrapCol !== currentViewWrap) {
            this._applyWordWrap();
          }
        }
        this._renderVisibleLines();
        this._updateHScroll();
      });
      this._viewportResizeObserver.observe(this._viewportEl);
    }

    // When the visible range changes (scroll, cursor jump), re-render selection
    // highlights for the new visible lines. This ensures that cross-range selection
    // (e.g., Cmd+Shift+Down from line 5 to line 500) updates highlights correctly
    // when the user scrolls to view different parts of the selection.
    // Line-number columns scroll natively (they share the viewport's scroll
    // container with the text) — only the label BAND gets repainted here as
    // lines enter/leave the window.

    this._viewLines.onVisibleRangeChanged = (startLine: number, endLine: number) => {
      // Re-paint the gutter band for the new visible range (both columns).
      this._syncGutterBand(startLine, endLine);
      // Re-render selection highlights for the new visible lines (all cursors)
      this._renderSelectionHighlights(
        this._cursorController?.getAllCursors().map((c) => ({
          selectionStartLineNumber: c.selectionAnchor.lineNumber,
          selectionStartColumn: c.selectionAnchor.column,
          positionLineNumber: c.position.lineNumber,
          positionColumn: c.position.column,
        })),
      );
      // Keep search-result highlights in sync with the visible band.
      this._renderFindHighlights();
      // Keep inline-diff row tints in sync with the visible band.
      this._updateInlineHighlights();
    };

    // Wire up formatter to status bar
    this._wireFormatter();
    // Wire up the in-editor find bar to the status bar
    this._wireFind();

    // Wire up ViewModel events → ViewLines
    this._viewModel.onDidChange.event((event: ViewModelEvent) => {
      this._onViewModelChange(event);
    });

    // Wire up cursor events → view updates
    this._cursorController.onDidChange = (event) => {
      this._onCursorChange(event);
    };

    // Wire up ViewLines render callback
    this._viewLines.onLineRender = (lineNumber, viewLine) => {
      this._renderLineContent(lineNumber, viewLine);
    };

    // Initial render is intentionally token-free: paint plain lines now and
    // let the rAF catch-up tokenize the visible range (never block first paint
    // on TextMate — see _asyncTokenizeVisible and _applyLanguageToCurrentModel).

    // Record the saved version for dirty-state detection (no full-string copy).
    this._dirtyTracker.reset();
    this._dirtyTracker.markSaved(model.versionId);

    // Set initial status bar state
    this._updateStatusBarSize();
    if (this._statusBar) {
      this._statusBar.setDirty(false);
      // Word wrap is PER-FILE: a saved override for this path wins, otherwise
      // the Editor-settings default applies (no more extension-global key).
      const wordWrapOn = this._resolveWordWrap();
      this._wordWrapEnabled = wordWrapOn;
      this._statusBar.setWordWrap(wordWrapOn, (on: boolean) => this._toggleWordWrap(on));
      this._applyWordWrap();
    }

    // Render initial visible lines
    this._renderVisibleLines();
    const initialLineCount = Math.min(model.lineCount, 100);
    this._syncGutterBand(1, initialLineCount);

    // Listen for model content changes (edits, undo, redo)
    model.onDidChangeContent((event: TextContentChangeEvent) => {
      // An undo/redo back to the pristine document fires with versionId 0;
      // still process it so dirty state stays correct.
      if (event.versionId > 0 || event.isUndoing || event.isRedoing) {
        this._onModelContentChange(event);
      }
    });

    // Listen for external dirty state changes (e.g., save in another tab).
    // The model fires isDirty=true when an edit makes it dirty, and
    // isDirty=false when markClean() is called from any tab.
    // When the model is marked clean remotely, all tabs viewing this model
    // must update their local dirty state and saved content baseline so the
    // confirmation modal doesn't appear when closing the tab.
    model.onDidChangeDirty((isDirty: boolean) => {
      if (isDirty) {
        // Model became dirty — handled by _onModelContentChange above
        return;
      }
      // Model was marked clean by a save in this or another tab.
      // Record the current version so future edits correctly detect clean
      // state against the persisted baseline.
      this._isDirty = false;
      this._dirtyTracker.markSaved(model.versionId);
      this._dispatchDirtyChanged(false);
      if (this._statusBar) {
        this._statusBar.setDirty(false);
      }
    });

    // Measure the whole file synchronously so the horizontal scrollbar is the
    // correct size from the start (a single full pass is <10ms even for 3MB
    // documents). Edits only re-measure touched lines — see
    // _handleContentWidthChange.
    this._lineWidthTracker.reset();
    this._lineWidthTracker.measureRange(1, model.lineCount);
    this._refreshContentWidth();
    // Size the line-numbers gutter to the file's line count (and refresh it
    // whenever the model is (re)loaded).
    this._applyGutterWidth();
    this._attachVerticalScrollbar();

    // Do NOT focus the textarea here. Opening a file (e.g. from the Explorer)
    // must not steal focus or place a caret — the user keeps focus where it
    // is (e.g. to keep arrow-navigating) and only gets an editable caret by
    // explicitly clicking/type-tabbing into the editor.
  }

  private _computeBracketDepths(startLine: number, endLine: number): void {
    if (!this._viewModel) {
      this._bracketDepths = null;
      return;
    }

    // Avoid recomputing if the range hasn't changed
    if (
      this._bracketDepths !== null &&
      this._bracketRangeStart === startLine &&
      this._bracketRangeEnd === endLine
    ) {
      return;
    }

    // Build input lines for the bracket pair service
    const lines: BracketLineInput[] = [];
    for (let ln = startLine; ln <= endLine; ln++) {
      lines.push({
        lineNumber: ln,
        text: this._viewModel.getLineContent(ln),
        // Cache-only: never tokenize inside the render path. Lines still
        // awaiting tokens contribute plain-text heuristics; once the async
        // catch-up tokenizes them this map is recomputed before re-render.
        tokens: this._viewModel.getLineTokensIfCached(ln),
      });
    }

    this._bracketDepths = this._bracketPairService.compute(lines);
    this._bracketRangeStart = startLine;
    this._bracketRangeEnd = endLine;
  }

  private _renderLineContent(lineNumber: number, viewLine: any): void {
    if (!this._viewModel) return;

    const content = this._viewModel.getLineContent(lineNumber);
    // Cache-only access so painting never blocks on TextMate; uncached lines
    // draw as plain text and are highlighted by the async catch-up pass.
    const tokens = this._viewModel.getLineTokensIfCached(lineNumber);
    this._noteRenderedLineTokens(tokens);
    // For a collapsed bracket block, drop the block's opening bracket from the
    // rendered content so the grey `{ … }` summary can present it together with
    // the block metadata (matching the JSON editor's collapsed-row treatment).
    const foldInfo = this._foldSummaryAt(lineNumber);
    viewLine.setContent(
      foldInfo ? foldInfo.prefix : content,
      tokens,
      this._viewModel.tabSize,
      this._bracketDepths,
    );
    this._applyFoldSuffix(lineNumber, viewLine, foldInfo);
  }

  /**
   * Render (or clear) the inline grey fold-summary suffix on a collapsed
   * block's header line. The line DOM is recreated on every visible-range
   * rebuild, so this both appends and removes the span defensively.
   */
  private _applyFoldSuffix(
    lineNumber: number,
    viewLine: any,
    foldInfo: { prefix: string; meta: string } | null,
  ): void {
    void lineNumber;
    const el = viewLine.domNode.element as HTMLElement;
    let span = el.querySelector<HTMLSpanElement>(":scope > .fe-fold-ellipsis");
    if (foldInfo) {
      if (!span) {
        span = document.createElement("span");
        span.className = "fe-fold-ellipsis";
        el.appendChild(span);
      }
      span.textContent = foldInfo.meta;
    } else if (span) {
      span.remove();
    }
  }

  /**
   * The inline fold summary for a collapsed header line, or null when the line
   * is not a collapsed fold. Returns the content `prefix` to render (the block
   * header without its opening bracket, so the grey suffix can re-present it)
   * and the grey `meta` suffix (the collapsed object's size/type summary in
   * place of the previous bare ellipsis).
   */
  private _foldSummaryAt(line: number): { prefix: string; meta: string } | null {
    if (!this._foldEnabled || !this._collapsedHeaders.has(line) || !this._viewModel) return null;
    const region = this._foldRegionAt(line);
    if (!region) return null;
    const content = this._viewModel.getLineContent(line);
    const closing = this._viewModel.getLineContent(region.endLine).trim();
    const isObject = closing.startsWith("}");
    const isArray = closing.startsWith("]");
    const hidden = region.endLine - region.startLine;
    const fallbackMeta = ` \u2026 ${hidden} line${hidden === 1 ? "" : "s"}`;
    // Bracket block (object or array): re-present the opening bracket, the
    // size/type summary, and the closing bracket all in the grey suffix.
    if (isObject || isArray) {
      const openCh = isObject ? "{" : "[";
      // The block-opening bracket is the last one on the header (e.g. `{` in
      // `"build": {`), which is also the one the fold region closes.
      const idx = content.lastIndexOf(openCh);
      if (idx >= 0) {
        const summary = this._summarizeBlock(region, isObject);
        if (summary) {
          return {
            prefix: content.slice(0, idx),
            meta: `${openCh} ${summary} ${closing[0]}${closing.slice(1)}`,
          };
        }
      }
    }
    // Non-bracket (indent-only) fold, or a header we couldn't parse: show the
    // hidden line span as the metadata.
    return { prefix: content, meta: fallbackMeta };
  }

  /**
   * A JSON-editor-style summary of a collapsed block: the number of direct
   * properties/items plus a breakdown of their value types ("2 properties ·
   * 1 object"). Returns null when the block has no direct children (falls back
   * to a line count elsewhere).
   */
  private _summarizeBlock(region: FoldRegion, isObject: boolean): string | null {
    if (!this._viewModel) return null;
    const bodyStart = region.startLine + 1;
    const bodyEnd = region.endLine - 1;
    // Direct children sit at the block's child indent (the minimum indentation
    // among the non-blank body lines), minus the dedent closers.
    let childIndent = Infinity;
    const entries: { text: string; indent: number }[] = [];
    for (let l = bodyStart; l <= bodyEnd; l++) {
      const text = this._viewModel.getLineContent(l);
      if (/^\s*$/.test(text)) continue;
      const ind = this._indentOf(l);
      entries.push({ text, indent: ind });
      if (ind < childIndent) childIndent = ind;
    }
    if (!Number.isFinite(childIndent)) return null;
    const children = entries.filter(
      (e) => e.indent === childIndent && !/^[}\])]/.test(e.text.trim()),
    );
    if (children.length === 0) return null;
    const counts: Record<string, number> = {
      string: 0,
      number: 0,
      boolean: 0,
      object: 0,
      array: 0,
      null: 0,
    };
    for (const c of children) {
      const t = this._classifyEntry(c.text, isObject);
      if (t in counts) counts[t]++;
    }
    const parts: string[] = [];
    if (isObject) {
      parts.push(`${children.length} propert${children.length === 1 ? "y" : "ies"}`);
    } else {
      parts.push(`${children.length} item${children.length === 1 ? "" : "s"}`);
    }
    for (const k of ["string", "number", "boolean", "object", "array", "null"]) {
      if (counts[k]) parts.push(`${counts[k]} ${k}${counts[k] === 1 ? "" : "s"}`);
    }
    return parts.join(" \u00b7 ");
  }

  /** Roughly classify a single entry's value type for the fold summary. */
  private _classifyEntry(text: string, isObject: boolean): string {
    let value = text.trim().replace(/[,;]$/, "");
    if (isObject) {
      const colon = value.indexOf(":");
      if (colon < 0) return "other";
      value = value.slice(colon + 1).trim();
    }
    if (value.startsWith('"') || value.startsWith("'")) return "string";
    if (value.startsWith("{")) return "object";
    if (value.startsWith("[")) return "array";
    if (value === "true" || value === "false") return "boolean";
    if (value === "null") return "null";
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return "number";
    return "other";
  }

  /**
   * Called whenever a rendered line's tokens were read. Flags lines that are
   * not yet tokenized and schedules the async highlight pass for them (both
   * wrapped and non-wrapped render paths funnel through this).
   */
  private _noteRenderedLineTokens(tokens: IToken[] | null): void {
    if (tokens !== null || !this._viewModel?.hasTokenizer) return;
    if (!this._renderHadUncachedTokens) {
      this._renderHadUncachedTokens = true;
      this._scheduleAsyncTokenize();
    }
  }

  private _renderVisibleLines(): void {
    if (this._paused) return; // suspended — never render a hidden editor
    if (!this._viewLines || !this._viewModel) return;

    const viewportEl = this._viewportEl;
    const scrollTop = viewportEl.scrollTop;
    const viewportHeight = viewportEl.clientHeight;

    // Compute bracket depths BEFORE rendering lines so the depth map
    // is available when _renderLineContent is called for each line.
    // Use the same range formula as ViewLines.onScroll() so all lines
    // that will be rendered are covered by the depth map.
    const lineHeight = this._lineHeight;
    const overRenderAbove = 1;
    const overRenderBelow = 2;
    const estimatedStart = Math.max(1, Math.floor(scrollTop / lineHeight) - overRenderAbove + 1);
    const estimatedEnd = Math.min(
      this._viewModel.lineCount,
      Math.ceil((scrollTop + viewportHeight) / lineHeight) + overRenderBelow,
    );
    this._computeBracketDepths(estimatedStart, estimatedEnd);

    this._viewLines.onScroll(scrollTop, viewportHeight);
    // Keep the inline-diff row tints aligned with the newly visible band.
    this._updateInlineHighlights();
  }

  /**
   * Compute the visible-column count for a line (tab-expanded).
   */
  private _computeVisibleColumns(lineContent: string, tabSize: number): number {
    let cols = 0;
    for (let i = 0; i < lineContent.length; i++) {
      if (lineContent.charCodeAt(i) === 9 /* Tab */) {
        cols += tabSize - (cols % tabSize);
      } else {
        cols++;
      }
    }
    return cols;
  }

  /**
   * Measure the actual pixel width of one monospace character from the DOM.
   * Creates a temporary test span, measures it, and removes it.
   */
  private _measureCharWidth(): number {
    // The viewport is created in firstUpdated(). Before that (e.g. when the
    // file-editor-controller applies editor settings synchronously during
    // mount(), before Lit's first update), _viewportEl is undefined and there
    // is nothing to measure. Returning 0 keeps callers safe — the char width
    // is re-measured once the viewport exists (firstUpdated applies the stored
    // _fontSize and the model load path measures via _refreshContentWidth).
    if (!this._viewportEl) return 0;
    const testEl = document.createElement("span");
    testEl.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font-size:inherit;font-family:inherit;";
    testEl.textContent = "x".repeat(100);
    this._viewportEl.appendChild(testEl);
    const w = testEl.scrollWidth / 100;
    this._viewportEl.removeChild(testEl);
    return w;
  }

  /**
   * Width of the line-numbers gutter, decided by the number of lines in the
   * file. Line numbers are right-aligned, so the column only needs to be wide
   * enough for the widest number plus its padding: a file with up to 99 lines
   * needs room for 2 digits, up to 999 for 3, and so on. Because this depends
   * on the file's line count, different files get a different gutter width.
   */
  private _computeGutterWidth(lineCount: number): number {
    const charW = this._charWidth > 0 ? this._charWidth : 8;
    const digits = Math.max(1, String(Math.max(1, lineCount)).length);
    // digits * charWidth + 8px left gap + 8px right padding.
    return Math.ceil(digits * charW) + 16;
  }

  /** Recompute and apply the line-numbers gutter width for the current file.
   * No-op when an inline diff is active (setInlineDiff owns the widths there). */
  private _applyGutterWidth(): void {
    if (!this._viewModel || this._inlineRows) return;
    this._gutterRightWidth = this._computeGutterWidth(this._viewModel.lineCount);
    this._gutterLeftWidth = 0;
    this._gutter?.reflow();
  }

  /**
   * Refresh the viewport's content (horizontal scrollbar) width from the
   * line-width tracker. O(1) per call: the tracker measures only the first
   * batch on load and refines in background idle batches, so this never scans
   * every line synchronously (see large-file-performance plan, Phase 1A).
   */
  private _refreshContentWidth(): void {
    if (!this._viewModel || !this._viewLines) return;

    const lineCount = this._viewModel.lineCount;
    if (lineCount === 0) {
      this._viewLines.setContentWidth(this._viewportEl.getBoundingClientRect().width);
      this._updateHScroll();
      return;
    }

    const charWidth = this._charWidth > 0 ? this._charWidth : this._measureCharWidth();
    if (charWidth > 0) this._charWidth = charWidth;

    const maxCols = this._lineWidthTracker.maxColumns;
    if (maxCols > 0) {
      // Convert to pixel width: cols * charWidth + left offset (8px) + right gap (8px).
      // While the background scan is pending, maxCols is approximate and the
      // scrollbar refines as batches complete.
      this._viewLines.setContentWidth(Math.ceil(maxCols * charWidth + 16));
    } else {
      // Nothing measured yet — fall back to the viewport width.
      this._viewLines.setContentWidth(this._viewportEl.getBoundingClientRect().width);
    }
    this._updateHScroll();
  }

  /** Width of a single line in visible columns — the tracker's measure function. */
  private _measureLineColumns(lineNumber: number): number {
    if (!this._viewModel) return 0;
    const content = this._viewModel.getLineContent(lineNumber);
    return this._computeVisibleColumns(content, this._viewModel.tabSize);
  }

  /**
   * Update the width tracker after a model content change. The scrollbar stays
   * exact immediately: same-line edits re-measure only touched lines;
   * line insert/delete re-measures the shifted tail synchronously.
   */
  private _handleContentWidthChange(event: TextContentChangeEvent): void {
    if (!this._viewModel) return;

    let structural = false; // any change that inserted/removed lines
    let minLine = Infinity;
    for (const change of event.changes) {
      const start = change.range.startLineNumber;
      const added = this._countInsertedLines(change.text);
      if (change.range.endLineNumber - start !== added) structural = true;
      if (start < minLine) minLine = start;
    }

    // Update the width tracker after a model content change. The scrollbar
    // must stay exact immediately:
    //   - line insert/delete: the tail from the first affected line shifts, so
    //     re-measure that tail synchronously (cheap) and drop stale cache.
    //   - same-line edit: re-measure only the touched line(s); if a touched
    //     line was the running max and shrank, recompute from the cache.
    if (minLine === Infinity) {
      // Degenerate event without usable range info — rescan everything.
      this._lineWidthTracker.measureRange(1, this._viewModel.lineCount);
      this._refreshContentWidth();
      return;
    }

    if (structural) {
      this._lineWidthTracker.invalidateFrom(minLine);
      this._lineWidthTracker.measureRange(minLine, this._viewModel.lineCount);
    } else {
      // Same-line edit(s): only the touched lines change, so re-measure just
      // those. If a touched line was the running max and may have shrunk,
      // recompute the max from the cache.
      for (const change of event.changes) {
        const start = change.range.startLineNumber;
        for (let line = start; line <= start + this._countInsertedLines(change.text); line++) {
          const wasMaxCandidate =
            (this._lineWidthTracker.get(line) ?? -1) >= this._lineWidthTracker.maxColumns;
          this._lineWidthTracker.measure(line);
          if (wasMaxCandidate) this._lineWidthTracker.recomputeMax();
        }
      }
    }

    this._refreshContentWidth();
  }

  private _countInsertedLines(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) count++;
    }
    return count;
  }

  /** Human-readable byte size (KB/MB/GB) for the too-large message. */
  private _formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    const digits = Math.round(value) === value ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unit]}`;
  }

  /** Set the default word wrap for files with no per-file preference (from
   * the Editor settings tab). A file with a saved per-file override is left
   * untouched. If this editor is loaded and has no override, re-applies live. */
  setWordWrapDefault(enabled: boolean): void {
    this._wordWrapDefault = enabled;
    if (this._viewModel && !this._hasPerFileWrapOverride()) {
      this._wordWrapEnabled = enabled;
      this._statusBar?.setWordWrap(enabled, (on: boolean) => this._toggleWordWrap(on));
      this._applyWordWrap();
    }
  }

  /** Stored per-file wrap preference for this path, or null when absent. */
  private _savedFileWrap(): boolean | null {
    if (!this.filePath) return null;
    try {
      const stored = localStorage.getItem("openp41ge:wordWrap:path:" + this.filePath);
      return stored === null ? null : stored === "true";
    } catch {
      return null; // localStorage may be unavailable
    }
  }

  /** True when this file has an explicit per-file wrap preference. */
  private _hasPerFileWrapOverride(): boolean {
    return this._savedFileWrap() !== null;
  }

  /** Per-file override when present, otherwise the editor default. */
  private _resolveWordWrap(): boolean {
    return this._savedFileWrap() ?? this._wordWrapDefault;
  }

  /** Toggle word wrap on/off for THIS file and persist the per-file choice. */
  private _toggleWordWrap(enabled: boolean): void {
    this._wordWrapEnabled = enabled;
    if (this.filePath) {
      try {
        localStorage.setItem(
          "openp41ge:wordWrap:path:" + this.filePath,
          enabled ? "true" : "false",
        );
      } catch {
        // localStorage may be unavailable in some contexts
      }
    }
    this._applyWordWrap();
  }

  /** Compute the wrap column from the viewport width and character width. */
  private _computeWrapColumn(): number {
    const cw = this._charWidth > 0 ? this._charWidth : 8;
    const vw = this._viewportEl?.clientWidth ?? 600;
    return this._wrapCalculator.compute(vw, 0, 16, cw);
  }

  /** Apply word wrap state to the viewport. */
  private _applyWordWrap(): void {
    if (!this._viewportEl) return;
    if (this._wordWrapEnabled) {
      this._viewportEl.style.overflowX = "hidden";
    } else {
      this._viewportEl.style.overflowX = "auto";
    }
    const wrapColumn = this._computeWrapColumn();
    if (this._viewModel) {
      this._viewModel.setWordWrap(this._wordWrapEnabled, wrapColumn);
    }
    if (this._viewLines) {
      this._viewLines.setWordWrap(this._wordWrapEnabled, wrapColumn);
      this._viewLines.rebuildAll();
      // Refresh the scrollbar from the width tracker (already measured or
      // being measured in the background).
      this._refreshContentWidth();
      this._syncCursorView();
    }
    // After a wrap toggle the number of model lines that fit the viewport
    // changes, so the gutter band must be recomputed. When wrapping is ON we
    // expand the range so the numbers reach across the whole (wrapped)
    // document; when OFF we re-sync to the view's current visible model range.
    // `rebuildAll()` in non-wrapped mode does not emit `onVisibleRangeChanged`
    // (and `onScroll` may no-op when the computed range is unchanged), so
    // without this the gutter keeps its pre-toggle (wrapped) entry set and the
    // lines at the bottom of the viewport render without numbers until the
    // next scroll event.
    if (this._wordWrapEnabled && this._viewModel) {
      this._syncGutterBand(1, Math.min(this._viewModel.lineCount, 500));
    } else if (this._viewLines && this._viewModel) {
      this._viewLines.onScroll(this._viewportEl.scrollTop, this._viewportEl.clientHeight);
      const start = this._viewLines.startLineNumber || 1;
      const end = this._viewLines.endLineNumber || this._viewModel.lineCount;
      this._syncGutterBand(start, end);
    }
    this._updateHScroll();
  }

  /** Wire up formatter registry to the status bar format button. */
  private _wireFormatter(): void {
    if (!this._statusBar) return;
    const ext = this.filePath.split(".").pop()?.toLowerCase() || "";
    const formatter = this.formatterRegistry?.get(ext) ?? null;
    if (formatter) {
      this._statusBar.setFormatter(() => this.formatDocument());
    } else {
      this._statusBar.clearFormatter();
    }
  }

  // ═══ In-editor find (Cmd/Ctrl+F) + external highlight source ────────────

  /**
   * The winning search source: an ACTIVE built-in find wins; otherwise an
   * external highlight source (e.g. the Git sidebar's current query) applies.
   * One owner prevents built-in and external highlights fighting over the
   * single FindMatchRenderer.
   */
  private _activeSourceQuery(): {
    query: string;
    regex: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
  } {
    if (this._findOpen && this._findQuery.trim()) {
      return {
        query: this._findQuery,
        regex: this._findRegex,
        caseSensitive: this._findCase,
        wholeWord: this._findWholeWord,
      };
    }
    if (this._externalHighlight && this._externalHighlight.query.trim()) {
      return {
        query: this._externalHighlight.query,
        regex: this._externalHighlight.regex ?? false,
        caseSensitive: this._externalHighlight.caseSensitive ?? false,
        wholeWord: this._externalHighlight.wholeWord ?? false,
      };
    }
    return { query: "", regex: false, caseSensitive: false, wholeWord: false };
  }

  private _openFind(): void {
    this._findOpen = true;
    this._statusBar?.openFind();
    // Recompute (re-opens with the last query, if any) and refresh the count.
    this._refreshFindMatches();
    // Focus AFTER Lit has rendered the find input (openFind just marks state;
    // the DOM node exists on the next tick).
    setTimeout(() => this._statusBar?.focusFind(), 0);
  }

  private _closeFind(): void {
    this._findOpen = false;
    this._statusBar?.closeFind();
    this._statusBar?.setFindCount("");
    // Re-derive the winning source: an external highlight (if any) resumes,
    // otherwise the highlight is dropped while the query itself is kept in the
    // status bar so Cmd+F re-opens with it.
    this._refreshFindMatches();
  }

  /**
   * External highlight source API — highlights matches from OUTSIDE the
   * built-in find without opening the bar (e.g. the Git sidebar commit search
   * carries its query onto an opened file). Call again to refresh, or pass an
   * empty query to clear.
   */
  setSearchHighlight(
    query: string,
    options?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean },
    activeIndex?: number,
  ): void {
    this._externalHighlight = query.trim()
      ? {
          query,
          regex: options?.regex ?? false,
          caseSensitive: options?.caseSensitive ?? false,
          wholeWord: options?.wholeWord ?? false,
        }
      : null;
    this._refreshFindMatches();
    // Emphasise a specific instance (e.g. an Explorer content-match row that
    // was just clicked) rather than defaulting to the first match.
    if (typeof activeIndex === "number" && activeIndex >= 0) {
      this._setActiveFindIndex(activeIndex);
    }
  }

  /** Make the match at `index` the emphasised/navigated one and reveal it. */
  private _setActiveFindIndex(index: number): void {
    if (this._findMatches.length === 0) return;
    this._findActiveIndex = Math.max(0, Math.min(index, this._findMatches.length - 1));
    if (this._findOpen) {
      this._statusBar?.setFindCount(`${this._findActiveIndex + 1}/${this._findMatches.length}`);
    }
    this._renderFindHighlights();
    const current = this._findMatches[this._findActiveIndex];
    if (current) this._scrollToMatch(current);
  }

  clearSearchHighlight(): void {
    this._externalHighlight = null;
    this._refreshFindMatches();
  }

  /**
   * Move the primary cursor to a 1-based line/column and scroll it into view.
   * Used to open a file at a specific content-search match instance via the
   * platform's open-file handler.
   */
  revealLine(lineNumber: number, column?: number): void {
    if (!this._cursorController) return;
    const line = Math.max(1, lineNumber);
    const col = column && column > 0 ? column : 1;
    this._cursorController.moveTo(line, col);
    this._scrollToRevealCursor();
  }

  private _wireFind(): void {
    if (!this._statusBar) return;
    const bar = this._statusBar;
    bar.onFindOpen = () => this._openFind();
    bar.onFindInput = (value) => {
      this._findQuery = value;
      this._refreshFindMatches();
    };
    bar.onFindNext = () => this._findNext(1);
    bar.onFindPrev = () => this._findNext(-1);
    bar.onFindClose = () => this._closeFind();
    bar.onFindRegex = (on) => {
      this._findRegex = on;
      this._refreshFindMatches();
    };
    bar.onFindCase = (on) => {
      this._findCase = on;
      this._refreshFindMatches();
    };
    bar.onFindWholeWord = (on) => {
      this._findWholeWord = on;
      this._refreshFindMatches();
    };
  }

  /** Recompute the active source's matches and re-render. */
  private _refreshFindMatches(): void {
    const source = this._activeSourceQuery();
    if (!source.query.trim() || !this._viewModel) {
      this._findMatches = [];
      this._findActiveIndex = -1;
      this._statusBar?.setFindCount("");
      this._renderFindHighlights();
      return;
    }
    const finder = new FindInEditor(this._viewModel.model);
    const matches = finder.find(source.query, {
      regex: source.regex,
      caseSensitive: source.caseSensitive,
      wholeWord: source.wholeWord,
    });
    this._findMatches = matches;
    this._findActiveIndex = matches.length > 0 ? 0 : -1;
    if (this._findOpen) {
      this._statusBar?.setFindCount(
        matches.length > 0 ? `${this._findActiveIndex + 1}/${matches.length}` : "no results",
      );
    }
    this._renderFindHighlights();
  }

  /** Move to the next/previous match (wraps) and reveal it. */
  private _findNext(direction: number): void {
    if (this._findMatches.length === 0) return;
    this._findActiveIndex =
      (this._findActiveIndex + direction + this._findMatches.length) % this._findMatches.length;
    if (this._findOpen) {
      this._statusBar?.setFindCount(`${this._findActiveIndex + 1}/${this._findMatches.length}`);
    }
    this._renderFindHighlights();
    const current = this._findMatches[this._findActiveIndex];
    if (current) this._scrollToMatch(current);
  }

  private _scrollToMatch(match: FindMatch): void {
    if (!this._viewModel || !this._viewportEl) return;
    const viewLine = this._wordWrapEnabled
      ? this._viewModel.coordinatesConverter.convertModelToViewPosition(
          match.lineNumber,
          match.column,
        ).lineNumber
      : match.lineNumber;
    const top = (viewLine - 1) * this._lineHeight;
    const viewTop = this._viewportEl.scrollTop;
    const viewBottom = viewTop + this._viewportEl.clientHeight;
    if (top < viewTop || top + this._lineHeight > viewBottom) {
      this._viewportEl.scrollTop = Math.max(
        0,
        top - this._viewportEl.clientHeight / 2 + this._lineHeight / 2,
      );
    }
  }

  /** Paint the matched spans for the visible band (word-wrap aware). */
  private _renderFindHighlights(): void {
    if (!this._findRenderer || !this._viewLines || !this._viewModel) return;
    if (this._findMatches.length === 0) {
      this._findRenderer.clear();
      return;
    }
    const startLine = this._viewLines.startLineNumber || 1;
    const endLine = this._viewLines.endLineNumber || Math.min(50, this._viewModel.lineCount);
    const cw = this._charWidth > 0 ? this._charWidth : 8;
    const leftOffset = 8;
    const converter = this._wordWrapEnabled
      ? (this._viewModel.coordinatesConverter as IFindViewConverter)
      : null;
    const spans = toFindViewSpans(this._findMatches, converter, this._findActiveIndex);
    this._findRenderer.renderFind({
      spans,
      visibleStartLine: startLine,
      visibleEndLine: endLine,
      lineHeight: this._lineHeight,
      getColumnPixel: (_line, column) => {
        const lx = leftOffset + (column - 1) * cw;
        return { x: lx, width: cw };
      },
    });
  }

  /**
   * Force a full re-render of the visible window from the current model state.
   * Shares one code path across the normal content-change handler and resume
   * after being hidden (see setActive / _resumeWork).
   */
  private _reRenderAll(): void {
    if (!this._viewLines || !this._viewModel) return;

    // Clear content caches FIRST. In wrapped mode this resets the wrap index;
    // doing it before setTotalLineCount means the scroll-height update below
    // (via _updateScrollHeight -> totalViewLineCount) re-measures against the
    // NEW content instead of stale per-line wrap-segment counts from the
    // previous document (which otherwise leaves the scrollbar short by the
    // difference between old and new segment counts).
    this._viewLines.clearContentCache();
    this._bracketDepths = null;
    this._bracketRangeStart = 0;
    this._bracketRangeEnd = 0;

    // Update line count (this also updates scroll height)
    this._viewLines.setTotalLineCount(this._viewModel.lineCount);

    // A line insert/delete can change the size of the largest line number, so
    // re-size the line-numbers gutter to the current file's line count.
    this._applyGutterWidth();

    // Pre-compute bracket depths BEFORE rendering so they're available
    // when onLineRender fires during onScroll/refresh.
    this._computeBracketDepths(
      this._viewLines.startLineNumber || 1,
      this._viewLines.endLineNumber || Math.min(50, this._viewModel.lineCount),
    );
    this._viewLines.onScroll(this._viewportEl.scrollTop, this._viewportEl.clientHeight);

    // Force-rebuild visible lines regardless of whether onScroll() was
    // skipped by the guard. This ensures content is re-rendered even when
    // the visible range hasn't changed numerically but the content has.
    // We use refresh() instead of _renderVisibleLines() because the latter
    // also goes through onScroll() and would hit the same guard.
    this._viewLines.refresh();

    // Ensure line numbers reflect the new line count and visible range.
    // If onScroll() fired onVisibleRangeChanged, this is redundant but harmless.
    // If onScroll() was skipped by the guard, this ensures the overlay is
    // still in sync (e.g., line count changed but visible range didn't).
    // We do NOT call _syncCursorView() here because cursor position changes
    // are already handled by _onCursorChange for local edits. Calling it here
    // would place an unwanted cursor in inactive tabs sharing this model.
    if (this._viewLines.startLineNumber && this._viewLines.endLineNumber) {
      this._syncGutterBand(this._viewLines.startLineNumber, this._viewLines.endLineNumber);
    }
  }

  private _onViewModelChange(event: ViewModelEvent): void {
    if (this._paused) {
      // Suspended (hidden tab): content changed — remember it so _resumeWork
      // refreshes the visible window when the tab is shown again. Skipping the
      // re-render here is the core of the pause: hidden editors stop paying the
      // full per-edit render cost while another tab edits the shared model.
      if (event.contentChanged) this._pausedContentChanged = true;
      return;
    }
    this._reRenderAll();
  }

  private _onCursorChange(event: any): void {
    if (!this._viewModel || !this._viewLines) return;

    if (event.type === "edit" || event.type === "undo" || event.type === "redo") {
      // After edit, content changed — recompute bracket depths and
      // force-rebuild visible lines.
      // Must use refresh(), not _renderVisibleLines(): the latter calls
      // _viewLines.onScroll() which skips if visible range hasn't changed.
      this._bracketDepths = null;
      this._bracketRangeStart = 0;
      this._bracketRangeEnd = 0;
      this._computeBracketDepths(
        this._viewLines.startLineNumber || 1,
        this._viewLines.endLineNumber || Math.min(50, this._viewModel.lineCount),
      );
      this._viewLines.refresh();
    }

    this._syncCursorView();
    this._scrollToRevealCursor();
  }

  private _onModelContentChange(event: TextContentChangeEvent): void {
    // Dirty state via O(1) version comparison (no full-string compare).
    // Correct because the model restores versionId on undo/redo, so undoing
    // back to the saved document version reports clean.
    const model = this.textContentModel;
    if (model) {
      const isDirty = this._dirtyTracker.notifyContentChanged(model.versionId);
      const wasDirty = this._isDirty;
      this._isDirty = isDirty;
      if (wasDirty !== this._isDirty) {
        this._dispatchDirtyChanged(this._isDirty);
        if (this._statusBar) {
          this._statusBar.setDirty(this._isDirty);
        }
      }
    }

    // Update file size display
    this._updateStatusBarSize();

    // Hidden editors don't measure/re-render, but they must still track dirty
    // state (tab handle dot, close confirmation) and record that the content
    // changed so the view refreshes when the tab is shown again.
    if (this._paused) {
      this._pausedContentChanged = true;
      return;
    }

    // Incrementally update content width — only the affected lines are
    // re-measured; line insert/delete hands the rescan to the background.
    this._handleContentWidthChange(event);

    // Content changed → previously computed search matches are stale.
    this._refreshFindMatches();

    // Fold regions may have shifted after an edit; recompute (keeps the hidden
    // set current without collapsing anything the user didn't collapse).
    this._scheduleFoldRecompute();
  }

  /** Debounced recompute + re-apply of fold regions after a content change. */
  private _scheduleFoldRecompute(): void {
    if (!this._foldEnabled) return;
    if (this._foldRecomputeFrame !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      this._computeFolds();
      this._applyFolds();
      return;
    }
    this._foldRecomputeFrame = requestAnimationFrame(() => {
      this._foldRecomputeFrame = null;
      this._computeFolds();
      this._applyFolds();
    });
  }

  /**
   * Sync the cursor and selection visuals with the model state.
   *
   * @param shouldScroll - When true (default), scroll the viewport if the
   *   cursor is outside the visible range. Pass false for mouse clicks,
   *   where the user clicked on a position that is already visible.
   */
  private _syncCursorView(): void {
    if (!this._cursorController || !this._cursorRenderer || !this._viewModel) return;

    const allCursors = this._cursorController.getAllCursors();
    const cw = this._charWidth > 0 ? this._charWidth : 8;
    const leftOffset = 8;

    // Sync cursor renderer element count with cursor count
    this._cursorRenderer.syncCursorCount(allCursors.length);

    // Position each cursor caret (accounting for word wrap)
    const converter = this._wordWrapEnabled ? this._viewModel.coordinatesConverter : null;
    for (let i = 0; i < allCursors.length; i++) {
      const c = allCursors[i];
      let viewLine = c.position.lineNumber;
      let viewCol = c.position.column;
      if (converter) {
        const vp = converter.convertModelToViewPosition(c.position.lineNumber, c.position.column);
        viewLine = vp.lineNumber;
        viewCol = vp.column;
      }
      const x = leftOffset + (viewCol - 1) * cw;
      const y = (viewLine - 1) * this._lineHeight;
      this._cursorRenderer.positionAt(x, y, this._lineHeight, i);
    }
    // Only the focused editor may show carets — and read-only editors never
    // do. A view sync must never resurrect them while this editor is blurred
    // (e.g. initial render, a cursor move or model change in a background tab)
    // — onBlur hid them; refocus re-shows via onFocus. This preserves
    // multi-carets: they stay created/positioned and are only shown/hidden as
    // a group.
    if (this._isFocused && !this._readOnly) {
      this._cursorRenderer.show();
    }

    // Dispatch cursor position for the app bottom bar (primary cursor)
    const pos = this._cursorController.position;
    this.dispatchEvent(
      new CustomEvent("fe:cursor-changed", {
        bubbles: true,
        composed: true,
        detail: { lineNumber: pos.lineNumber, column: pos.column },
      }),
    );

    // Render selection highlights for ALL cursor selections
    const allSelections = allCursors.map((c) => ({
      selectionStartLineNumber: c.selectionAnchor.lineNumber,
      selectionStartColumn: c.selectionAnchor.column,
      positionLineNumber: c.position.lineNumber,
      positionColumn: c.position.column,
    }));
    this._renderSelectionHighlights(allSelections);

    // Update line numbers (for relative mode) — based on primary cursor.
    // NOTE: refresh _selectedDiffLines BEFORE setActiveLine — that repaints
    // the AFTER labels from getLabelDecoration synchronously.
    const selected: Set<number> = new Set();
    for (const c of allCursors) {
      const a = c.selectionAnchor.lineNumber;
      const b = c.position.lineNumber;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let l = lo; l <= hi; l++) selected.add(l);
    }
    this._selectedDiffLines = selected;
    // Repaint the gutter band: in a diff view the selected rows' number cells
    // get the grey active background (done inside _gutterDataFor), and the
    // data is pulled fresh for every cell.
    this._gutter?.refresh();

    // Highlight the caret's row across EVERY gutter column (line numbers +
    // fold column), matching the JSON editor. The number column gets the grey
    // from `active-line-number`; the shared fold column (and any other shared
    // column) gets `eg-cell--active` via the host's active row, styled below.
    this._gutter?.setActiveRow(pos.lineNumber);

    // Current line highlight — based on primary cursor
    this._currentLineHighlight?.setLine(pos.lineNumber);

    // Bracket matching — based on primary cursor
    const _bracketMatch = findMatchingBracket(this._viewModel.model, pos);
    void _bracketMatch; // Future: bracket-match highlight decorations
    // For now, this just computes the match for future rendering

    // Indentation guides — based on primary cursor
    if (this._indentationGuides && this._viewLines) {
      const startLine = this._viewLines.startLineNumber || 1;
      const endLine = this._viewLines.endLineNumber || Math.min(50, this._viewModel.lineCount);
      this._indentationGuides.renderGuides(
        startLine,
        endLine,
        (line) => {
          const content = this._viewModel!.getLineContent(line);
          let indent = 0;
          for (let i = 0; i < content.length; i++) {
            if (content.charCodeAt(i) === 32) indent++;
            else if (content.charCodeAt(i) === 9) indent += 4;
            else break;
          }
          return indent;
        },
        20,
        this._textRegionEl,
      );
    }
  }

  /**
   * Scroll the viewport to reveal the cursor line, centering it roughly
   * in the middle of the viewport. Called ONLY from keyboard-triggered
   * cursor moves (arrows, Cmd+Up/Down, Home/End, PageUp/PageDown).
   * Mouse clicks never trigger this — they land on an already-visible line.
   */
  private _scrollToRevealCursor(): void {
    // Suppress scroll for events like Cmd+A (select all)
    if (this._suppressScroll) {
      this._suppressScroll = false;
      return;
    }

    if (!this._cursorController || !this._viewLines) return;

    const pos = this._cursorController.position;
    const viewportEl = this._viewportEl;
    const lineHeight = this._lineHeight;
    const viewportHeight = viewportEl.clientHeight;
    // Use view line number for pixel calculation (accounts for word wrap)
    let viewLine = pos.lineNumber;
    if (this._wordWrapEnabled && this._viewModel?.coordinatesConverter) {
      const vp = this._viewModel.coordinatesConverter.convertModelToViewPosition(
        pos.lineNumber,
        pos.column,
      );
      viewLine = vp.lineNumber;
    }
    const cursorTop = (viewLine - 1) * lineHeight;
    const currentScrollTop = viewportEl.scrollTop;
    let scrolled = false;

    if (cursorTop < currentScrollTop) {
      // Cursor is above the visible area — scroll up to reveal
      viewportEl.scrollTop = cursorTop;
      scrolled = true;
    } else if (cursorTop + lineHeight > currentScrollTop + viewportHeight) {
      // Cursor is below the visible area — scroll down to reveal
      // Show the cursor line in the middle-ish of the viewport for context
      const targetScroll = cursorTop + lineHeight - Math.floor(viewportHeight / 2);
      viewportEl.scrollTop = Math.max(0, targetScroll);
      scrolled = true;
    }

    // When we scrolled, the ViewLines' visible range still reflects the old
    // position because ScrollManager defers via requestAnimationFrame.
    // Rebuild synchronously so selection/line-number rendering is correct.
    if (scrolled && this._viewLines) {
      this._viewLines.onScroll(viewportEl.scrollTop, viewportHeight);
    }
  }

  /**
   * Render selection highlights for the currently visible lines.
   * Called from _syncCursorView (on cursor/selection changes) and from
   * onVisibleRangeChanged (on scroll).
   */
  private _renderSelectionHighlights(selections?: TextSelection[]): void {
    if (!this._selectionRenderer || !this._viewLines || !this._viewModel) return;

    const startLine = this._viewLines.startLineNumber || 1;
    const endLine = this._viewLines.endLineNumber || Math.min(50, this._viewModel.lineCount);
    const cw = this._charWidth > 0 ? this._charWidth : 8;
    const leftOffset = 8;

    // If selections not provided, compute from primary cursor
    if (!selections) {
      const sel = this._cursorController?.selection;
      if (sel) {
        selections = [sel];
      }
    }

    // Convert selections from model space to view space when word wrap is on
    const converter = this._wordWrapEnabled ? this._viewModel.coordinatesConverter : null;
    let viewSelections: TextSelection[] | undefined;
    let viewStartLine = startLine;
    let viewEndLine = endLine;

    if (converter && selections) {
      viewSelections = selections.map((s) => {
        const sv = converter.convertModelToViewPosition(
          s.selectionStartLineNumber,
          s.selectionStartColumn,
        );
        const ev = converter.convertModelToViewPosition(s.positionLineNumber, s.positionColumn);
        return {
          selectionStartLineNumber: sv.lineNumber,
          selectionStartColumn: sv.column,
          positionLineNumber: ev.lineNumber,
          positionColumn: ev.column,
        };
      });
      // Use the converter's total view line count to ensure the visible
      // range covers the full selection when word wrap is enabled.
      viewStartLine = 1;
      viewEndLine = converter.getTotalViewLineCount();
    } else {
      viewSelections = selections;
    }

    this._selectionRenderer.renderSelection(
      viewStartLine,
      viewEndLine,
      this._lineHeight,
      (_line, column) => {
        const lx = leftOffset + (column - 1) * cw;
        return { x: lx, width: cw };
      },
      (line) => {
        if (converter) {
          // In view space, get the visible segment length for this view line
          const modelLine = converter.getModelLineFromViewLine(line);
          const segments = converter.getWrapSegments(modelLine);
          if (segments && segments.length > 1) {
            const viewLineBase = converter.getViewLineFromModelLine(modelLine);
            const segIdx = line - viewLineBase;
            if (segIdx >= 0 && segIdx < segments.length) {
              return segments[segIdx].endColumn - segments[segIdx].startColumn;
            }
          }
          // Non-wrapped model line: use the resolved model line number
          return this._viewModel!.getLineContent(modelLine).length;
        }
        return this._viewModel!.getLineContent(line).length;
      },
      "#161616",
      viewSelections,
    );
  }

  /**
   * Compute the zoom factor from the viewport element.
   * getBoundingClientRect() returns visual (scaled) pixels while clientWidth
   * returns logical (pre-zoom) pixels. The ratio gives us the zoom factor.
   */
  private _getZoomFactor(): number {
    const w = this._viewportEl.clientWidth;
    if (w === 0) return 1;
    const rect = this._viewportEl.getBoundingClientRect();
    return rect.width / w;
  }

  private _onViewportMouseDown = (e: MouseEvent): void => {
    if (!this._viewModel || !this._cursorController || !this._textAreaInput) return;

    // Get click position relative to viewport
    const rect = this._viewportEl.getBoundingClientRect();
    const zoom = this._getZoomFactor();
    const clickX = (e.clientX - rect.left) / zoom;
    const clickY = (e.clientY - rect.top) / zoom;

    const pos = this._viewportPosToLineCol(clickX, clickY);
    if (!pos) return;

    if (e.altKey) {
      // Alt+Click: add a cursor at this position without moving primary
      this._cursorController.addCursorAt(pos.line, pos.col);
      this._syncCursorView();
      requestAnimationFrame(() => {
        this._textAreaInput?.focus();
      });
      return;
    }

    // Normal click: clear any secondary cursors and place primary cursor
    this._cursorController.removeSecondaryCursors();

    // Record anchor for potential drag selection
    this._mouseDownLine = pos.line;
    this._mouseDownCol = pos.col;
    this._isMouseDown = true;

    // Position cursor (collapsed selection initially).
    // Save and restore scrollTop so _syncCursorView's _scrollToRevealCursor
    // doesn't yank the viewport away from where the user is looking. Their
    // click is on a visible line — they should not be scrolled.
    const savedScrollTop = this._viewportEl.scrollTop;
    this._cursorController.moveTo(pos.line, pos.col);
    this._syncCursorView();
    this._viewportEl.scrollTop = savedScrollTop;

    // Focus the textarea for typing in the next frame
    requestAnimationFrame(() => {
      this._textAreaInput?.focus();
    });

    // Remove any previous mouse tracking listeners
    this._detachMouseSelectionListeners();

    // Track mouse drag for selection
    this._onDocumentMouseMove = (moveEvent: MouseEvent) => {
      if (!this._isMouseDown || !this._viewModel || !this._cursorController) return;

      const moveRect = this._viewportEl.getBoundingClientRect();
      const zoom = this._getZoomFactor();
      const moveX = (moveEvent.clientX - moveRect.left) / zoom;
      const moveY = (moveEvent.clientY - moveRect.top) / zoom;

      const currentPos = this._viewportPosToLineCol(moveX, moveY);
      if (!currentPos) return;

      // Extend selection from the anchor (mousedown position) to current position.
      this._cursorController.selectTo(currentPos.line, currentPos.col);
      this._syncCursorView();
    };

    this._onDocumentMouseUp = () => {
      this._isMouseDown = false;
      this._detachMouseSelectionListeners();
    };

    document.addEventListener("mousemove", this._onDocumentMouseMove);
    document.addEventListener("mouseup", this._onDocumentMouseUp);
  };

  private _detachMouseSelectionListeners(): void {
    if (this._onDocumentMouseMove) {
      document.removeEventListener("mousemove", this._onDocumentMouseMove);
      this._onDocumentMouseMove = null;
    }
    if (this._onDocumentMouseUp) {
      document.removeEventListener("mouseup", this._onDocumentMouseUp);
      this._onDocumentMouseUp = null;
    }
  }

  private _viewportPosToLineCol(
    clickX: number,
    clickY: number,
  ): { line: number; col: number } | null {
    if (!this._viewModel) return null;

    const scrollTop = this._viewportEl.scrollTop;
    const viewLine = Math.floor((clickY + scrollTop) / this._lineHeight) + 1;

    const leftOffset = 8;
    const cw = this._charWidth > 0 ? this._charWidth : 8;
    // clickX is measured from the VIEWPORT's left edge, which includes the
    // pinned line-number gutter (one or two columns) that sits to the LEFT of
    // the text region. The caret / selection / find layers all use TEXT-REGION
    // coordinates (origin = just after the gutter), so the click coordinate
    // must be shifted in by the pinned gutter width before column mapping.
    // Omitting it shifts every click right by the gutter width — which grows
    // with the number of digits (larger files) and doubles for diff views
    // (a BEFORE + AFTER column).
    const pinnedGutter = this._gutterGroupEl ? this._gutterGroupEl.offsetWidth : 0;
    const relativeX = clickX - pinnedGutter - leftOffset + this._viewportEl.scrollLeft;
    const viewCol = Math.max(0, Math.round(relativeX / cw)) + 1;

    if (this._wordWrapEnabled && this._viewModel.coordinatesConverter) {
      // Convert view coordinates to model coordinates
      const modelPos = this._viewModel.coordinatesConverter.convertViewToModelPosition(
        viewLine,
        viewCol,
      );
      return { line: modelPos.lineNumber, col: modelPos.column };
    }

    // Without word wrap: 1:1 mapping
    const lineCount = this._viewModel.lineCount;
    const clampedLine = Math.max(1, Math.min(viewLine, lineCount));
    const lineContent = this._viewModel.getLineContent(clampedLine);
    const maxCol = lineContent.length + 1;
    const clampedCol = Math.min(viewCol, maxCol);

    return { line: clampedLine, col: clampedCol };
  }

  /**
   * Attach (or re-attach) the floating vertical OverlayScrollbar to the current
   * viewport. The native vertical scrollbar reserves an 8px layout gutter, so
   * content never renders behind it. Replacing it with an overlay lets the
   * scrollbar float OVER the text: content stays visible through the
   * translucent thumb. IDEMPOTENT — destroys any existing overlay first, so it
   * can be called on every rebuild (initial mount, reconnect, font/line-height
   * change) and on every _initWithModel re-entry.
   */
  private _attachVerticalScrollbar(): void {
    this._verticalScrollbar?.destroy();
    this._verticalScrollbar = null;
    const target = this._viewportEl;
    const container = target?.parentElement;
    if (!container || !target?.isConnected) return;
    const isLight = this._theme.type === "light";
    // Match the bespoke .fe-hscroll horizontal bar: a theme-aware dark/light
    // thumb, and a thumb that fills the track content (9px inside the 10px
    // track, leaving the faded 1px content-edge border) so the vertical bar
    // isn't a skinny 6px thumb floating in a 10px track.
    this._verticalScrollbar = OverlayScrollbar.attach(target, {
      axis: "vertical",
      container,
      inset: { top: "0", right: "0" },
      size: 9,
      hoverSize: VERTICAL_SCROLLBAR_WIDTH,
      thumbColor: isLight ? "rgba(193,193,193,0.9)" : "rgba(66,66,66,0.9)",
      thumbHoverColor: isLight ? "rgba(176,176,176,0.9)" : "rgba(85,85,85,0.9)",
      // Sit BELOW the custom .fe-hscroll (z-index 8) so at the bottom-right
      // corner the horizontal bar overlays the vertical thumb rather than
      // under it.
      zIndex: 5,
      // Fade the bar out a few seconds after the cursor leaves the editor.
      autoHide: true,
    });
  }

  private _teardownPipeline(): void {
    this._findRenderer?.dispose();
    this._findRenderer = null;
    this._findMatches = [];
    this._findActiveIndex = -1;
    this._cursorRenderer?.dispose();
    this._cursorRenderer = null;
    this._selectionRenderer?.dispose();
    this._selectionRenderer = null;
    this._currentLineHighlight?.dispose();
    this._currentLineHighlight = null;
    this._inlineHighlights?.dispose();
    this._inlineHighlights = null;
    this._indentationGuides?.dispose();
    this._indentationGuides = null;
    // The shared gutter host persists across pipeline rebuilds (it is created
    // once in firstUpdated); just drop its band so stale cells don't linger
    // while the rebuilt pipeline re-populates it.
    this._gutter?.setRows([]);
    this._textAreaInput?.dispose();
    this._textAreaInput = null;
    this._scrollManager?.dispose();
    this._scrollManager = null;
    this._verticalScrollbar?.destroy();
    this._verticalScrollbar = null;
    this._hScrollClearHideTimer();
    this._viewportResizeObserver?.disconnect();
    this._viewportResizeObserver = null;
    this._clipboardHandler?.dispose();
    this._clipboardHandler = null;
    this._compositionHandler?.dispose();
    this._compositionHandler = null;
    this._mouseHandler?.dispose();
    this._mouseHandler = null;
    this._viewLines?.dispose();
    this._viewLines = null;
    this._viewModel?.dispose();
    this._viewModel = null;
    this._cursorController?.dispose();
    this._cursorController = null;
    this._lineWidthTracker?.reset();
    this._keyboardHandler = null;
  }

  private _updateStatusBarSize(): void {
    if (!this._statusBar) return;
    const model = this.textContentModel;
    if (!model) {
      this._statusBar.setSize("");
      return;
    }
    const bytes = model.length;
    this._statusBar.setSize(this._formatFileSize(bytes));
  }

  /** Format a byte count as a human-readable string (e.g. "1.2 KB"). */
  private _formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  }

  private _dispatchTitleChanged(): void {
    this.dispatchEvent(
      new CustomEvent<TitleChangedDetail>(EVENT_TITLE_CHANGED, {
        bubbles: true,
        composed: true,
        detail: {
          title: this.fileName || this.filePath.split("/").pop() || "untitled",
          filePath: this.filePath,
        },
      }),
    );
  }

  private _dispatchDirtyChanged(isDirty: boolean): void {
    this.dispatchEvent(
      new CustomEvent<DirtyChangedDetail>(EVENT_DIRTY_CHANGED, {
        bubbles: true,
        composed: true,
        detail: { isDirty },
      }),
    );
  }

  private _dispatchFileSaved(): void {
    this.dispatchEvent(
      new CustomEvent<FileSavedDetail>(EVENT_FILE_SAVED, {
        bubbles: true,
        composed: true,
        detail: { filePath: this.filePath },
      }),
    );
  }
}
