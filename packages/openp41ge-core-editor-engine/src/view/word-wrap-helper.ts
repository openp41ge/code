/**
 * WordWrapHelper — computes word wrap splits for a line of text.
 *
 * Each model line may be split into multiple view lines at a given
 * wrap column. Wrap points prefer breaking at word boundaries (spaces)
 * to avoid splitting words.
 */

/**
 * A single wrap segment — a portion of the original line.
 */
export interface WrapSegment {
  /** Start column in the model line (1-based). */
  readonly startColumn: number;
  /** End column in the model line (1-based, exclusive). */
  readonly endColumn: number;
  /** The text content of this segment. */
  readonly text: string;
}

/**
 * Compute wrap segments for a line of text.
 *
 * @param lineContent - The full text of the line.
 * @param wrapColumn - The maximum character column per wrapped line.
 * @returns Array of wrap segments.
 */
export function computeWrapSegments(lineContent: string, wrapColumn: number): WrapSegment[] {
  // Defensive: a column < 1 would make findWrapPoint return `start` and loop
  // forever (`start = end`), wedging the whole editor on the main thread.
  // Callers (ViewportWrapColumnCalculator) guarantee >= 10, but clamp to a
  // minimum of 1 so termination is guaranteed no matter what is passed.
  if (wrapColumn < 1) wrapColumn = 1;

  if (lineContent.length <= wrapColumn) {
    return [
      {
        startColumn: 1,
        endColumn: lineContent.length + 1,
        text: lineContent,
      },
    ];
  }

  const segments: WrapSegment[] = [];
  let start = 0;

  while (start < lineContent.length) {
    const end = findWrapPoint(lineContent, start, wrapColumn);
    segments.push({
      startColumn: start + 1,
      endColumn: end + 1,
      text: lineContent.substring(start, end),
    });
    start = end;
  }

  return segments;
}

/**
 * Find the wrap point for a segment starting at `start` in `text`,
 * with a maximum of `wrapColumn` characters.
 *
 * Prefers breaking at a space within the last few characters.
 * If no space is found, breaks at wrapColumn (hard break).
 */
function findWrapPoint(text: string, start: number, wrapColumn: number): number {
  const end = start + wrapColumn;

  if (end >= text.length) return text.length;

  // Look backward from end for a space character
  for (let i = end; i > start; i--) {
    const ch = text.charCodeAt(i - 1);
    if (ch === 32 /* space */ || ch === 9 /* tab */) {
      return i; // Break at the space (space is excluded from segment)
    }
  }

  // No space found — hard break at wrapColumn
  return end;
}

/**
 * Get the indent level (number of leading spaces/tabs) of a line.
 */
export function getIndentLevel(lineContent: string, tabSize: number = 4): number {
  let indent = 0;
  for (let i = 0; i < lineContent.length; i++) {
    const ch = lineContent.charCodeAt(i);
    if (ch === 32) indent++;
    else if (ch === 9) indent += tabSize;
    else break;
  }
  return indent;
}
