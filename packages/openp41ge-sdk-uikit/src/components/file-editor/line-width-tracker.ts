/**
 * LineWidthTracker — maximum-line-width tracking for the file editor.
 *
 * Phase 1A of the large-file-performance plan.
 *
 * Design contract (per explicit product requirement): the horizontal scrollbar
 * must be the CORRECT size from the start and must NOT change size as more of
 * the file is measured. There is therefore no approximate/background widening:
 *
 *   - on load the editor calls `measureRange(1, lineCount)` — a single
 *     synchronous pass (<10ms for a 3MB/100k-line document), so `maxColumns`
 *     is exact before the first paint
 *   - on edit the editor re-measures ONLY the touched lines (never the whole
 *     file), and the running max is kept exact via `recomputeMax()` whenever a
 *     previously-max line shrinks
 *
 * Per-line widths are cached in a Map so repeated edits never rescan untouched
 * lines. The measure callback is injected (SOLID DIP) so tests can spy on it.
 */

export interface ILineWidthTracker {
  /** Best-known maximum visible columns across the file (exact). */
  readonly maxColumns: number;
  /** Cached columns for one line, or `undefined` if not measured. */
  get(lineNumber: number): number | undefined;
  /** Measures one line, caches it, and raises the max if needed. */
  measure(lineNumber: number): number;
  /** Measures a contiguous range synchronously (start..end inclusive). */
  measureRange(startLine: number, endLine: number): void;
  /** Drops one line from the cache and recomputes the max if the max dropped. */
  invalidateLine(lineNumber: number): void;
  /** Drops every cached line >= lineNumber (line insert/delete shifts). */
  invalidateFrom(lineNumber: number): void;
  /** Re-scans the cache to recompute the max (after the max line shrank). */
  recomputeMax(): void;
  /** Clears the cache and max. */
  reset(): void;
}

export class LineWidthTracker implements ILineWidthTracker {
  private readonly _measure: (lineNumber: number) => number;
  private readonly _cache = new Map<number, number>();
  private _max = 0;

  constructor(measure: (lineNumber: number) => number) {
    this._measure = measure;
  }

  get maxColumns(): number {
    return this._max;
  }

  get(lineNumber: number): number | undefined {
    return this._cache.get(lineNumber);
  }

  measure(lineNumber: number): number {
    const width = this._measure(lineNumber);
    this._cache.set(lineNumber, width);
    if (width > this._max) this._max = width;
    return width;
  }

  measureRange(startLine: number, endLine: number): void {
    for (let line = startLine; line <= endLine; line++) {
      this.measure(line);
    }
  }

  invalidateLine(lineNumber: number): void {
    const removed = this._cache.get(lineNumber);
    this._cache.delete(lineNumber);
    if (removed !== undefined && removed >= this._max) {
      this.recomputeMax();
    }
  }

  invalidateFrom(lineNumber: number): void {
    let mayHaveRemovedMax = false;
    for (const key of this._cache.keys()) {
      if (key >= lineNumber) {
        if ((this._cache.get(key) as number) >= this._max) mayHaveRemovedMax = true;
        this._cache.delete(key);
      }
    }
    if (mayHaveRemovedMax) this.recomputeMax();
  }

  recomputeMax(): void {
    let max = 0;
    for (const width of this._cache.values()) {
      if (width > max) max = width;
    }
    this._max = max;
  }

  reset(): void {
    this._cache.clear();
    this._max = 0;
  }
}
