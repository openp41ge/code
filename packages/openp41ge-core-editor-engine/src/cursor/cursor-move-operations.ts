/**
 * CursorMoveOperations — arrow key navigation and word jumps.
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";
import type { TextPosition } from "../model";
import type { CoordinatesConverter } from "../model/coordinates-converter";
import { isWhitespace, isWordSeparator } from "./cursor-utils";

/**
 * Move one position to the left.
 * If at the start of a line, moves to the end of the previous line.
 */
export function moveLeft(model: PieceTreeTextContentModel, position: TextPosition): TextPosition {
  if (position.column > 1) {
    return { lineNumber: position.lineNumber, column: position.column - 1 };
  }
  if (position.lineNumber > 1) {
    const prevLine = model.getLineContent(position.lineNumber - 1);
    return { lineNumber: position.lineNumber - 1, column: prevLine.length + 1 };
  }
  return position; // Already at start of file
}

/**
 * Move one position to the right.
 * If at the end of a line, moves to the start of the next line.
 */
export function moveRight(model: PieceTreeTextContentModel, position: TextPosition): TextPosition {
  const lineLen = model.getLineContent(position.lineNumber).length;
  if (position.column <= lineLen) {
    return { lineNumber: position.lineNumber, column: position.column + 1 };
  }
  if (position.lineNumber < model.lineCount) {
    return { lineNumber: position.lineNumber + 1, column: 1 };
  }
  return position; // Already at end of file
}

/**
 * Move up by one visual line. Without word wrap this is one model line.
 * With word wrap, it moves up through wrapped segments within the same model line.
 * Stays at the same visual column if possible.
 */
export function moveUp(
  model: PieceTreeTextContentModel,
  position: TextPosition,
  goalColumn?: number,
  coordinatesConverter?: CoordinatesConverter | null,
): { position: TextPosition; goalColumn: number } {
  const goal = goalColumn ?? position.column;

  if (coordinatesConverter?.isWordWrap) {
    // Convert to view space, move up by 1 view line, convert back
    const viewPos = coordinatesConverter.convertModelToViewPosition(
      position.lineNumber,
      position.column,
    );
    if (viewPos.lineNumber <= 1) {
      return { position: { lineNumber: 1, column: 1 }, goalColumn: goal };
    }
    // Use current view column as the column in view space (preserves visual position)
    const newViewPos: TextPosition = {
      lineNumber: viewPos.lineNumber - 1,
      column: viewPos.column,
    };
    const modelPos = coordinatesConverter.convertViewToModelPosition(
      newViewPos.lineNumber,
      newViewPos.column,
    );
    // If we crossed to a different model line, clamp column to goal column
    if (modelPos.lineNumber !== position.lineNumber) {
      const lineLen = model.getLineContent(modelPos.lineNumber).length;
      return {
        position: { lineNumber: modelPos.lineNumber, column: Math.min(goal, lineLen + 1) },
        goalColumn: goal,
      };
    }
    return { position: modelPos, goalColumn: goal };
  }

  // No word wrap: simple model line up
  if (position.lineNumber <= 1) return { position, goalColumn: goal };

  const prevLine = model.getLineContent(position.lineNumber - 1);
  const targetCol = Math.min(goal, prevLine.length + 1);

  return {
    position: { lineNumber: position.lineNumber - 1, column: targetCol },
    goalColumn: goal,
  };
}

/**
 * Move down by one visual line. Without word wrap this is one model line.
 * With word wrap, it moves down through wrapped segments within the same model line.
 * Stays at the same visual column if possible.
 */
export function moveDown(
  model: PieceTreeTextContentModel,
  position: TextPosition,
  goalColumn?: number,
  coordinatesConverter?: CoordinatesConverter | null,
): { position: TextPosition; goalColumn: number } {
  const goal = goalColumn ?? position.column;

  if (coordinatesConverter?.isWordWrap) {
    // Convert to view space, move down by 1 view line, convert back
    const viewPos = coordinatesConverter.convertModelToViewPosition(
      position.lineNumber,
      position.column,
    );
    const totalViewLines = coordinatesConverter.getTotalViewLineCount();
    if (viewPos.lineNumber >= totalViewLines) {
      // At last view line — clamp to end of model
      const lastModelLine = model.lineCount;
      const lastLineLen = model.getLineContent(lastModelLine).length;
      return {
        position: { lineNumber: lastModelLine, column: lastLineLen + 1 },
        goalColumn: goal,
      };
    }
    // Use current view column as the column in view space (preserves visual position)
    const newViewPos: TextPosition = {
      lineNumber: viewPos.lineNumber + 1,
      column: viewPos.column,
    };
    const modelPos = coordinatesConverter.convertViewToModelPosition(
      newViewPos.lineNumber,
      newViewPos.column,
    );
    // If we crossed to a different model line, clamp column to goal column
    // (same behavior as the non-wrapped code path below).
    if (modelPos.lineNumber !== position.lineNumber) {
      const lineLen = model.getLineContent(modelPos.lineNumber).length;
      return {
        position: { lineNumber: modelPos.lineNumber, column: Math.min(goal, lineLen + 1) },
        goalColumn: goal,
      };
    }
    return { position: modelPos, goalColumn: goal };
  }

  // No word wrap: simple model line down
  if (position.lineNumber >= model.lineCount) return { position, goalColumn: goal };

  const nextLine = model.getLineContent(position.lineNumber + 1);
  const targetCol = Math.min(goal, nextLine.length + 1);

  return {
    position: { lineNumber: position.lineNumber + 1, column: targetCol },
    goalColumn: goal,
  };
}

/**
 * Move to the start of the line.
 */
export function moveToLineStart(
  _model: PieceTreeTextContentModel,
  position: TextPosition,
): TextPosition {
  return { lineNumber: position.lineNumber, column: 1 };
}

/**
 * Move to the end of the line.
 */
export function moveToLineEnd(
  model: PieceTreeTextContentModel,
  position: TextPosition,
): TextPosition {
  const lineLen = model.getLineContent(position.lineNumber).length;
  return { lineNumber: position.lineNumber, column: lineLen + 1 };
}

/**
 * Move one word to the left.
 * Skips whitespace and then skips word characters.
 */
export function moveWordLeft(
  model: PieceTreeTextContentModel,
  position: TextPosition,
): TextPosition {
  const lineContent = model.getLineContent(position.lineNumber);
  let col = position.column - 1; // 0-based

  // Skip whitespace before cursor
  while (col > 0 && isWhitespace(lineContent.charCodeAt(col - 1))) {
    col--;
  }

  // Skip word characters
  while (
    col > 0 &&
    !isWhitespace(lineContent.charCodeAt(col - 1)) &&
    !isWordSeparator(lineContent.charCodeAt(col - 1))
  ) {
    col--;
  }

  // If we went past a word separator, stop at it
  if (col > 0 && isWordSeparator(lineContent.charCodeAt(col - 1))) {
    return { lineNumber: position.lineNumber, column: col };
  }

  // If we hit the start of the line, move to previous line
  if (col === 0 && position.lineNumber > 1) {
    const prevLine = model.getLineContent(position.lineNumber - 1);
    return { lineNumber: position.lineNumber - 1, column: prevLine.length + 1 };
  }

  return { lineNumber: position.lineNumber, column: col + 1 };
}

/**
 * Move one word to the right.
 * Skips whitespace, then skips either word characters or word separators
 * (whichever group the cursor is on). Word separators are treated as a
 * navigable group, consistent with macOS/VS Code behavior.
 */
export function moveWordRight(
  model: PieceTreeTextContentModel,
  position: TextPosition,
): TextPosition {
  const lineContent = model.getLineContent(position.lineNumber);
  let col = position.column - 1; // 0-based
  const lineLen = lineContent.length;

  // Skip whitespace after cursor
  while (col < lineLen && isWhitespace(lineContent.charCodeAt(col))) {
    col++;
  }

  // Skip word characters or word separators (whichever group we're in)
  if (col < lineLen) {
    const ch = lineContent.charCodeAt(col);
    if (isWordSeparator(ch)) {
      // Skip consecutive separators as a group
      while (col < lineLen && isWordSeparator(lineContent.charCodeAt(col))) {
        col++;
      }
    } else {
      // Skip consecutive word characters (non-ws, non-sep)
      while (
        col < lineLen &&
        !isWhitespace(lineContent.charCodeAt(col)) &&
        !isWordSeparator(lineContent.charCodeAt(col))
      ) {
        col++;
      }
    }
  }

  // If we hit end of line, move to next line
  if (col >= lineLen && position.lineNumber < model.lineCount) {
    return { lineNumber: position.lineNumber + 1, column: 1 };
  }

  return { lineNumber: position.lineNumber, column: col + 1 };
}

/**
 * Move up by one page (roughly viewport-sized jump).
 */
export function movePageUp(
  model: PieceTreeTextContentModel,
  position: TextPosition,
  visibleLineCount: number,
): TextPosition {
  const targetLine = Math.max(1, position.lineNumber - visibleLineCount);
  const line = model.getLineContent(targetLine);
  return { lineNumber: targetLine, column: Math.min(position.column, line.length + 1) };
}

/**
 * Move down by one page.
 */
export function movePageDown(
  model: PieceTreeTextContentModel,
  position: TextPosition,
  visibleLineCount: number,
): TextPosition {
  const targetLine = Math.min(model.lineCount, position.lineNumber + visibleLineCount);
  const line = model.getLineContent(targetLine);
  return { lineNumber: targetLine, column: Math.min(position.column, line.length + 1) };
}

// ── Helpers ──
// isWhitespace and isWordSeparator imported from cursor-utils.ts
