/**
 * CoordinatesConverter — transforms between model space (line/column)
 * and view space (with optional word-wrap).
 *
 * Without word wrap: identity transform (1 model line = 1 view line).
 * With word wrap: a model line may be split into multiple view lines
 * at word break boundaries.
 */

import type { PieceTreeTextContentModel } from "./piece-tree-text-content-model";
import type { TextPosition } from "./piece-tree-text-content-model";
import { computeWrapSegments } from "../view/word-wrap-helper";
import type { WrapSegment } from "../view/word-wrap-helper";

/**
 * Cached wrap data for a single model line.
 */
interface WrapData {
  readonly segments: WrapSegment[];
}

export class CoordinatesConverter {
  private _model: PieceTreeTextContentModel;
  private _wordWrap: boolean = false;
  private _wrapColumn: number = 80;
  private _tabSize: number = 4;
  private _wrapCache: Map<number, WrapData> = new Map();
  /** Cache of total view line count. */
  private _totalViewLineCount: number = -1;
  private _totalModelLineCount: number = 0;
  private _dirty: boolean = false;

  constructor(model: PieceTreeTextContentModel) {
    this._model = model;
    this._totalModelLineCount = model.lineCount;
  }

  /**
   * Enable/disable word wrap.
   */
  setWordWrap(enabled: boolean): void {
    if (this._wordWrap === enabled) return;
    this._wordWrap = enabled;
    this._clearCache();
  }

  /**
   * Set the wrap column width.
   */
  setWrapColumn(columns: number): void {
    if (this._wrapColumn === columns) return;
    this._wrapColumn = columns;
    this._clearCache();
  }

  /**
   * Set the tab size.
   */
  setTabSize(size: number): void {
    if (this._tabSize === size) return;
    this._tabSize = size;
    this._clearCache();
  }

  /**
   * Check if word wrap is enabled.
   */
  get isWordWrap(): boolean {
    return this._wordWrap;
  }

  /**
   * Mark the cache as dirty (e.g., after content change).
   * Also clears the per-line wrap cache so stale segments aren't used.
   */
  markDirty(): void {
    this._dirty = true;
    this._wrapCache.clear();
  }

  /**
   * Convert a model position to a view position.
   */
  convertModelToViewPosition(modelLineNumber: number, modelColumn: number): TextPosition {
    if (!this._wordWrap) {
      return { lineNumber: modelLineNumber, column: modelColumn };
    }

    const wrapData = this._getWrapData(modelLineNumber);

    // The view line base for this model line (accounts for preceding wrapped lines)
    const viewLineBase = this.getViewLineFromModelLine(modelLineNumber);

    if (!wrapData || wrapData.segments.length <= 1) {
      return { lineNumber: viewLineBase, column: modelColumn };
    }

    // Find which segment contains the model column
    let viewLineOffset = 0;
    for (const seg of wrapData.segments) {
      if (modelColumn < seg.endColumn) {
        const viewColumn = modelColumn - seg.startColumn + 1;
        return {
          lineNumber: viewLineBase + viewLineOffset,
          column: Math.max(1, viewColumn),
        };
      }
      viewLineOffset++;
    }

    // Past the end — last segment
    const lastSeg = wrapData.segments[wrapData.segments.length - 1];
    return {
      lineNumber: viewLineBase + wrapData.segments.length - 1,
      column: modelColumn - lastSeg.startColumn + 1,
    };
  }

  /**
   * Convert a view position to a model position.
   */
  convertViewToModelPosition(viewLineNumber: number, viewColumn: number): TextPosition {
    if (!this._wordWrap) {
      return { lineNumber: viewLineNumber, column: viewColumn };
    }

    // Find which model line this view line belongs to
    const modelLine = this.getModelLineFromViewLine(viewLineNumber);
    const wrapData = this._getWrapData(modelLine);
    if (!wrapData || wrapData.segments.length <= 1) {
      return { lineNumber: modelLine, column: viewColumn };
    }

    // Use viewLineBase (not modelLine) to compute the segment index,
    // because preceding wrapped lines shift the view line numbers.
    const viewLineBase = this.getViewLineFromModelLine(modelLine);
    const segmentIndex = viewLineNumber - viewLineBase;
    if (segmentIndex >= 0 && segmentIndex < wrapData.segments.length) {
      const seg = wrapData.segments[segmentIndex];
      const modelCol = seg.startColumn + Math.max(0, viewColumn - 1);
      return { lineNumber: modelLine, column: modelCol };
    }

    return { lineNumber: modelLine, column: viewColumn };
  }

  /**
   * Get the number of view lines for a given model line.
   */
  getViewLineCount(modelLineNumber: number): number {
    if (!this._wordWrap) return 1;

    const wrapData = this._getWrapData(modelLineNumber);
    return wrapData ? wrapData.segments.length : 1;
  }

  /**
   * Get the total number of view lines.
   */
  getTotalViewLineCount(): number {
    if (!this._wordWrap) return this._model.lineCount;

    if (
      this._totalViewLineCount >= 0 &&
      !this._dirty &&
      this._totalModelLineCount === this._model.lineCount
    ) {
      return this._totalViewLineCount;
    }

    let count = 0;
    for (let line = 1; line <= this._model.lineCount; line++) {
      count += this.getViewLineCount(line);
    }
    this._totalViewLineCount = count;
    this._totalModelLineCount = this._model.lineCount;
    this._dirty = false;
    return count;
  }

  /**
   * Get the model line that corresponds to a view line.
   */
  getModelLineFromViewLine(viewLineNumber: number): number {
    if (!this._wordWrap) return viewLineNumber;

    let accumulated = 0;
    for (let modelLine = 1; modelLine <= this._model.lineCount; modelLine++) {
      const viewLines = this.getViewLineCount(modelLine);
      accumulated += viewLines;
      if (accumulated >= viewLineNumber) {
        return modelLine;
      }
    }
    return this._model.lineCount;
  }

  /**
   * Get the starting view line number for a model line (1-based).
   * Without word wrap this equals the model line number.
   */
  getViewLineFromModelLine(modelLineNumber: number): number {
    if (!this._wordWrap) return modelLineNumber;
    if (modelLineNumber <= 1) return 1;
    let acc = 1;
    for (let i = 1; i < modelLineNumber; i++) {
      acc += this.getViewLineCount(i);
    }
    return acc;
  }

  /**
   * Get the wrap segments for a model line.
   */
  getWrapSegments(modelLineNumber: number): WrapSegment[] | null {
    if (!this._wordWrap) return null;
    const wrapData = this._getWrapData(modelLineNumber);
    return wrapData?.segments ?? null;
  }

  /**
   * Clear the wrap cache.
   */
  private _clearCache(): void {
    this._wrapCache.clear();
    this._totalViewLineCount = -1;
    this._dirty = false;
  }

  /**
   * Get (or compute) wrap data for a model line.
   */
  private _getWrapData(lineNumber: number): WrapData | null {
    if (lineNumber < 1 || lineNumber > this._model.lineCount) return null;

    const cached = this._wrapCache.get(lineNumber);
    if (cached) return cached;

    const content = this._model.getLineContent(lineNumber);
    // const effectiveWrap = this._wrapColumn + getIndentLevel(content, this._tabSize) * 2;
    // Simpler: just use the base wrap column for now
    const segments = computeWrapSegments(content, this._wrapColumn);

    const wrapData: WrapData = { segments };
    this._wrapCache.set(lineNumber, wrapData);
    return wrapData;
  }
}
