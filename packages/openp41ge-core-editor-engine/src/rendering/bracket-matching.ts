/**
 * BracketMatching — finds matching bracket pairs and provides
 * ranges for highlighting.
 *
 * Supports: (), [], {}
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";
import type { TextPosition } from "../model";

/**
 * The direction to search for a matching bracket.
 */

/**
 * A bracket pair definition.
 */
interface BracketDef {
  readonly open: string;
  readonly close: string;
  readonly openCh: number; // charCode
  readonly closeCh: number; // charCode
}

const BRACKETS: BracketDef[] = [
  { open: "(", close: ")", openCh: 40, closeCh: 41 },
  { open: "[", close: "]", openCh: 91, closeCh: 93 },
  { open: "{", close: "}", openCh: 123, closeCh: 125 },
];

/**
 * Result of a bracket match search.
 */
export interface BracketMatch {
  /** The opening bracket position. */
  readonly open: { lineNumber: number; column: number };
  /** The closing bracket position. */
  readonly close: { lineNumber: number; column: number };
}

/**
 * Find the matching bracket for the bracket at the given position.
 * Returns null if no matching bracket is found.
 *
 * @param model - The text model.
 * @param position - Position of the cursor (checks the character at or before this position).
 */
export function findMatchingBracket(
  model: PieceTreeTextContentModel,
  position: TextPosition,
): BracketMatch | null {
  const lineContent = model.getLineContent(position.lineNumber);
  const cursorIndex = position.column - 1; // 0-based

  // Check character at cursor
  if (cursorIndex < lineContent.length) {
    const ch = lineContent.charCodeAt(cursorIndex);
    const bracket = BRACKETS.find((b) => b.openCh === ch || b.closeCh === ch);
    if (bracket) {
      if (ch === bracket.openCh) {
        return findForward(model, position.lineNumber, cursorIndex + 1, bracket);
      } else {
        return findBackward(model, position.lineNumber, cursorIndex + 1, bracket);
      }
    }
  }

  // Check character before cursor (cursor at end of bracket)
  if (cursorIndex > 0) {
    const ch = lineContent.charCodeAt(cursorIndex - 1);
    const bracket = BRACKETS.find((b) => b.openCh === ch || b.closeCh === ch);
    if (bracket) {
      if (ch === bracket.openCh) {
        return findForward(model, position.lineNumber, cursorIndex, bracket);
      } else {
        return findBackward(model, position.lineNumber, cursorIndex, bracket);
      }
    }
  }

  return null;
}

/**
 * Find the matching close bracket going forward from an open bracket.
 */
function findForward(
  model: PieceTreeTextContentModel,
  startLine: number,
  startCol: number,
  bracket: BracketDef,
): BracketMatch | null {
  let depth = 1;
  let line = startLine;
  let col = startCol + 1; // start after the opening bracket

  while (line <= model.lineCount) {
    const content = model.getLineContent(line);
    const len = content.length;

    while (col <= len) {
      const ch = content.charCodeAt(col - 1);

      if (ch === bracket.openCh) {
        depth++;
      } else if (ch === bracket.closeCh) {
        depth--;
        if (depth === 0) {
          return {
            open: { lineNumber: startLine, column: startCol },
            close: { lineNumber: line, column: col },
          };
        }
      }

      col++;
    }

    line++;
    col = 1;
  }

  return null; // No match found
}

/**
 * Find the matching open bracket going backward from a close bracket.
 */
function findBackward(
  model: PieceTreeTextContentModel,
  startLine: number,
  startCol: number,
  bracket: BracketDef,
): BracketMatch | null {
  let depth = 1;
  let line = startLine;
  let col = startCol - 1; // start before the closing bracket

  while (line >= 1) {
    const content = model.getLineContent(line);

    while (col >= 1) {
      const ch = content.charCodeAt(col - 1);

      if (ch === bracket.closeCh) {
        depth++;
      } else if (ch === bracket.openCh) {
        depth--;
        if (depth === 0) {
          return {
            open: { lineNumber: line, column: col },
            close: { lineNumber: startLine, column: startCol },
          };
        }
      }

      col--;
    }

    line--;
    if (line >= 1) {
      col = model.getLineContent(line).length;
    }
  }

  return null; // No match found
}
