/**
 * TextChange — a single atomic change to the document text.
 *
 * Records both the original and modified text at a character offset.
 * Multiple consecutive TextChanges can be compressed for undo stack efficiency.
 */

export class TextChange {
  constructor(
    /** Character offset in the original document. */
    readonly originalOffset: number,
    /** The text that was removed (empty for pure insertions). */
    readonly originalText: string,
    /** Character offset in the modified document. */
    readonly modifiedOffset: number,
    /** The text that was inserted (empty for pure deletions). */
    readonly modifiedText: string,
  ) {}

  get originalLength(): number {
    return this.originalText.length;
  }

  get modifiedLength(): number {
    return this.modifiedText.length;
  }
}

/**
 * Compress consecutive TextChanges into a single change.
 * This merges adjacent edits into one, reducing stack memory usage.
 */
export function compressConsecutiveTextChanges(
  changes1: TextChange[],
  changes2: TextChange[],
): TextChange[] {
  if (changes1.length === 0) return changes2;
  if (changes2.length === 0) return changes1;

  // Try to merge the last change of changes1 with the first of changes2
  const last = changes1[changes1.length - 1];
  const first = changes2[0];

  if (last.modifiedOffset + last.modifiedText.length === first.originalOffset) {
    // Adjacent — merge into one
    const merged = new TextChange(
      last.originalOffset,
      last.originalText + first.originalText,
      last.modifiedOffset,
      last.modifiedText + first.modifiedText,
    );
    return [...changes1.slice(0, -1), merged, ...changes2.slice(1)];
  }

  return [...changes1, ...changes2];
}
