/**
 * ViewLines — manages the DOM for visible lines in the editor viewport.
 *
 * Responsibilities:
 * 1. Create/destroy ViewLine instances as the user scrolls
 * 2. Position lines absolutely (top: Npx)
 * 3. Set content and tokens on visible lines
 * 4. Maintain the sliding window of rendered lines via RenderedLinesCollection
 * 5. Create a content wrapper div inside the viewport that holds all lines
 *
 * Word wrap (Phase 2 of the large-file-performance plan):
 * When wrapping is enabled, each model line splits into several *view lines*
 * (one per wrap segment). The viewport then virtualizes over VIEW lines: only
 * the visible window is materialised as DOM, keyed by view line number, using
 * WrappedLineIndex for the view↔model mapping. Model-space accessors
 * (startLineNumber/endLineNumber/onVisibleRangeChanged) stay in model space so
 * the gutter and bracket-depth consumers keep working.
 */

import { RenderedLinesCollection } from "./view-layer";
import { ViewLine } from "../rendering/view-line";
import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";
import { createFastDomNode, FastDomNode } from "./fast-dom-node";
import { computeWrapSegments } from "./word-wrap-helper";
import { TokenSegmentAdjuster } from "./token-segment-adjuster";
import type { ITokenSegmentAdjuster } from "./token-segment-adjuster";
import { ViewportWrapColumnCalculator } from "./wrap-column-calculator";
import type { IWrapColumnCalculator } from "./wrap-column-calculator";
import { WrappedLineIndex } from "./wrapped-line-index";
import { FoldLineIndex } from "./fold-line-index";

/**
 * Provider for line content and tokens, used by ViewLines when rendering.
 */
export interface ILineContentProvider {
  getLineContent(lineNumber: number): string;
  getLineTokens(lineNumber: number): IToken[] | null;
  tabSize: number;
}

/**
 * Events emitted by ViewLines.
 */
export interface IViewLinesEvent {
  readonly type: "lines-changed" | "lines-inserted" | "lines-deleted";
  readonly startLineNumber: number;
  readonly endLineNumber: number;
}

/**
 * Configuration for ViewLines.
 */
export interface ViewLinesConfig {
  /** Height of each line in pixels. */
  lineHeight: number;
  /** Tab size (spaces per tab). */
  tabSize: number;
}

/**
 * ViewLines — manages the set of visible line DOM nodes.
 */
export class ViewLines {
  private _viewportEl: FastDomNode;
  private _linesWrapper: FastDomNode;
  private _collection: RenderedLinesCollection<ViewLine>;
  private _config: ViewLinesConfig;
  private _lineContentCache: Map<number, string> = new Map();
  private _lineTokenCache: Map<number, IToken[] | null> = new Map();
  private _totalLineCount: number = 0;
  private _wordWrapEnabled: boolean = false;
  private _wrapColumn: number = 80;
  private _scrollTop: number = 0;
  private _viewportHeight: number = 0;
  private _visibleStartLine: number = 0;
  private _visibleEndLine: number = 0;
  private _disposed: boolean = false;
  private _segmentAdjuster: ITokenSegmentAdjuster;
  private _wrapCalculator: IWrapColumnCalculator;

  // ── Word-wrap virtualization (Phase 2) ────────────────────────────────

  /** View-line-keyed DOM window used when word wrap is enabled. */
  private _wrappedLines: RenderedLinesCollection<ViewLine> =
    new RenderedLinesCollection<ViewLine>();
  /** Visible view-line window when wrapped (1-based, view space). */
  private _wrappedStartViewLine: number = 0;
  private _wrappedEndViewLine: number = 0;
  private _wrappedIndex: WrappedLineIndex | null = null;

  // ── Folding (non-wrapped model-space virtualization) ────────────────────

  /** Model lines currently hidden by collapsed folds (1-based). */
  private _hiddenLines: Set<number> | null = null;
  /** Visible-line index used when any line is folded. */
  private _foldIndex: FoldLineIndex | null = null;

  /**
   * Callback for rendering a line's content with its tokens.
   * Called when a line enters the viewport and needs its content set.
   */
  onLineRender: ((lineNumber: number, viewLine: ViewLine) => void) | null = null;

  /**
   * Content provider for fetching line content and tokens (used for word wrap).
   */
  lineContentProvider: ILineContentProvider | null = null;

  /**
   * Callback for when a line exits the viewport (for cleanup).
   */
  onLineDispose: ((lineNumber: number, viewLine: ViewLine) => void) | null = null;

  /**
   * Callback for when the visible range changes due to scrolling.
   * The selection renderer needs this to re-render highlights for the
   * new visible range when the user scrolls after a cross-range selection.
   * Fired with MODEL line numbers in both modes.
   */
  onVisibleRangeChanged: ((startLine: number, endLine: number) => void) | null = null;

  constructor(
    viewportEl: HTMLElement,
    config: ViewLinesConfig,
    segmentAdjuster?: ITokenSegmentAdjuster,
    wrapCalculator?: IWrapColumnCalculator,
  ) {
    this._viewportEl = new FastDomNode(viewportEl);
    this._viewportEl.setPosition("relative");
    // Give the layer a class ONLY if it doesn't already own one — the file
    // editor passes its text-region (already classed `fe-text-region`) here,
    // and clobbering that class hides its CSS.
    if (!viewportEl.className) {
      this._viewportEl.setClassName("fe-viewport");
    }

    // Create an inner wrapper that holds the absolutely-positioned lines.
    // Width defaults to 100% of viewport (shrink-wraps to content otherwise).
    this._linesWrapper = createFastDomNode();
    this._linesWrapper.setPosition("relative");
    this._linesWrapper.setClassName("view-lines");
    this._viewportEl.appendChild(this._linesWrapper);

    this._config = config;
    this._collection = new RenderedLinesCollection<ViewLine>();
    this._viewportHeight = viewportEl.clientHeight;
    this._segmentAdjuster = segmentAdjuster ?? new TokenSegmentAdjuster();
    this._wrapCalculator = wrapCalculator ?? new ViewportWrapColumnCalculator();
  }

  /**
   * Enable or disable word wrap.
   */
  setWordWrap(enabled: boolean, wrapColumn?: number): void {
    if (wrapColumn !== undefined && wrapColumn !== this._wrapColumn) {
      this._wrapColumn = wrapColumn;
      this._wrappedIndex?.setWrapColumn(wrapColumn);
    }
    const changed = this._wordWrapEnabled !== enabled;
    this._wordWrapEnabled = enabled;
    if (changed) {
      if (!enabled) {
        // Leaving wrapped mode — clear the wrapped DOM window AND any stale
        // non-wrapped line nodes that could have accumulated before wrapping.
        this._clearWrappedWindow();
        this._clearCollection();
      } else {
        // Entering wrapped mode — drop the non-wrapped DOM window and reset
        // the lazy index (used on next render).
        this._clearCollection();
        this._wrappedIndex?.reset();
      }
    }
    this._updateScrollHeight();
  }

  /**
   * Set the set of hidden (folded) model lines. Null/empty = no folds. Hidden
   * lines contribute zero visible lines: the scroll height, line `top`s and
   * the visible window all ignore them.
   */
  setHiddenLines(hidden: Set<number> | null): void {
    const next = hidden && hidden.size > 0 ? hidden : null;
    const changed = this._hiddenLines !== next;
    this._hiddenLines = next;
    this._foldIndex = next
      ? new FoldLineIndex({ isHidden: (m) => !!this._hiddenLines?.has(m) })
      : null;
    this._foldIndex?.setTotalModelLineCount(this._totalLineCount);
    if (changed) {
      this._updateScrollHeight();
      if (this._wordWrapEnabled && this.lineContentProvider) {
        // Fold state alters per-line segment counts (hidden = 0); drop the
        // cached mapping so it rebuilds with the new hidden set.
        this._wrappedIndex?.reset();
        this._refreshWrappedWindow();
      } else {
        this.refresh();
      }
    }
  }

  /** Total number of visible lines (fold-aware; = total when no folds). */
  getVisibleLineCount(): number {
    if (!this._foldIndex) return this._totalLineCount;
    return this._foldIndex.totalVisibleLineCount;
  }

  /** Whether a model line is hidden by a collapsed fold. */
  isLineHidden(modelLine: number): boolean {
    return !!this._hiddenLines?.has(modelLine);
  }

  /** Compute the effective wrap column from the viewport width. */
  private _computeWrapColumn(): number {
    const charWidth = this._measureCharWidth();
    const viewportWidth = this._viewportEl.element.clientWidth;
    return this._wrapCalculator.compute(viewportWidth, 0, 16, charWidth || 8);
  }

  /**
   * Get the total number of visible view lines (accounting for word wrap).
   */
  getViewLineCount(): number {
    if (!this._wordWrapEnabled) return this.getVisibleLineCount();
    if (!this.lineContentProvider) return this.getVisibleLineCount();
    return this.wrappedIndex().totalViewLineCount;
  }

  /**
   * Compute the view line number for a model line and its wrapped segment.
   * Returns the starting view line number (1-based) for the given model line.
   */
  getViewLineStart(modelLine: number): number {
    if (!this._wordWrapEnabled) {
      if (!this._foldIndex) return modelLine;
      return this._foldIndex.getVisibleLineStart(modelLine);
    }
    const provider = this.lineContentProvider;
    if (!provider) return modelLine;
    return this.wrappedIndex().getViewLineStart(modelLine);
  }

  /** Fold-aware visible-line index of a model line's first visible segment. */
  private _visibleStartOf(modelLine: number): number {
    if (!this._foldIndex) return modelLine;
    return this._foldIndex.getVisibleLineStart(modelLine);
  }

  /** Fold-aware model line for a 1-based visible line (0 when out of range). */
  private _modelAtVisible(visibleLine: number): number {
    if (!this._foldIndex) return visibleLine;
    return this._foldIndex.findModelLine(visibleLine);
  }

  /**
   * Set the total number of lines in the document.
   */
  setTotalLineCount(count: number): void {
    this._totalLineCount = count;
    // Update the wrapped mapping horizon (wraps/shifts line numbers).
    this._wrappedIndex?.setTotalModelLineCount(count);
    this._foldIndex?.setTotalModelLineCount(count);
    // Update the scroll height of the content wrapper
    this._updateScrollHeight();
  }

  /**
   * Get the total line count.
   */
  get totalLineCount(): number {
    return this._totalLineCount;
  }

  /**
   * Get the configuration.
   */
  get config(): ViewLinesConfig {
    return this._config;
  }

  /**
   * The viewport DOM element.
   */
  get viewportEl(): FastDomNode {
    return this._viewportEl;
  }

  /**
   * The lines wrapper DOM element.
   */
  get linesWrapper(): FastDomNode {
    return this._linesWrapper;
  }

  /**
   * Get a rendered ViewLine by line number. In wrapped mode the key is a VIEW
   * line number; otherwise it is a model line number.
   */
  getViewLine(lineNumber: number): ViewLine | undefined {
    if (this._wordWrapEnabled && this.lineContentProvider) {
      return this._wrappedLines.getLine(lineNumber);
    }
    return this._collection.getLine(lineNumber);
  }

  /**
   * Get all currently rendered ViewLines.
   */
  getRenderedLines(): ViewLine[] {
    if (this._wordWrapEnabled && this.lineContentProvider) {
      return this._wrappedLines.getLines();
    }
    return this._collection.getLines();
  }

  /**
   * The first visible line number. Model space in both modes.
   */
  get startLineNumber(): number {
    if (this._wordWrapEnabled && this.lineContentProvider) {
      if (!this._wrappedStartViewLine) return 0;
      return this.wrappedIndex().findViewLine(this._wrappedStartViewLine)?.modelLine ?? 1;
    }
    return this._collection.startLineNumber;
  }

  /**
   * The last visible line number. Model space in both modes.
   */
  get endLineNumber(): number {
    if (this._wordWrapEnabled && this.lineContentProvider) {
      if (!this._wrappedEndViewLine) return 0;
      return (
        this.wrappedIndex().findViewLine(this._wrappedEndViewLine)?.modelLine ??
        this._totalLineCount
      );
    }
    return this._collection.endLineNumber;
  }

  /** First rendered VIEW line (wrapped mode; 0 when empty). */
  get wrappedStartViewLine(): number {
    return this._wrappedStartViewLine;
  }

  /** Last rendered VIEW line (wrapped mode; 0 when empty). */
  get wrappedEndViewLine(): number {
    return this._wrappedEndViewLine;
  }

  /**
   * Update the viewport height (on resize).
   */
  setViewportHeight(height: number): void {
    this._viewportHeight = height;
  }

  /**
   * Handle a scroll event — update the visible line range.
   *
   * @param scrollTop - The new scroll top position.
   * @param viewportHeight - The viewport height in pixels.
   */
  onScroll(scrollTop: number, viewportHeight?: number): void {
    if (viewportHeight !== undefined) {
      this._viewportHeight = viewportHeight;
    }
    this._scrollTop = scrollTop;

    const lineHeight = this._config.lineHeight;
    if (lineHeight <= 0) return;

    if (this._wordWrapEnabled && this.lineContentProvider) {
      this._scrollWrapped(scrollTop, lineHeight);
      return;
    }

    // Non-wrapped mode — compute which lines should be visible.
    // Add some over-rendering (1 line above, 2 lines below) for smooth scrolling
    const overRenderAbove = 1;
    const overRenderBelow = 2;

    const totalVisible = this.getVisibleLineCount();
    const newStartVisible = Math.max(1, Math.floor(scrollTop / lineHeight) - overRenderAbove + 1);
    const newEndVisible = Math.min(
      totalVisible,
      Math.ceil((scrollTop + this._viewportHeight) / lineHeight) + overRenderBelow,
    );
    const newStartLine = this._modelAtVisible(newStartVisible);
    const newEndLine = this._modelAtVisible(newEndVisible);

    if (newStartLine === this._visibleStartLine && newEndLine === this._visibleEndLine) {
      return; // No change
    }

    this._visibleStartLine = newStartLine;
    this._visibleEndLine = newEndLine;

    this._rebuildLines(newStartLine, newEndLine);

    // Notify listener that the visible range changed
    this.onVisibleRangeChanged?.(newStartLine, newEndLine);
  }

  /**
   * Wrapped-mode scroll: virtualize over view lines.
   */
  private _scrollWrapped(scrollTop: number, lineHeight: number): void {
    const index = this.wrappedIndex();
    const total = index.totalViewLineCount;
    if (total <= 0) {
      this._wrappedStartViewLine = 0;
      this._wrappedEndViewLine = 0;
      return;
    }

    const overRenderAbove = 1;
    const overRenderBelow = 2;
    const newStart = Math.max(1, Math.floor(scrollTop / lineHeight) - overRenderAbove + 1);
    const newEnd = Math.min(
      total,
      Math.ceil((scrollTop + this._viewportHeight) / lineHeight) + overRenderBelow,
    );

    if (newStart === this._wrappedStartViewLine && newEnd === this._wrappedEndViewLine) {
      return; // No change
    }

    this._wrappedStartViewLine = newStart;
    this._wrappedEndViewLine = newEnd;
    this._rebuildWrappedLines(newStart, newEnd);

    // Gutter / selection consumers stay in model space.
    const modelStart = index.findViewLine(newStart)?.modelLine ?? 1;
    const modelEnd = index.findViewLine(newEnd)?.modelLine ?? this._totalLineCount;
    this.onVisibleRangeChanged?.(modelStart, modelEnd);
  }

  /**
   * Set the content for a specific line.
   */
  setLineContent(lineNumber: number, content: string, tokens: IToken[] | null): void {
    this._lineContentCache.set(lineNumber, content);
    this._lineTokenCache.set(lineNumber, tokens);

    if (this._wordWrapEnabled && this.lineContentProvider) {
      // Wrapped rendering reads live from the provider on rebuild; nothing to
      // line up by model line here.
      return;
    }
    const line = this._collection.getLine(lineNumber);
    if (line) {
      line.setContent(content, tokens, this._config.tabSize);
    }
  }

  /**
   * Invalidate a line — forces re-render on next scroll pass.
   */
  invalidateLine(lineNumber: number): void {
    this._lineContentCache.delete(lineNumber);
    this._lineTokenCache.delete(lineNumber);

    if (this._wordWrapEnabled && this.lineContentProvider) {
      // Content changed — the wrap mapping below this line is stale.
      this._wrappedIndex?.invalidateFrom(lineNumber);
      this._refreshWrappedWindow();
      return;
    }
    const line = this._collection.getLine(lineNumber);
    if (line) {
      // Schedule for re-render
      if (this.onLineRender) {
        this.onLineRender(lineNumber, line);
      }
    }
  }

  /**
   * Invalidate a range of lines.
   */
  invalidateLines(startLine: number, endLine: number): void {
    for (let line = startLine; line <= endLine; line++) {
      this.invalidateLine(line);
    }
  }

  /**
   * Clear all line content caches (e.g., after file reload).
   * In wrapped mode the view↔model mapping is also invalidated, because a
   * content change can alter per-line wrap segment counts.
   */
  clearContentCache(): void {
    this._lineContentCache.clear();
    this._lineTokenCache.clear();
    if (this._wordWrapEnabled) {
      // Lazy rebuild on next view-line resolution (see WrappedLineIndex).
      this._wrappedIndex?.reset();
    }
  }

  /**
   * Get the cached content for a line.
   */
  getCachedContent(lineNumber: number): string | undefined {
    return this._lineContentCache.get(lineNumber);
  }

  /**
   * Get the cached tokens for a line.
   */
  getCachedTokens(lineNumber: number): IToken[] | null | undefined {
    return this._lineTokenCache.get(lineNumber);
  }

  /**
   * Force-rebuild all visible lines (bypasses the no-change guard in onScroll).
   * Use after the tokenizer is loaded or content changes that require a full re-render.
   */
  refresh(): void {
    if (this._disposed) return;
    if (this._wordWrapEnabled && this.lineContentProvider) {
      this._refreshWrappedWindow();
      return;
    }
    this._rebuildLines(this._visibleStartLine, this._visibleEndLine);
  }

  /**
   * Rebuild ALL lines from scratch (used after word wrap toggle).
   */
  rebuildAll(): void {
    if (this._disposed) return;
    if (this._wordWrapEnabled && this.lineContentProvider) {
      // Render only the visible VIEW-line window at the current scroll offset.
      const index = this.wrappedIndex();
      const total = index.totalViewLineCount;
      if (total <= 0) {
        this._clearWrappedWindow();
        return;
      }
      const lineHeight = this._config.lineHeight;
      const overRenderAbove = 1;
      const overRenderBelow = 2;
      const start = Math.max(1, Math.floor(this._scrollTop / lineHeight) - overRenderAbove + 1);
      const end = Math.min(
        total,
        Math.ceil((this._scrollTop + this._viewportHeight) / lineHeight) + overRenderBelow,
      );
      this._wrappedStartViewLine = start;
      this._wrappedEndViewLine = end;
      this._rebuildWrappedLines(start, end);
      const modelStart = index.findViewLine(start)?.modelLine ?? 1;
      const modelEnd = index.findViewLine(end)?.modelLine ?? this._totalLineCount;
      this.onVisibleRangeChanged?.(modelStart, modelEnd);
      return;
    }

    if (this._wordWrapEnabled) {
      // Wrapped but no provider — legacy static path (demo only).
      const totalView = this.getViewLineCount();
      this._visibleStartLine = 1;
      this._visibleEndLine = Math.min(totalView, 5000); // cap at 5000 for performance
      this._rebuildLines(1, this._visibleEndLine);
    } else {
      this._visibleStartLine = 1;
      this._visibleEndLine = this._modelAtVisible(Math.min(100, this.getVisibleLineCount()));
      this._rebuildLines(this._visibleStartLine, this._visibleEndLine);
    }
  }

  /**
   * Get the rendered line count. Wrapped mode counts VIEW lines in the window.
   */
  get renderedLineCount(): number {
    if (this._wordWrapEnabled && this.lineContentProvider) {
      return this._wrappedLines.count;
    }
    return this._collection.count;
  }

  /**
   * Update the scroll height to accommodate all lines.
   */
  private _updateScrollHeight(): void {
    const totalLines = this._wordWrapEnabled
      ? this.lineContentProvider
        ? this.wrappedIndex().totalViewLineCount
        : this.getVisibleLineCount()
      : this.getVisibleLineCount();
    const totalHeight = totalLines * this._config.lineHeight;
    this._linesWrapper.setHeight(totalHeight);
    // The wrapper div inside a naturally-scrolling viewport creates the scroll
  }

  /**
   * Rebuild all visible lines (non-wrapped mode).
   */
  private _rebuildLines(startLine: number, endLine: number): void {
    if (this._disposed) return;

    // Dispose old lines
    const oldLines = this._collection.getLines();
    for (const line of oldLines) {
      if (this.onLineDispose) {
        this.onLineDispose(line.lineNumber, line);
      }
      line.dispose();
    }
    this._collection.clear();

    // Create new lines
    const newLines: ViewLine[] = [];
    const lineHeight = this._config.lineHeight;

    const provider = this.lineContentProvider;
    if (this._wordWrapEnabled && provider) {
      // Wrapped mode is normally virtualized via _rebuildWrappedLines; this
      // branch only runs for the legacy no-provider path.
      const wrapColumn = this._wrapColumn > 0 ? this._wrapColumn : this._computeWrapColumn();
      let viewLineNum = 1;
      const maxViewLines = Math.min(endLine, 5000);
      for (
        let modelLine = 1;
        modelLine <= this._totalLineCount && viewLineNum <= maxViewLines;
        modelLine++
      ) {
        const content = provider.getLineContent(modelLine);
        const segments = computeWrapSegments(content, wrapColumn);
        const tokens = provider.getLineTokens(modelLine);
        for (let s = 0; s < segments.length && viewLineNum <= maxViewLines; s++) {
          const seg = segments[s];
          const top = (viewLineNum - 1) * lineHeight;
          const viewLine = new ViewLine(modelLine, top, lineHeight);
          const adjustedTokens = this._segmentAdjuster.adjust(
            tokens,
            seg.startColumn - 1,
            seg.text.length,
          );
          viewLine.setContent(seg.text, adjustedTokens, provider.tabSize);
          this._linesWrapper.appendChild(viewLine.domNode);
          newLines.push(viewLine);
          viewLineNum++;
        }
      }
      this._collection.replace(startLine, newLines);
      return;
    }

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (this.isLineHidden(lineNum)) continue;
      const top = (this._visibleStartOf(lineNum) - 1) * lineHeight;
      const viewLine = new ViewLine(lineNum, top, lineHeight);

      if (this.onLineRender) {
        this.onLineRender(lineNum, viewLine);
      }

      this._linesWrapper.appendChild(viewLine.domNode);
      newLines.push(viewLine);
    }

    this._collection.replace(startLine, newLines);
  }

  /**
   * Rebuild the visible VIEW-line window for wrapped mode.
   */
  private _rebuildWrappedLines(startViewLine: number, endViewLine: number): void {
    if (this._disposed) return;

    // Dispose old wrapped lines.
    const oldLines = this._wrappedLines.getLines();
    for (const line of oldLines) {
      if (this.onLineDispose) {
        this.onLineDispose(line.lineNumber, line);
      }
      line.dispose();
    }
    this._wrappedLines.clear();

    const provider = this.lineContentProvider;
    const lineHeight = this._config.lineHeight;
    const newLines: ViewLine[] = [];

    if (!provider) {
      // Legacy fallback: one ViewLine per view line, content via onLineRender.
      for (let viewLineNum = startViewLine; viewLineNum <= endViewLine; viewLineNum++) {
        const viewLine = new ViewLine(viewLineNum, (viewLineNum - 1) * lineHeight, lineHeight);
        if (this.onLineRender) this.onLineRender(viewLineNum, viewLine);
        this._linesWrapper.appendChild(viewLine.domNode);
        newLines.push(viewLine);
      }
      this._wrappedLines.replace(startViewLine, newLines);
      return;
    }

    const index = this.wrappedIndex();
    const wrapColumn = this._wrapColumn > 0 ? this._wrapColumn : this._computeWrapColumn();
    for (let viewLineNum = startViewLine; viewLineNum <= endViewLine; viewLineNum++) {
      const info = index.findViewLine(viewLineNum);
      if (!info) continue;
      const { modelLine, segmentIndex } = info;
      const segments = computeWrapSegments(provider.getLineContent(modelLine), wrapColumn);
      const seg = segments[segmentIndex];
      if (!seg) continue;

      const viewLine = new ViewLine(viewLineNum, (viewLineNum - 1) * lineHeight, lineHeight);
      const tokens = provider.getLineTokens(modelLine);
      const adjustedTokens = this._segmentAdjuster.adjust(
        tokens,
        seg.startColumn - 1,
        seg.text.length,
      );
      viewLine.setContent(seg.text, adjustedTokens, provider.tabSize);
      this._linesWrapper.appendChild(viewLine.domNode);
      newLines.push(viewLine);
    }

    this._wrappedLines.replace(startViewLine, newLines);
  }

  /** Re-render the current wrapped view-line window (used by refresh/invalidate). */
  private _refreshWrappedWindow(): void {
    if (!this._wrappedStartViewLine || !this._wrappedEndViewLine) return;
    if (this._wrappedEndViewLine > this.wrappedIndex().totalViewLineCount) return;
    this._rebuildWrappedLines(this._wrappedStartViewLine, this._wrappedEndViewLine);
  }

  /** Drop all non-wrapped DOM lines and reset the collection. */
  private _clearCollection(): void {
    const oldLines = this._collection.getLines();
    for (const line of oldLines) {
      if (this.onLineDispose) this.onLineDispose(line.lineNumber, line);
      line.dispose();
    }
    this._collection.clear();
  }

  /** Drop all wrapped DOM lines and reset the wrapped window. */
  private _clearWrappedWindow(): void {
    const oldLines = this._wrappedLines.getLines();
    for (const line of oldLines) {
      if (this.onLineDispose) this.onLineDispose(line.lineNumber, line);
      line.dispose();
    }
    this._wrappedLines.clear();
    this._wrappedStartViewLine = 0;
    this._wrappedEndViewLine = 0;
  }

  /** Lazily create the wrapped view↔model index. */
  private wrappedIndex(): WrappedLineIndex {
    if (!this._wrappedIndex) {
      this._wrappedIndex = new WrappedLineIndex(
        { getLineContent: (ln) => this.lineContentProvider?.getLineContent(ln) ?? "" },
        this._wrapColumn,
        (m) => !!this._hiddenLines?.has(m),
      );
    }
    this._wrappedIndex.setTotalModelLineCount(this._totalLineCount);
    return this._wrappedIndex;
  }

  /**
   * Set the total content width from the view model (max line width across ALL
   * lines, not just visible ones). Called on file load and content change.
   *
   * @param pixelWidth - The pixel width of the widest content, including
   *   left offset (8px) and right gap (8px) = maxLineTextWidth + 16.
   */
  setContentWidth(pixelWidth: number): void {
    const viewportEl = this._viewportEl.element;
    const viewportWidth = viewportEl.getBoundingClientRect().width;
    this._linesWrapper.element.style.width = pixelWidth + "px";
    if (!this._wordWrapEnabled) {
      // The element passed in is usually the editor's TEXT REGION, which is NOT
      // a scroll container in the unified-scroll layout — the editor's outer
      // viewport owns the single horizontal scrollbar (and toggles it itself
      // via overflow-x). Only a standalone scroller (no fe-text-region class)
      // gets its overflow toggled here, otherwise flipping it would create a
      // SECOND horizontal scrollbar on the text region.
      if (!viewportEl.classList.contains("fe-text-region")) {
        viewportEl.style.overflowX = pixelWidth > viewportWidth ? "auto" : "hidden";
      }
    }
  }

  /**
   * Measure the character width from the viewport font.
   */
  private _measureCharWidth(): number {
    const el = this._viewportEl.element;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 14;
    const fontFamily = cs.fontFamily || "monospace";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return 8;
    ctx.font = fontSize + "px " + fontFamily;
    return ctx.measureText("X").width || 8;
  }

  /**
   * Dispose the ViewLines manager.
   */
  dispose(): void {
    this._disposed = true;
    const lines = this._collection.getLines();
    for (const line of lines) {
      line.dispose();
    }
    this._collection.clear();
    const wrapped = this._wrappedLines.getLines();
    for (const line of wrapped) {
      line.dispose();
    }
    this._wrappedLines.clear();
    this._linesWrapper.element.remove();
    this._lineContentCache.clear();
    this._lineTokenCache.clear();
  }
}
