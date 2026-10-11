/**
 * FoldLineIndex — model-line ↔ visible-line mapping when lines are folded.
 *
 * Folding hides a model line entirely (it contributes ZERO visible lines), so
 * the editor must account for the reduced line count when scrolling, rendering
 * and numbering. This index is the non-wrapped analogue of `WrappedLineIndex`:
 * it builds a cumulative prefix of *visible* lines (one per non-hidden model
 * line) so the editor can, in O(1) after a lazy build, answer:
 *
 *   - how many visible lines exist total (scroll height),
 *   - at which visible line a model line begins (its render `top`), and
 *   - which model line a given visible line corresponds to (scroll window).
 *
 * Edits invalidate from a model line onward and the prefixes rebuild lazily on
 * the next access, matching the wrapped index's performance model.
 */

export interface IFoldProvider {
  /** Whether a model line (1-based) is currently hidden by a collapsed fold. */
  isHidden(modelLine: number): boolean;
}

export class FoldLineIndex {
  private readonly _provider: IFoldProvider;
  private _totalModelLineCount = 0;
  /** cumVisible[m] = number of VISIBLE lines among model lines 1..m. */
  private readonly _cum: number[] = [];
  /** Number of model lines whose cum value is committed into `_cum`. */
  private _built = 0;

  constructor(provider: IFoldProvider) {
    this._provider = provider;
  }

  setTotalModelLineCount(count: number): void {
    const prev = this._totalModelLineCount;
    this._totalModelLineCount = count;
    if (count < prev) {
      if (this._built > count) {
        this._built = count;
        this._cum.length = Math.max(0, count);
      }
    }
  }

  /** Mark everything from a model line onward as stale (fold state or content
   *  changed below it). Rebuilt lazily on next access. */
  invalidateFrom(modelLine: number): void {
    if (modelLine < 1) modelLine = 1;
    this._built = Math.min(this._built, modelLine - 1);
    this._cum.length = Math.max(0, modelLine - 1);
  }

  /** Total number of visible (non-hidden) lines in the document. */
  get totalVisibleLineCount(): number {
    if (this._totalModelLineCount <= 0) return 0;
    this._ensure(this._totalModelLineCount);
    return this._cum[this._totalModelLineCount - 1];
  }

  /** Number of visible lines among model lines 1..m (0 when m < 1). */
  visibleCountThrough(m: number): number {
    if (m < 1) return 0;
    if (m > this._totalModelLineCount) m = this._totalModelLineCount;
    this._ensure(m);
    return this._cum[m - 1];
  }

  /** 1-based visible line at which model line `m` begins. For a hidden line
   *  this is where it WOULD begin (the same visible index as the next visible
   *  line) — safe for binary search, never used for trendering. */
  getVisibleLineStart(modelLine: number): number {
    if (modelLine < 1) return 1;
    if (modelLine > this._totalModelLineCount) return this.totalVisibleLineCount + 1;
    return this.visibleCountThrough(modelLine - 1) + 1;
  }

  /**
   * Resolve a 1-based visible line to its model line. Returns 0 for an
   * out-of-range or hidden-position visible line.
   */
  findModelLine(visibleLine: number): number {
    if (visibleLine < 1 || this._totalModelLineCount <= 0) return 0;
    this._ensure(this._totalModelLineCount);

    // Binary search greatest m with cum[m-1] < visibleLine... i.e. the model
    // line whose visible span contains `visibleLine`. `_cum` is non-decreasing
    // and each visible line belongs to exactly one visible model line, so we
    // find the first m where cum[m] >= visibleLine; that m is hidden iff its
    // own line is not visible (cum[m] === cum[m-1]); skip it.
    let lo = 0;
    let hi = this._cum.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._cum[mid] >= visibleLine) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (ans < 0) return 0;
    let m = ans + 1;
    // A hidden line shares its cum with its predecessor, so it can't be the
    // owner of exactly `visibleLine`; walk forward to the first visible line.
    while (m <= this._totalModelLineCount && this._provider.isHidden(m)) m++;
    if (m > this._totalModelLineCount) return 0;
    return m;
  }

  /** Ensure `_cum` is computed through the given model line (inclusive). */
  private _ensure(throughModelLine: number): void {
    const target = Math.min(throughModelLine, this._totalModelLineCount);
    while (this._built < target) {
      const m = this._built + 1;
      const prev = this._built === 0 ? 0 : this._cum[this._built - 1];
      this._cum.push(prev + (this._provider.isHidden(m) ? 0 : 1));
      this._built++;
    }
  }
}
