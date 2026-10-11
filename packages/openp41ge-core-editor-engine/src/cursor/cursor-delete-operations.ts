/**
 * CursorDeleteOperations — backspace and delete (forward) operations.
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";
import type { TextPosition, TextSelection } from "../model";
import { isSelectionNonEmpty, selectionRange } from "./cursor-utils";

/**
 * Delete the character to the left of the cursor (Backspace).
 * If there's a selection, delete the selection.
 * Returns the new cursor position.
 */
export function deleteLeft(
  model: PieceTreeTextContentModel,
  cursor: TextPosition,
  selection?: TextSelection | null,
): TextPosition {
  // If there's a selection, delete it
  if (selection && isSelectionNonEmpty(selection)) {
    const range = selectionRange(selection);
    model.pushEditOperations([{ range, text: "" }]);
    return { lineNumber: range.startLineNumber, column: range.startColumn };
  }

  // Nothing before cursor
  if (cursor.lineNumber === 1 && cursor.column === 1) return cursor;

  // At start of line — merge with previous line
  if (cursor.column === 1) {
    const prevLine = model.getLineContent(cursor.lineNumber - 1);

    model.pushEditOperations([
      {
        range: {
          startLineNumber: cursor.lineNumber - 1,
          startColumn: prevLine.length + 1,
          endLineNumber: cursor.lineNumber,
          endColumn: 1,
        },
        text: "",
      },
    ]);

    return { lineNumber: cursor.lineNumber - 1, column: prevLine.length + 1 };
  }

  // Delete character before cursor
  model.pushEditOperations([
    {
      range: {
        startLineNumber: cursor.lineNumber,
        startColumn: cursor.column - 1,
        endLineNumber: cursor.lineNumber,
        endColumn: cursor.column,
      },
      text: "",
    },
  ]);

  return { lineNumber: cursor.lineNumber, column: cursor.column - 1 };
}

/**
 * Delete the character to the right of the cursor (Delete / Forward Delete).
 * If there's a selection, delete the selection.
 * Returns the new cursor position.
 */
export function deleteRight(
  model: PieceTreeTextContentModel,
  cursor: TextPosition,
  selection?: TextSelection | null,
): TextPosition {
  // If there's a selection, delete it
  if (selection && isSelectionNonEmpty(selection)) {
    const range = selectionRange(selection);
    model.pushEditOperations([{ range, text: "" }]);
    return { lineNumber: range.startLineNumber, column: range.startColumn };
  }

  const lineLen = model.getLineContent(cursor.lineNumber).length;

  // At end of line — merge with next line
  if (cursor.column > lineLen) {
    if (cursor.lineNumber >= model.lineCount) return cursor;

    model.pushEditOperations([
      {
        range: {
          startLineNumber: cursor.lineNumber,
          startColumn: lineLen + 1,
          endLineNumber: cursor.lineNumber + 1,
          endColumn: 1,
        },
        text: "",
      },
    ]);

    return cursor;
  }

  // Delete character after cursor
  model.pushEditOperations([
    {
      range: {
        startLineNumber: cursor.lineNumber,
        startColumn: cursor.column,
        endLineNumber: cursor.lineNumber,
        endColumn: cursor.column + 1,
      },
      text: "",
    },
  ]);

  return cursor;
}
