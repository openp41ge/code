/**
 * AutoClosingPairs — automatically inserts closing brackets, quotes,
 * and other paired characters.
 *
 * When the user types an opening character (e.g., '('), the closing
 * character (')') is also inserted, and the cursor is placed between them.
 * When the user types a closing character that matches the next character,
 * it is skipped over (overtype).
 *
 * This prevents deep-nesting issues and provides a VS Code-like editing
 * experience.
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";
import type { TextPosition } from "../model";

/**
 * A pair of opening/closing characters.
 */
export interface AutoClosingPair {
  /** The character that triggers auto-close. */
  readonly open: string;
  /** The character to insert as the closer. */
  readonly close: string;
  /** Whether to auto-close when a selection is surrounded. */
  readonly surroundSelection?: boolean;
}

/**
 * Default auto-closing pairs.
 */
const DEFAULT_PAIRS: AutoClosingPair[] = [
  { open: "(", close: ")", surroundSelection: true },
  { open: "[", close: "]", surroundSelection: true },
  { open: "{", close: "}", surroundSelection: true },
  { open: '"', close: '"', surroundSelection: true },
  { open: "'", close: "'", surroundSelection: true },
  { open: "`", close: "`", surroundSelection: true },
];

/**
 * Double-quote and single-quote are context-sensitive — they should
 * only auto-close in non-string contexts. For the initial implementation,
 * we keep all pairs active.
 */

/**
 * Result of checking an auto-closing pair.
 */
export interface AutoCloseResult {
  /** Whether to insert text. */
  readonly shouldInsert: boolean;
  /** The text to insert. */
  readonly text: string;
  /** The new cursor column offset from the start of insertion. */
  readonly cursorOffset: number;
}

/**
 * Check if auto-closing should be applied when the given character is typed.
 *
 * @param char - The character that was typed.
 * @param model - The text model.
 * @param position - The current cursor position.
 * @param pairs - Optional custom pairs (defaults to DEFAULT_PAIRS).
 * @returns The auto-close result, or null if no auto-close applies.
 */
export function checkAutoClose(
  char: string,
  model: PieceTreeTextContentModel,
  position: TextPosition,
  pairs: AutoClosingPair[] = DEFAULT_PAIRS,
): AutoCloseResult | null {
  // Check if this is an opening character
  const pair = pairs.find((p) => p.open === char);
  if (!pair) return null;

  const lineContent = model.getLineContent(position.lineNumber);
  const cursorIndex = position.column - 1; // 0-based

  // Don't auto-close if the next character is an alphanumeric (avoid
  // interfering with existing text)
  if (cursorIndex < lineContent.length) {
    const nextChar = lineContent[cursorIndex];
    if (isAlphanumeric(nextChar)) {
      return null;
    }
  }

  return {
    shouldInsert: true,
    text: pair.open + pair.close,
    cursorOffset: 1, // Cursor goes between open and close
  };
}

/**
 * Check if a closing character should be "skipped" (overtyped) rather
 * than inserted. This happens when the typed character matches the
 * character immediately to the right of the cursor.
 *
 * @param char - The closing character that was typed.
 * @param model - The text model.
 * @param position - The current cursor position.
 * @param pairs - Optional custom pairs.
 * @returns True if the character should be skipped (overtyped).
 */
export function shouldSkipClose(
  char: string,
  model: PieceTreeTextContentModel,
  position: TextPosition,
  pairs: AutoClosingPair[] = DEFAULT_PAIRS,
): boolean {
  const pair = pairs.find((p) => p.close === char);
  if (!pair) return false;

  const lineContent = model.getLineContent(position.lineNumber);
  const cursorIndex = position.column - 1;

  if (cursorIndex < lineContent.length && lineContent[cursorIndex] === char) {
    return true;
  }

  return false;
}

function isAlphanumeric(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    ch === "_" ||
    ch === "$"
  );
}
