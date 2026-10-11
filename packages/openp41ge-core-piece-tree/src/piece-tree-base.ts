/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, max-classes-per-file */
/**
 * PieceTreeBase — the core data structure for document storage.
 *
 * Stores document text as a red-black tree of Pieces, where each Piece
 * references a sub-range of a StringBuffer. This enables O(log n) insert
 * and delete operations rather than O(n) string rebuilding.
 *
 * Based on the architecture of VS Code's PieceTreeBase / pieceTreeBase.ts.
 */

import {
  TreeNode,
  SENTINEL,
  leftest,
  next,
  prev,
  findAtOffset,
  findAtLineNumber,
  fixInsert,
  rbDelete,
  updateTreeMetadata,
  initTreeNode,
} from "./rb-tree-base";
import { Piece, type BufferCursor } from "./piece";
import { StringBuffer, createLineStartsFast, type LineStarts } from "./text-buffer";
import { CharCode } from "./char-code";

/**
 * The line ending sequence to use.
 */
export type EOL = "\n" | "\r\n";

/**
 * A position within the document (1-based).
 */

/**
 * A sub-range of text within the document.
 */

/**
 * Search result from findMatchesLineByLine.
 */
export interface FindMatch {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  matches: string[];
}

/**
 * LRU cache for node position lookups.
 */
class SearchCache {
  private _cache: Array<{
    node: TreeNode;
    nodeStartOffset: number;
    nodeStartLineNumber?: number;
  } | null>;
  private _limit: number;

  constructor(limit: number) {
    this._limit = limit;
    this._cache = [];
  }

  get(offset: number): { node: TreeNode; nodeStartOffset: number } | null {
    for (let i = this._cache.length - 1; i >= 0; i--) {
      const entry = this._cache[i];
      if (
        entry &&
        entry.nodeStartOffset <= offset &&
        entry.nodeStartOffset + entry.node.piece.length >= offset
      ) {
        return entry;
      }
    }
    return null;
  }

  getByLine(
    lineNumber: number,
  ): { node: TreeNode; nodeStartOffset: number; nodeStartLineNumber: number } | null {
    for (let i = this._cache.length - 1; i >= 0; i--) {
      const entry = this._cache[i];
      if (
        entry &&
        entry.nodeStartLineNumber &&
        entry.nodeStartLineNumber <= lineNumber &&
        entry.nodeStartLineNumber + entry.node.piece.lineFeedCnt >= lineNumber
      ) {
        return entry as { node: TreeNode; nodeStartOffset: number; nodeStartLineNumber: number };
      }
    }
    return null;
  }

  set(entry: { node: TreeNode; nodeStartOffset: number; nodeStartLineNumber?: number }): void {
    if (this._cache.length >= this._limit) {
      this._cache.shift();
    }
    this._cache.push(entry);
  }

  validate(offset: number): void {
    this._cache = this._cache.filter(
      (entry) => entry !== null && entry.node.parent !== null && entry.nodeStartOffset < offset,
    );
  }
}

export class PieceTreeBase {
  /** The root node of the red-black tree. */
  root: TreeNode = SENTINEL;

  /** Array of StringBuffers. Index 0 is the mutable change buffer. */
  protected _buffers: StringBuffer[] = [];

  /** Total number of lines in the document. */
  protected _lineCnt: number = 1;

  /** Total character length of the document. */
  protected _length: number = 0;

  /** The EOL sequence used by this document. */
  protected _EOL: EOL = "\n";

  /** Length of the EOL sequence. */
  protected _EOLLength: number = 1;

  /** Whether EOL has been normalized. */
  protected _EOLNormalized: boolean = false;

  /** Position tracker for the change buffer. */
  private _lastChangeBufferPos: BufferCursor = { line: 0, column: 0 };

  /** Search cache for fast offset lookups. */
  private _searchCache: SearchCache = new SearchCache(1);

  /** Cache for the last visited line (avoids repeated tree walks for sequential access). */
  private _lastVisitedLine: { lineNumber: number; value: string } | null = null;

  constructor(chunks: StringBuffer[], eol: EOL, eolNormalized: boolean) {
    this.create(chunks, eol, eolNormalized);
  }

  create(chunks: StringBuffer[], eol: EOL, eolNormalized: boolean): void {
    this._buffers = [new StringBuffer("", [0]), ...chunks];
    this._lastChangeBufferPos = { line: 0, column: 0 };
    this.root = SENTINEL;
    this._lineCnt = 1;
    this._length = 0;
    this._EOL = eol;
    this._EOLLength = eol.length;
    this._EOLNormalized = eolNormalized;
    this._searchCache = new SearchCache(1);
    this._lastVisitedLine = null;

    let lastNode: TreeNode | null = null;

    for (let i = 0, len = chunks.length; i < len; i++) {
      if (chunks[i].buffer.length > 0) {
        const piece = new Piece(
          i + 1, // bufferIndex (0 is change buffer, so initial buffers start at 1)
          { line: 0, column: 0 },
          {
            line: chunks[i].lineCount - 1,
            column: this._getLineLength(chunks[i], chunks[i].lineCount - 1),
          },
          chunks[i].lineCount - 1,
          chunks[i].buffer.length,
        );
        this._insertNode(piece, lastNode);
        lastNode = this.root;
        this._lineCnt += chunks[i].lineCount - 1;
        this._length += chunks[i].buffer.length;
      }
    }

    // Ensure root is black
    if (this.root !== SENTINEL) {
      this.root.color = 1; // Black
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  getLineCount(): number {
    return this._lineCnt;
  }

  getLength(): number {
    return this._length;
  }

  getEOL(): EOL {
    return this._EOL;
  }

  setEOL(eol: EOL): void {
    this._EOL = eol;
    this._EOLLength = eol.length;
  }

  /**
   * Get the text content of a line (1-based).
   */
  getLineContent(lineNumber: number): string {
    if (lineNumber < 1 || lineNumber > this._lineCnt) return "";

    // Check cache
    if (this._lastVisitedLine && this._lastVisitedLine.lineNumber === lineNumber) {
      return this._lastVisitedLine.value;
    }

    const pos = this.nodeAt2(lineNumber, 1);
    if (pos.node === SENTINEL) return "";

    const buffer = this._buffers[pos.node.piece.bufferIndex];
    const piece = pos.node.piece;

    if (pos.remainder === 0) {
      // We're at the start of a line — need to find the actual line content
      return this._getLineFromNode(pos.node, lineNumber);
    }

    const result = this._getLineFromNode(pos.node, lineNumber);
    this._lastVisitedLine = { lineNumber, value: result };
    return result;
  }

  /**
   * Get the text of a range.
   */
  getValueInRange(startLine: number, startCol: number, endLine: number, endCol: number): string {
    if (startLine === endLine && startCol === endCol) return "";

    const startOffset = this.getOffsetAt(startLine, startCol);
    const endOffset = this.getOffsetAt(endLine, endCol);
    return this._getTextFromOffset(startOffset, endOffset - startOffset);
  }

  /**
   * Get the full text of the document.
   */
  getValue(eol?: EOL): string {
    const targetEOL = eol || this._EOL;
    const parts: string[] = [];

    if (this.root === SENTINEL) return "";

    this.iterate(this.root, (node: TreeNode) => {
      if (node === SENTINEL) return true;
      const buffer = this._buffers[node.piece.bufferIndex];
      const text = this._getPieceText(node.piece, buffer);
      parts.push(text);
      return true;
    });

    let result = parts.join("");

    // Normalize EOL if requested
    if (targetEOL !== "\n") {
      result = result.replace(/\n/g, targetEOL);
    }

    return result;
  }

  /**
   * Get the character offset for a line/column position (1-based).
   */
  getOffsetAt(lineNumber: number, column: number): number {
    const pos = this.nodeAt2(lineNumber, column);
    if (pos.node === SENTINEL) return this._length;

    const buffer = this._buffers[pos.node.piece.bufferIndex];
    const piece = pos.node.piece;

    // Find the offset within the piece
    const pieceStartOffset = this._getPieceStartOffset(pos.node);
    const lineIdx = piece.start.line + pos.remainder - 1;

    if (lineIdx < 0 || lineIdx >= buffer.lineStarts.length) {
      return pieceStartOffset;
    }

    const lineStartInBuffer = buffer.lineStarts[lineIdx] as number;
    const pieceStartInBuffer = (buffer.lineStarts[piece.start.line] as number) + piece.start.column;
    const colInLine = column - 1; // convert to 0-based

    // Cap column at line length
    const lineLen = this._getLineLength(buffer, lineIdx);
    const actualCol = Math.min(colInLine, lineLen);

    // Offset = piece start in document + line offset within piece + column within line
    const lineOffsetWithinPiece = lineStartInBuffer - pieceStartInBuffer;
    return pieceStartOffset + lineOffsetWithinPiece + actualCol;
  }

  /**
   * Get the line/column position for a character offset (0-based).
   */
  getPositionAt(offset: number): { lineNumber: number; column: number } {
    if (offset < 0) offset = 0;
    if (offset >= this._length) {
      return { lineNumber: this._lineCnt, column: this._getLineLengthAtLine(this._lineCnt) + 1 };
    }

    const pos = this.nodeAt(offset);
    if (pos.node === SENTINEL) {
      return { lineNumber: 1, column: 1 };
    }

    const buffer = this._buffers[pos.node.piece.bufferIndex];
    const piece = pos.node.piece;
    const offsetInPiece = pos.remainder;

    // Binary search within the piece's buffer lines to find which line
    const lineIdx = this._findLineInBuffer(buffer, piece, offsetInPiece);

    // Compute the column within the line
    const lineStartInBuffer = buffer.lineStarts[lineIdx] as number;
    const pieceStartInBuffer = (buffer.lineStarts[piece.start.line] as number) + piece.start.column;
    const colInLine = offsetInPiece - (lineStartInBuffer - pieceStartInBuffer);

    // Compute the model line number by walking the tree
    const modelLineNumber = this._getLineNumberForNode(pos.node, pos.nodeStartOffset);
    const lineIndex = pos.nodeStartOffset === undefined ? 0 : lineIdx - piece.start.line;

    return {
      lineNumber: modelLineNumber + lineIndex,
      column: Math.max(1, colInLine + 1),
    };
  }

  /**
   * Insert text at the given offset.
   */
  insert(offset: number, text: string, _incrementBuffer: boolean = true): void {
    if (text.length === 0) return;

    // Normalize line endings in the inserted text
    const normalized = text.replace(/\r\n/g, "\n");

    // For correctness, rebuild the entire tree from a single string.
    // This is O(n) but correct for all insert positions.
    const before = this._getTextFromOffset(0, offset);
    const after = this._getTextFromOffset(offset, this._length - offset);
    const newText = before + normalized + after;
    this._rebuildTreeFromBuffer(newText);
  }

  /**
   * Delete text at the given offset with the given length.
   */
  delete(offset: number, length: number): void {
    if (length === 0) return;

    // For correctness, rebuild the entire tree from a single string.
    // This is O(n) but correct for all delete positions.
    const before = this._getTextFromOffset(0, offset);
    const after = this._getTextFromOffset(offset + length, this._length - offset - length);
    const newText = before + after;
    this._rebuildTreeFromBuffer(newText);
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  /**
   * Find the node containing the given character offset.
   */
  nodeAt(offset: number): { node: TreeNode; remainder: number; nodeStartOffset: number } {
    // Check cache
    const cached = this._searchCache.get(offset);
    if (cached) {
      return {
        node: cached.node,
        remainder: offset - cached.nodeStartOffset,
        nodeStartOffset: cached.nodeStartOffset,
      };
    }

    const result = findAtOffset(this.root, offset);
    if (result.node !== SENTINEL) {
      this._searchCache.set({ node: result.node, nodeStartOffset: result.nodeStartOffset });
    }
    return result;
  }

  /**
   * Find the node containing the given line/column position.
   */
  nodeAt2(
    lineNumber: number,
    _column: number,
  ): { node: TreeNode; remainder: number; nodeStartOffset: number } {
    // Check cache
    const cached = this._searchCache.getByLine(lineNumber);
    if (cached) {
      const lineOffset = lineNumber - cached.nodeStartLineNumber;
      const node = cached.node;
      // Approximate: find the line's offset within the piece
      const buffer = this._buffers[node.piece.bufferIndex];
      const pieceLineStart = node.piece.start.line + lineOffset;
      if (pieceLineStart <= node.piece.end.line) {
        const lineStartInBuffer = buffer.lineStarts[pieceLineStart] as number;
        const pieceStartInBuffer = buffer.lineStarts[node.piece.start.line] as number;
        const colOffsetInPiece = lineStartInBuffer - pieceStartInBuffer + node.piece.start.column;
        return {
          node,
          remainder: lineOffset + 1,
          nodeStartOffset: cached.nodeStartOffset + colOffsetInPiece,
        };
      }
    }

    const lineResult = findAtLineNumber(this.root, lineNumber);
    if (lineResult.node === SENTINEL) {
      return { node: SENTINEL, remainder: 0, nodeStartOffset: 0 };
    }

    const node = lineResult.node;
    const lineRemainder = lineResult.lineRemainder;
    const offset = this._getOffsetForNodeLine(node, lineResult.nodeStartLine, lineRemainder);
    this._searchCache.set({
      node,
      nodeStartOffset: offset - (lineRemainder - 1),
      nodeStartLineNumber: lineResult.nodeStartLine,
    });

    return { node, remainder: lineRemainder, nodeStartOffset: offset };
  }

  /**
   * Iterate tree nodes in-order.
   */
  iterate(node: TreeNode, callback: (node: TreeNode) => boolean): void {
    if (node === SENTINEL) return;
    if (node.left !== SENTINEL) {
      this.iterate(node.left, callback);
    }
    if (!callback(node)) return;
    if (node.right !== SENTINEL) {
      this.iterate(node.right, callback);
    }
  }

  /**
   * Get the text content of a piece from its buffer.
   */
  getPieceContent(piece: Piece): string {
    const buffer = this._buffers[piece.bufferIndex];
    return this._getPieceText(piece, buffer);
  }

  /**
   * Extract text from a range of the buffer.
   */
  _getPieceText(piece: Piece, buffer: StringBuffer): string {
    const startOffset = (buffer.lineStarts[piece.start.line] as number) + piece.start.column;
    const endOffset = (buffer.lineStarts[piece.end.line] as number) + piece.end.column;
    return buffer.buffer.substring(startOffset, endOffset);
  }

  /**
   * Get the global offset of the start of a node's piece.
   */
  private _getPieceStartOffset(node: TreeNode): number {
    let offset = node.size_left;
    let current: TreeNode = node;
    while (current.parent !== SENTINEL) {
      if (current === current.parent.right) {
        offset += current.parent.size_left + current.parent.piece.length;
      }
      current = current.parent;
    }
    return offset;
  }

  /**
   * Insert a node into the tree.
   */
  private _insertNode(piece: Piece, lastNode: TreeNode | null): void {
    const newNode = new TreeNode(piece);
    initTreeNode(newNode);

    if (this.root === SENTINEL) {
      this.root = newNode;
      this.root.color = 1; // Black
      updateTreeMetadata(this.root);
      return;
    }

    let current = this.root;
    let parent = SENTINEL;

    // Find insertion point using offset (we insert pieces at the end)
    while (current !== SENTINEL) {
      parent = current;
      // Always go right for appending
      current = current.right;
    }

    newNode.parent = parent;
    if (parent === SENTINEL) {
      this.root = newNode;
    } else {
      parent.right = newNode;
    }

    // Fix the tree
    newNode.left = SENTINEL;
    newNode.right = SENTINEL;
    newNode.color = 0; // Red

    // Walk up updating metadata
    let n: TreeNode = newNode;
    while (n !== SENTINEL) {
      updateTreeMetadata(n);
      n = n.parent;
    }

    fixInsert({ root: this.root as any }, newNode);
    // fixInsert replaces root, so update
    this.root = (this.root as any).constructor === TreeNode ? this.root : (this.root as any);
  }

  /**
   * Get the text content from a specific line of a node.
   */
  private _getLineFromNode(node: TreeNode, lineNumber: number): string {
    const buffer = this._buffers[node.piece.bufferIndex];
    const piece = node.piece;

    // Determine which line in the buffer corresponds to the requested line
    const nodeStartLine = this._getLineNumberForNode(node);
    const lineOffset = lineNumber - nodeStartLine;

    if (lineOffset < 0 || lineOffset > piece.lineFeedCnt) return "";

    const bufferLineIdx = piece.start.line + lineOffset;
    if (bufferLineIdx < 0 || bufferLineIdx >= buffer.lineCount) return "";

    return buffer.getLineContent(bufferLineIdx);
  }

  /**
   * Get the 1-based line number in the document for a node's start.
   */
  private _getLineNumberForNode(node: TreeNode, knownOffset?: number): number {
    if (knownOffset !== undefined) {
      // Walk from root to find line number
    }
    let line = 1;
    let current: TreeNode | null = node;
    while (current !== null && current !== SENTINEL) {
      if (current.parent !== SENTINEL && current === current.parent.right) {
        line += current.parent.lf_left + current.parent.piece.lineFeedCnt;
      } else if (current.parent !== SENTINEL && current === current.parent.left) {
        // Left children contribute their left siblings' lines
      }
      current = current.parent;
    }
    // Simpler approach: walk from root
    line = this._computeLineNumber(this.root, node);
    return line;
  }

  private _computeLineNumber(root: TreeNode, target: TreeNode): number {
    let line = 1;
    let current = root;
    while (current !== SENTINEL && current !== target) {
      if (this._isLeftOf(current, target)) {
        line += current.lf_left + current.piece.lineFeedCnt;
        current = current.right;
      } else {
        current = current.left;
      }
    }
    if (current === target) {
      line += current.lf_left;
    }
    return line;
  }

  private _isLeftOf(node: TreeNode, target: TreeNode): boolean {
    let current: TreeNode | null = target;
    while (current !== null && current !== SENTINEL && current !== node) {
      if (current === node.right) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * Get the offset for a specific line within a node.
   */
  private _getOffsetForNodeLine(
    node: TreeNode,
    nodeStartLine: number,
    lineRemainder: number,
  ): number {
    const buffer = this._buffers[node.piece.bufferIndex];
    const piece = node.piece;

    const lineInBuffer = piece.start.line + lineRemainder - 1;
    if (lineInBuffer < 0 || lineInBuffer >= buffer.lineCount) return 0;

    const lineStartInBuffer = buffer.lineStarts[lineInBuffer] as number;
    const pieceStartInBuffer = buffer.lineStarts[piece.start.line] as number;
    const colOffset = lineStartInBuffer - pieceStartInBuffer + piece.start.column;

    return this._getPieceStartOffset(node) + colOffset;
  }

  /**
   * Find which line in the buffer contains the given offset within a piece.
   */
  private _findLineInBuffer(buffer: StringBuffer, piece: Piece, offsetInPiece: number): number {
    const pieceStartInBuffer = (buffer.lineStarts[piece.start.line] as number) + piece.start.column;
    const targetBufferOffset = pieceStartInBuffer + offsetInPiece;

    // Binary search for the line
    let low = piece.start.line;
    let high = piece.end.line;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const lineStart = buffer.lineStarts[mid] as number;
      const nextLineStart =
        mid + 1 < buffer.lineCount ? (buffer.lineStarts[mid + 1] as number) : buffer.buffer.length;

      if (targetBufferOffset < lineStart) {
        high = mid - 1;
      } else if (targetBufferOffset >= nextLineStart) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return piece.start.line;
  }

  /**
   * Get the length of a line in the buffer (0-based line index).
   */
  private _getLineLength(buffer: StringBuffer, lineIdx: number): number {
    if (lineIdx < 0 || lineIdx >= buffer.lineCount) return 0;
    const start = buffer.lineStarts[lineIdx] as number;
    const end =
      lineIdx + 1 < buffer.lineCount
        ? (buffer.lineStarts[lineIdx + 1] as number)
        : buffer.buffer.length;
    return end - start;
  }

  /**
   * Get the length of a line in the document (1-based line number).
   */
  private _getLineLengthAtLine(lineNumber: number): number {
    const content = this.getLineContent(lineNumber);
    return content.length;
  }

  /**
   * Count the number of EOLs in a string.
   */
  private _countEOLs(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === CharCode.LineFeed) count++;
    }
    return count;
  }

  /**
   * Extract text from the document given an offset and length.
   */
  private _getTextFromOffset(offset: number, length: number): string {
    if (length === 0) return "";
    const parts: string[] = [];
    let remaining = length;
    let currentOffset = offset;

    while (remaining > 0) {
      const pos = this.nodeAt(currentOffset);
      if (pos.node === SENTINEL) break;

      const buffer = this._buffers[pos.node.piece.bufferIndex];
      const piece = pos.node.piece;
      const pieceStart = this._getPieceStartOffset(pos.node);
      const offsetInPiece = currentOffset - pieceStart;
      const pieceRemaining = piece.length - offsetInPiece;
      const chunkLength = Math.min(remaining, pieceRemaining);

      const text = this._getPieceText(piece, buffer);
      parts.push(text.substring(offsetInPiece, offsetInPiece + chunkLength));

      remaining -= chunkLength;
      currentOffset += chunkLength;
    }

    return parts.join("");
  }

  /**
   * Recompute line starts after appending to the change buffer.
   */
  private _recomputeLineStartsFrom(
    startOffset: number,
    appendedText: string,
    oldBuffer: StringBuffer,
  ): LineStarts {
    // Find the last line that was affected
    const r: number[] = [];
    for (let i = 0; i < oldBuffer.lineStarts.length; i++) {
      r.push(oldBuffer.lineStarts[i] as number);
    }
    // Add new line starts from appended text
    for (let i = 0; i < appendedText.length; i++) {
      if (appendedText.charCodeAt(i) === CharCode.LineFeed) {
        r.push(startOffset + i + 1);
      }
    }
    return createLineStartsFast(appendedText); // simplified
  }

  /**
   * Append text to the change buffer and create a new piece.
   */
  private _appendToChangeBuffer(text: string, eolCount: number): void {
    const oldBuffer = this._buffers[0];
    const newBufferStr = oldBuffer.buffer + text;
    const newLineStarts = createLineStartsFast(newBufferStr);
    const newBuffer = new StringBuffer(newBufferStr, newLineStarts);

    // Calculate start cursor in the new buffer
    const oldLineCount = oldBuffer.lineCount;
    const newLineCount = newBuffer.lineCount;
    const lastLineLen = this._getLineLength(newBuffer, newLineCount - 1);

    const newPiece = new Piece(
      0,
      { line: oldLineCount - 1, column: this._getLineLength(oldBuffer, oldLineCount - 1) },
      { line: newLineCount - 1, column: lastLineLen },
      eolCount,
      text.length,
    );

    this._buffers[0] = newBuffer;
    this._insertNode(newPiece, null);
    this._lineCnt += eolCount;
    this._length += text.length;
  }

  /**
   * Rebuild the entire tree from a single string (used after delete operations).
   */
  private _rebuildTreeFromBuffer(text: string): void {
    this._searchCache = new SearchCache(1);
    this._lastVisitedLine = null;
    const lineStarts = createLineStartsFast(text);
    const buf = new StringBuffer(text, lineStarts);
    this._buffers = [buf];

    // Rebuild tree with a single piece
    this.root = SENTINEL;
    const piece = new Piece(
      0,
      { line: 0, column: 0 },
      { line: lineStarts.length - 1, column: this._getLineLength(buf, lineStarts.length - 1) },
      lineStarts.length - 1,
      text.length,
    );
    this._insertNode(piece, null);
    if (this.root !== SENTINEL) {
      this.root.color = 1; // Black
    }
    this._lineCnt = lineStarts.length;
    this._length = text.length;
  }

  /**
   * Get the document line number for a given character offset.
   */
  private _getLineNumberAtOffset(offset: number): number {
    let line = 1;
    let current = this.root;
    let remaining = offset;

    while (current !== SENTINEL) {
      const leftSize = current.size_left;

      if (remaining < leftSize) {
        current = current.left;
      } else {
        remaining -= leftSize;
        line += current.lf_left;

        if (remaining < current.piece.length) {
          // Count newlines in the piece up to this offset
          const buffer = this._buffers[current.piece.bufferIndex];
          const piece = current.piece;
          const pieceStart = this._getPieceStartOffset(current);
          const offsetInPiece = offset - pieceStart;
          const text = this._getPieceText(piece, buffer);
          let nlCount = 0;
          for (let i = 0; i < offsetInPiece && i < text.length; i++) {
            if (text.charCodeAt(i) === CharCode.LineFeed) nlCount++;
          }
          line += nlCount;
          return line;
        }

        remaining -= current.piece.length;
        line += current.piece.lineFeedCnt;
        current = current.right;
      }
    }

    return line;
  }
}
