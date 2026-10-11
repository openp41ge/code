/**
 * ContiguousTokensStore — O(1) token lookup by line number.
 *
 * Stores decoded IToken[] arrays indexed by 1-based line number.
 * Designed for the rendering layer to quickly fetch tokens for visible lines.
 * Automatically invalidates tokens for lines that change (e.g., after an edit).
 */

import type { IToken } from "./line-tokens";

export class ContiguousTokensStore {
  /** Maps 1-based line number to decoded IToken[] array. */
  private _tokens: Map<number, IToken[]> = new Map();

  /** The last line that was stored (for iteration purposes). */
  private _maxLine: number = 0;

  /** The version counter for invalidation tracking. */
  private _version: number = 0;

  /**
   * Get tokens for a specific line.
   * Returns null if the line hasn't been tokenized yet.
   */
  getTokens(lineNumber: number): IToken[] | null {
    return this._tokens.get(lineNumber) ?? null;
  }

  /**
   * Store tokens for a specific line.
   *
   * @param lineNumber - 1-based line number.
   * @param tokens - The decoded tokens for this line.
   */
  setTokens(lineNumber: number, tokens: IToken[]): void {
    this._tokens.set(lineNumber, tokens);
    if (lineNumber > this._maxLine) {
      this._maxLine = lineNumber;
    }
    this._version++;
  }

  /**
   * Invalidate tokens for a range of lines (e.g., after inserting/deleting lines).
   * With the new line count, lines after the range shift and lose their tokens.
   *
   * @param startLine - 1-based start line of the change.
   * @param linesRemoved - Number of lines removed (0 if only insertion).
   * @param linesAdded - Number of lines added (0 if only deletion).
   * @param totalLineCount - The new total line count after the change.
   */
  invalidateLines(
    startLine: number,
    linesRemoved: number,
    linesAdded: number,
    totalLineCount: number,
  ): void {
    // Remove tokens for all affected lines
    // Always invalidate at least the startLine itself (content changed)
    const endRemove = startLine + Math.max(linesRemoved, linesAdded, 1) - 1;
    for (let line = startLine; line <= endRemove; line++) {
      this._tokens.delete(line);
    }

    // Shift tokens for lines after the change
    const shift = linesAdded - linesRemoved;
    if (shift !== 0) {
      const keys = Array.from(this._tokens.keys()).sort((a, b) => (shift > 0 ? b - a : a - b));
      for (const key of keys) {
        if (key >= startLine) {
          const value = this._tokens.get(key)!;
          this._tokens.delete(key);
          this._tokens.set(key + shift, value);
        }
      }
      // After shifting, re-invalidate the startLine: its content has changed
      // but something may have been shifted INTO startLine from further down.
      // Without this, the stale shifted tokens would be returned by hasTokens().
      this._tokens.delete(startLine);
    }

    this._maxLine = totalLineCount;
    this._version++;
  }

  /**
   * Clear all tokens (e.g., when the entire file is replaced).
   */
  /**
   * Delete tokens for a single line.
   */
  deleteLine(lineNumber: number): void {
    this._tokens.delete(lineNumber);
  }

  clear(): void {
    this._tokens.clear();
    this._maxLine = 0;
    this._version++;
  }

  /**
   * Get the current version. Useful for change detection.
   */
  get version(): number {
    return this._version;
  }

  /**
   * Check if a line has been tokenized.
   */
  hasTokens(lineNumber: number): boolean {
    return this._tokens.has(lineNumber);
  }

  /**
   * Get the highest line number that has stored tokens.
   */
  get maxLine(): number {
    return this._maxLine;
  }

  /**
   * Get the total number of tokenized lines.
   */
  get size(): number {
    return this._tokens.size;
  }
}
