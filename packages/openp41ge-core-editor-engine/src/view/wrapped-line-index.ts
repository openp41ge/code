/**
 * WrappedLineIndex — model-line ↔ view-line mapping for word-wrapped content.
 *
 * Phase 2 of the large-file-performance plan: virtual scrolling for word wrap.
 * When a model line wraps into several view lines (one per wrap segment), the
 * viewport must render only the visible *view lines*. This index answers, in
 * O(log n), which (model line, segment) a view line corresponds to, without
 * walking the whole document on every scroll.
 *
 * Internally it caches per-model-line wrap-segment counts and builds a
 * cumulative "view line start of model line" prefix array lazily. Content
 * edits invalidate from an edited line onward and rebuild lazily.
 */

import { computeWrapSegments } from "./word-wrap-helper";

export interface IWrappedLineProvider {
  /** Full content of a model line (1-based). */
  getLineContent(modelLine: number): string;
}

export interface WrappedLineInfo {
  /** 1-based model line the view line belongs to. */
  readonly modelLine: number;
  /** 0-based index of the wrap segment within that model line. */
  readonly segmentIndex: number;
}

export class WrappedLineIndex {
  private readonly _provider: IWrappedLineProvider;
  private readonly _isHidden: (modelLine: number) => boolean;
  private _wrapColumn: number;
  private _totalModelLineCount = 0;

  /** Per-model-line wrap segment counts (1-based key). Computed lazily. */
  private readonly _counts = new Map<number, number>();
  /** starts[m - 1] = 1-based view line where model line `m` begins. */
  private readonly _starts: number[] = [];
  /** Number of model lines whose start has been computed into `_starts`. */
  private _built = 0;

  constructor(
    provider: IWrappedLineProvider,
    wrapColumn: number,
    isHidden?: (modelLine: number) => boolean,
  ) {
    this._provider = provider;
    this._wrapColumn = wrapColumn;
    this._isHidden = isHidden ?? (() => false);
  }

  setTotalModelLineCount(count: number): void {
    const prev = this._totalModelLineCount;
    this._totalModelLineCount = count;
    if (count < prev) {
      // Shrunk — drop counts/starts beyond the new count.
      for (const key of Array.from(this._counts.keys())) {
        if (key > count) this._counts.delete(key);
      }
      if (this._built > count) {
        this._built = count;
        this._starts.length = Math.max(0, count);
      }
    }
  }

  setWrapColumn(column: number): void {
    if (this._wrapColumn === column) return;
    this._wrapColumn = column;
    this.reset();
  }

  reset(): void {
    this._counts.clear();
    this._starts.length = 0;
    this._built = 0;
  }

  /** Number of wrap segments a model line splits into (0 when hidden). */
  getSegmentCount(modelLine: number): number {
    if (modelLine < 1 || modelLine > this._totalModelLineCount) return 0;
    if (this._isHidden(modelLine)) return 0;
    let count = this._counts.get(modelLine);
    if (count === undefined) {
      count = computeWrapSegments(
        this._provider.getLineContent(modelLine),
        this._wrapColumn,
      ).length;
      this._counts.set(modelLine, count);
    }
    return count;
  }

  /** Total number of view lines across the whole document. */
  get totalViewLineCount(): number {
    if (this._totalModelLineCount <= 0) return 0;
    this._ensure(this._totalModelLineCount);
    return (
      this._starts[this._starts.length - 1] + this.getSegmentCount(this._totalModelLineCount) - 1
    );
  }

  /** 1-based view line where a model line's first segment begins. */
  getViewLineStart(modelLine: number): number {
    if (modelLine < 1) return 1;
    if (modelLine > this._totalModelLineCount) return this.totalViewLineCount + 1;
    this._ensure(modelLine);
    return this._starts[modelLine - 1];
  }

  /**
   * Resolve a 1-based view line to its model line + segment index.
   * Returns null for out-of-range view lines.
   */
  findViewLine(viewLine: number): WrappedLineInfo | null {
    if (viewLine < 1 || this._totalModelLineCount <= 0) return null;
    this._ensure(this._totalModelLineCount);

    // Binary search greatest m with starts[m-1] <= viewLine.
    let lo = 0;
    let hi = this._starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._starts[mid] <= viewLine) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans < 0) return null;

    const modelLine = ans + 1;
    const segmentIndex = viewLine - this._starts[ans];
    if (segmentIndex >= this.getSegmentCount(modelLine)) return null;
    return { modelLine, segmentIndex };
  }

  /**
   * Mark everything from a model line onward as stale (line inserted/deleted
   * or content replaced). Rebuilt lazily on the next access.
   */
  invalidateFrom(modelLine: number): void {
    if (modelLine < 1) modelLine = 1;
    for (const key of Array.from(this._counts.keys())) {
      if (key >= modelLine) this._counts.delete(key);
    }
    this._built = Math.min(this._built, modelLine - 1);
    this._starts.length = Math.max(0, modelLine - 1);
  }

  /** Ensure `_starts` is computed through the given model line (inclusive). */
  private _ensure(throughModelLine: number): void {
    const target = Math.min(throughModelLine, this._totalModelLineCount);
    while (this._built < target) {
      const m = this._built + 1;
      const start = m === 1 ? 1 : this._starts[this._built - 1] + this.getSegmentCount(m - 1);
      this._starts.push(start);
      this._built++;
    }
  }
}
