/**
 * StringBuilder — efficient string builder for rendering output.
 *
 * Avoids the overhead of repeated string concatenation by accumulating
 * parts in an array and joining at the end.
 */
export class StringBuilder {
  private _chunks: string[] = [];
  private _length: number = 0;

  /**
   * Append a string.
   */
  append(str: string): void {
    this._chunks.push(str);
    this._length += str.length;
  }

  /**
   * Append a single character repeated n times.
   */
  appendRepeated(char: string, count: number): void {
    if (count <= 0) return;
    if (count === 1) {
      this.append(char);
      return;
    }
    this.append(char.repeat(count));
  }

  /**
   * Escape HTML and append.
   */
  appendEscaped(str: string): void {
    this.append(this.escapeHtml(str));
  }

  /**
   * Append a newline.
   */
  appendNewLine(): void {
    this.append("\n");
  }

  /**
   * Get the current length.
   */
  get length(): number {
    return this._length;
  }

  /**
   * Build the final string.
   */
  build(): string {
    return this._chunks.join("");
  }

  /**
   * Clear the builder for reuse.
   */
  reset(): void {
    this._chunks = [];
    this._length = 0;
  }

  /**
   * Escape HTML special characters.
   */
  static escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private escapeHtml(str: string): string {
    return StringBuilder.escapeHtml(str);
  }
}
