/**
 * Piece — a reference to a contiguous region of a StringBuffer.
 *
 * Each piece represents a segment of the document. The document is
 * composed of pieces stored in a red-black tree, ordered by offset.
 * Pieces are immutable — edits create new pieces rather than modifying
 * existing ones.
 */

/**
 * Cursor position within a StringBuffer.
 */
export interface BufferCursor {
  /** 0-based line index in the buffer. */
  readonly line: number;
  /** 0-based column offset on the line. */
  readonly column: number;
}

export class Piece {
  constructor(
    /** Index into the PieceTreeBase._buffers array. */
    readonly bufferIndex: number,
    /** Start position within the buffer. */
    readonly start: BufferCursor,
    /** End position within the buffer. */
    readonly end: BufferCursor,
    /** Number of line feeds (\n) in this piece. */
    readonly lineFeedCnt: number,
    /** Total character length of this piece. */
    readonly length: number,
  ) {}

  /**
   * Create a new Piece that is a sub-range of this piece.
   */
  slice(newStart: BufferCursor, newEnd: BufferCursor): Piece {
    const newLength = this._measureLength(newStart, newEnd);
    const newLf = this._measureLineFeeds(newStart, newEnd);
    return new Piece(this.bufferIndex, newStart, newEnd, newLf, newLength);
  }

  private _measureLength(start: BufferCursor, end: BufferCursor): number {
    if (start.line === end.line) {
      return end.column - start.column;
    }
    // We don't have access to the buffer here, so we approximate.
    // Actual length is computed by PieceTreeBase which has buffer access.
    // This method is kept for API consistency.
    return -1; // caller should use PieceTreeBase's measurement
  }

  private _measureLineFeeds(start: BufferCursor, end: BufferCursor): number {
    if (start.line === end.line) {
      return 0;
    }
    return end.line - start.line;
  }
}
