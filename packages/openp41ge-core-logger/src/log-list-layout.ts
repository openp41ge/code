/**
 * log-list-layout.ts — pure windowing math for a variable-height virtual list.
 *
 * The log viewer calls `setCount`/`append`/`prepend` to describe how many items it
 * is displaying, feeds measured pixel heights back via `updateHeights`, and asks
 * `window(scrollTop, viewportHeight)` for the visible slice. The DOM nodes rendered
 * therefore stay bounded by the viewport regardless of how many entries are loaded.
 *
 * This module has no DOM / framework dependency so it is unit-testable in isolation.
 */

/** Height estimate used for items that have not been measured yet. */
export const DEFAULT_ITEM_ESTIMATE = 18;

export interface WindowSlice {
  /** First item index to render (inclusive). */
  start: number;
  /** Last item index + 1 (exclusive). */
  end: number;
  /** Total pixel height of items before `start` (top spacer height). */
  offsetTop: number;
  /** Total pixel height of items after `end` (bottom spacer height). */
  offsetBottom: number;
}

export class LogListLayout {
  private _heights: number[] = [];
  /** Prefix sums: `_offsets[i]` is the pixel offset of item `i`; length is count+1. */
  private _offsets: number[] = [0];
  private _estimate: number;

  constructor(estimate = DEFAULT_ITEM_ESTIMATE) {
    this._estimate = Math.max(1, Math.round(estimate));
  }

  /** The currently loaded item count. */
  get count(): number {
    return this._heights.length;
  }

  /** Total content height in pixels (sum of all item heights). */
  get totalHeight(): number {
    return this._offsets[this._offsets.length - 1] ?? 0;
  }

  /** Replace the entire item count, resetting every height to the estimate. */
  setCount(count: number): void {
    const n = Math.max(0, Math.floor(count));
    this._heights = new Array<number>(n).fill(this._estimate);
    this._rebuild();
  }

  /** Append `count` items at the end (estimated height). Cheap — no rebuild. */
  append(count: number): void {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return;
    const off = this._offsets;
    const last = off[off.length - 1] ?? 0;
    for (let i = 0; i < n; i++) {
      this._heights.push(this._estimate);
      off.push(last + (i + 1) * this._estimate);
    }
  }

  /** Prepend `count` items at the front (estimated height). Shifts existing items. */
  prepend(count: number): void {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return;
    this._heights = [...new Array<number>(n).fill(this._estimate), ...this._heights];
    this._rebuild();
  }

  /**
   * Apply measured pixel heights for specific item indices, then rebuild the
   * offset table exactly once. Returns true if any height changed.
   */
  updateHeights(updates: ReadonlyArray<[index: number, height: number]>): boolean {
    let changed = false;
    for (const [index, height] of updates) {
      const i = Math.floor(index);
      if (i < 0 || i >= this._heights.length) continue;
      const h = Math.max(1, Math.round(height));
      if (this._heights[i] !== h) {
        this._heights[i] = h;
        changed = true;
      }
    }
    if (changed) this._rebuild();
    return changed;
  }

  /**
   * The pixel offset of the top of item `index` (i.e. the sum of all item
   * heights before it). Clamps out-of-range indices to the nearest valid one;
   * returns 0 when the list is empty. Used to scroll a specific item into view.
   */
  offsetAt(index: number): number {
    const n = this._heights.length;
    if (n === 0) return 0;
    // Clamp to [0, count] so a far-past request returns the total height and a
    // negative request returns the top spacer's 0.
    const i = Math.min(n, Math.max(0, Math.floor(index)));
    return this._offsets[i] ?? 0;
  }

  /** The estimate used for items that have not been measured yet. */
  get estimate(): number {
    return this._estimate;
  }

  /**
   * Update the height estimate used for unmeasured items, re-seeding every item
   * that still carries the *previous* estimate (i.e. anything never measured).
   * Measured items keep their real height. Returns true if the offset table
   * changed and the layout needs re-rendering. This keeps the offset math exact
   * even for far-away items that were never rendered, so jump-to-match lands
   * precisely instead of drifting by the accumulated estimate error.
   */
  setDefaultHeight(height: number): boolean {
    const h = Math.max(1, Math.round(height));
    if (h === this._estimate) return false;
    const old = this._estimate;
    this._estimate = h;
    let changed = false;
    for (let i = 0; i < this._heights.length; i++) {
      if (this._heights[i] === old) {
        this._heights[i] = h;
        changed = true;
      }
    }
    if (changed) this._rebuild();
    return changed;
  }

  /**
   * The index of the item whose vertical span contains `px`. Items start at
   * `_offsets[i]`; the largest `i` with `_offsets[i] <= px` owns `px`.
   */
  indexAt(px: number): number {
    const off = this._offsets;
    if (off.length <= 1) return 0;
    const target = Math.max(0, px);
    let lo = 0;
    let hi = off.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (off[mid] <= target) lo = mid;
      else hi = mid - 1;
    }
    return Math.min(lo, this._heights.length - 1);
  }

  /**
   * Compute the window of items that intersect the viewport, with `overscan`
   * extra items above and below so fast scrolls don't flash empty space.
   */
  window(scrollTop: number, viewportHeight: number, overscan = 5): WindowSlice {
    const n = this._heights.length;
    if (n === 0 || viewportHeight <= 0) {
      return { start: 0, end: n, offsetTop: 0, offsetBottom: 0 };
    }
    const top = Math.max(0, scrollTop);
    const bottom = top + viewportHeight;

    let start = this.indexAt(top) - overscan;
    let end = this.indexAt(bottom) + 1 + overscan;
    start = Math.max(0, start);
    end = Math.min(n, end);
    if (end <= start) end = Math.min(n, start + 1);

    const offsetTop = this._offsets[start] ?? 0;
    const offsetBottom = this.totalHeight - (this._offsets[end] ?? this.totalHeight);
    return { start, end, offsetTop, offsetBottom };
  }

  private _rebuild(): void {
    const off = this._offsets;
    off.length = 0;
    let sum = 0;
    off.push(0);
    for (const h of this._heights) {
      sum += h;
      off.push(sum);
    }
  }
}
