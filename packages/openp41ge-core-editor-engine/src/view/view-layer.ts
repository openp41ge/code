/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * RenderedLinesCollection — manages a sliding window of visible rendered lines.
 *
 * Maintains an ordered list of rendered line objects. As the user scrolls,
 * lines at the top of the viewport are removed and lines at the bottom are
 * added, or vice versa. Lines are recycled to avoid GC pressure.
 *
 * This is the core virtual-scrolling data structure for the viewport.
 * It tracks which document lines are currently rendered and provides
 * O(1) access to rendered line objects by document line number.
 *
 * T is the line type (e.g., ViewLine).
 */

export interface IRenderedLine<T> {
  /** The 1-based line number in the document. */
  lineNumber: number;
}

export interface IRenderedLinesCollection<T extends IRenderedLine<T>> {
  /**
   * The first rendered line number (1-based), or 0 if empty.
   */
  readonly startLineNumber: number;
  /**
   * The last rendered line number (1-based), or 0 if empty.
   */
  readonly endLineNumber: number;
  /**
   * Number of rendered lines.
   */
  readonly count: number;
  /**
   * Get a rendered line by document line number.
   * Returns undefined if the line is not in the rendered window.
   */
  getLine(lineNumber: number): T | undefined;
  /**
   * Get all currently rendered lines in order.
   */
  getLines(): T[];
}

export class RenderedLinesCollection<
  T extends IRenderedLine<T>,
> implements IRenderedLinesCollection<T> {
  private _lines: T[] = [];
  private _startLineNumber: number = 0;
  private _endLineNumber: number = 0;

  constructor() {}

  get startLineNumber(): number {
    return this._startLineNumber;
  }

  get endLineNumber(): number {
    return this._endLineNumber;
  }

  get count(): number {
    return this._lines.length;
  }

  /**
   * Get a rendered line by document line number.
   */
  getLine(lineNumber: number): T | undefined {
    const index = lineNumber - this._startLineNumber;
    if (index < 0 || index >= this._lines.length) {
      return undefined;
    }
    return this._lines[index];
  }

  /**
   * Get all currently rendered lines in order.
   */
  getLines(): T[] {
    return this._lines.slice();
  }

  /**
   * Replace the entire collection with a new set of lines.
   * The start and end line numbers define the document range.
   *
   * @param startLineNumber - 1-based first line number.
   * @param lines - The line objects in order.
   */
  replace(startLineNumber: number, lines: T[]): void {
    this._startLineNumber = startLineNumber;
    this._endLineNumber = startLineNumber + lines.length - 1;
    this._lines = lines;
  }

  /**
   * Remove lines at the top of the rendered window.
   * Returns the removed lines.
   */
  removeLinesFromTop(count: number): T[] {
    const removed = this._lines.splice(0, count);
    this._startLineNumber += count;
    if (this._lines.length === 0) {
      this._startLineNumber = 0;
      this._endLineNumber = 0;
    }
    return removed;
  }

  /**
   * Remove lines at the bottom of the rendered window.
   * Returns the removed lines.
   */
  removeLinesFromBottom(count: number): T[] {
    const removed = this._lines.splice(this._lines.length - count, count);
    this._endLineNumber -= count;
    if (this._lines.length === 0) {
      this._startLineNumber = 0;
      this._endLineNumber = 0;
    }
    return removed;
  }

  /**
   * Add lines to the top of the rendered window.
   */
  prependLines(lines: T[]): void {
    this._startLineNumber -= lines.length;
    this._lines.unshift(...lines);
  }

  /**
   * Add lines to the bottom of the rendered window.
   */
  appendLines(lines: T[]): void {
    this._endLineNumber += lines.length;
    this._lines.push(...lines);
  }

  /**
   * Clear all lines.
   */
  clear(): void {
    this._lines = [];
    this._startLineNumber = 0;
    this._endLineNumber = 0;
  }
}
