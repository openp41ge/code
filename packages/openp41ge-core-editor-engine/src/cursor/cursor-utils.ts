/**
 * CursorUtils — shared utility functions for cursor operations.
 */

import type { TextSelection, PieceTreeTextContentModel } from "../model";

/**
 * Check if a selection is non-empty.
 */
export function isSelectionNonEmpty(selection: TextSelection): boolean {
  return !(
    selection.selectionStartLineNumber === selection.positionLineNumber &&
    selection.selectionStartColumn === selection.positionColumn
  );
}

/**
 * Get the range from a selection (normalized: anchor then position).
 */
export function selectionRange(selection: TextSelection): {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
} {
  if (
    selection.selectionStartLineNumber < selection.positionLineNumber ||
    (selection.selectionStartLineNumber === selection.positionLineNumber &&
      selection.selectionStartColumn <= selection.positionColumn)
  ) {
    return {
      startLineNumber: selection.selectionStartLineNumber,
      startColumn: selection.selectionStartColumn,
      endLineNumber: selection.positionLineNumber,
      endColumn: selection.positionColumn,
    };
  }
  // Reversed selection
  return {
    startLineNumber: selection.positionLineNumber,
    startColumn: selection.positionColumn,
    endLineNumber: selection.selectionStartLineNumber,
    endColumn: selection.selectionStartColumn,
  };
}

/**
 * Check if a character code is whitespace (space or tab).
 */
export function isWhitespace(ch: number): boolean {
  return ch === 32 /* space */ || ch === 9; /* tab */
}

/**
 * Check if a character code is a word separator.
 */
export function isWordSeparator(ch: number): boolean {
  return (
    ch === 40 /* ( */ ||
    ch === 41 /* ) */ ||
    ch === 46 /* . */ ||
    ch === 44 /* , */ ||
    ch === 59 /* ; */ ||
    ch === 58 /* : */ ||
    ch === 91 /* [ */ ||
    ch === 93 /* ] */ ||
    ch === 123 /* { */ ||
    ch === 125 /* } */ ||
    ch === 34 /* " */ ||
    ch === 39 /* ' */ ||
    ch === 96 /* ` */
  );
}

/**
 * Result of findWordBounds.
 */
export interface WordBounds {
  /** Start column of the word (1-based, inclusive). */
  readonly start: number;
  /** End column of the word (1-based, exclusive — past the last character). */
  readonly end: number;
}

/**
 * Find the word boundaries around a given column in a line.
 *
 * A "word" is a contiguous sequence of characters that are NOT whitespace
 * AND NOT word separators. If the cursor is:
 *
 * - Over a word character → returns bounds of that word
 * - Over a separator character → returns bounds containing just that char
 * - Over whitespace after the last word → returns bounds of the last word
 * - Over whitespace on an otherwise-empty or whitespace-only line → null
 * - Over a blank wrapped segment → walks forward to find the next word
 *
 * @returns WordBounds if a word is found, or null if the cursor is on
 *   an empty/whitespace-only line with no word to select.
 */
export function findWordBounds(
  model: PieceTreeTextContentModel,
  lineNumber: number,
  column: number,
): WordBounds | null {
  const lineContent = model.getLineContent(lineNumber);
  const lineLen = lineContent.length;

  // Empty line — no word to select
  if (lineLen === 0) return null;

  // Whitespace-only line — no word to select
  let allWhitespace = true;
  for (let i = 0; i < lineLen; i++) {
    const ch = lineContent.charCodeAt(i);
    if (!isWhitespace(ch)) {
      allWhitespace = false;
      break;
    }
  }
  if (allWhitespace) return null;

  // Clamp column to valid range (1-based, past-end is allowed)
  const clampedCol = Math.max(1, Math.min(column, lineLen + 1));
  const index = clampedCol - 1; // 0-based index

  // If at or past end of line, walk backward to find the last word
  if (index >= lineLen) {
    return findLastWord(lineContent, lineLen);
  }

  const ch = lineContent.charCodeAt(index);

  // Over a whitespace character
  if (isWhitespace(ch)) {
    // Walk backward from this position to find if there's a word before us
    for (let i = index - 1; i >= 0; i--) {
      const c = lineContent.charCodeAt(i);
      if (!isWhitespace(c) && !isWordSeparator(c)) {
        // Found a word character before the whitespace — select that word
        return findWordBoundsAtPosition(lineContent, i);
      }
    }
    // No word found before whitespace (e.g., leading whitespace on a wrapped
    // segment). Walk forward to find the next word.
    for (let i = index + 1; i < lineLen; i++) {
      const c = lineContent.charCodeAt(i);
      if (!isWhitespace(c) && !isWordSeparator(c)) {
        // Found a word character after the whitespace — select that word
        return findWordBoundsAtPosition(lineContent, i);
      }
    }
    return null;
  }

  // Over a separator character — select just that separator
  if (isWordSeparator(ch)) {
    return { start: clampedCol, end: clampedCol + 1 };
  }

  // Over a word character — expand to word boundaries
  return findWordBoundsAtPosition(lineContent, index);
}

/**
 * Find the last word on a line (for trailing whitespace clicks).
 */
function findLastWord(lineContent: string, lineLen: number): WordBounds | null {
  // Walk backward from the end of line
  for (let i = lineLen - 1; i >= 0; i--) {
    const c = lineContent.charCodeAt(i);
    if (!isWhitespace(c) && !isWordSeparator(c)) {
      return findWordBoundsAtPosition(lineContent, i);
    }
  }
  return null;
}

/**
 * Given a 0-based index that is on a word character, expand to word boundaries.
 */
function findWordBoundsAtPosition(lineContent: string, index: number): WordBounds {
  // Expand left
  let start = index;
  while (start > 0) {
    const ch = lineContent.charCodeAt(start - 1);
    if (isWhitespace(ch) || isWordSeparator(ch)) break;
    start--;
  }

  // Expand right
  let end = index + 1;
  while (end < lineContent.length) {
    const ch = lineContent.charCodeAt(end);
    if (isWhitespace(ch) || isWordSeparator(ch)) break;
    end++;
  }

  return { start: start + 1, end: end + 1 };
}
