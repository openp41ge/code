/**
 * CursorTypeOperations — typing, newline, and tab operations.
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";
import type { TextPosition, TextSelection } from "../model";
import { isSelectionNonEmpty, selectionRange } from "./cursor-utils";

/**
 * Insert a single character at the cursor position (or replace selection).
 * Returns the new cursor position after insertion.
 */
export function insertChar(
  model: PieceTreeTextContentModel,
  char: string,
  cursor: TextPosition,
  selection?: TextSelection | null,
): TextPosition {
  if (char.length === 0) return cursor;

  const range =
    selection && isSelectionNonEmpty(selection)
      ? selectionRange(selection)
      : {
          startLineNumber: cursor.lineNumber,
          startColumn: cursor.column,
          endLineNumber: cursor.lineNumber,
          endColumn: cursor.column,
        };

  model.pushEditOperations([
    {
      range,
      text: char,
    },
  ]);

  // Compute new cursor position
  // Compute new cursor position from the range start
  const insertionLine = range.startLineNumber;
  const insertionCol = range.startColumn;

  if (char === "\n") {
    return { lineNumber: insertionLine + 1, column: 1 };
  }

  const isMultiLine = char.includes("\n");
  if (isMultiLine) {
    const lines = char.split("\n");
    const lastLineLen = lines[lines.length - 1].length;
    return { lineNumber: insertionLine + lines.length - 1, column: lastLineLen + 1 };
  }

  return { lineNumber: insertionLine, column: insertionCol + char.length };
}

/**
 * Insert a newline at the cursor position.
 * Returns the new cursor position.
 */
export function insertNewLine(
  model: PieceTreeTextContentModel,
  cursor: TextPosition,
  selection?: TextSelection | null,
): TextPosition {
  return insertChar(model, "\n", cursor, selection);
}

/**
 * Insert a tab character at the cursor position.
 */
export function insertTab(
  model: PieceTreeTextContentModel,
  cursor: TextPosition,
  tabSize: number = 4,
): TextPosition {
  const spaces = " ".repeat(tabSize);
  return insertChar(model, spaces, cursor);
}
