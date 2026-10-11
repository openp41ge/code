/**
 * fe-fold — indentation-based fold-region detection for the file editor.
 *
 * The file editor folds by INDENTATION (like VS Code's "indentation" folding
 * strategy): a line is a fold header when the next non-blank line is more
 * indented, and the region runs from the header down to the last line that is
 * still more indented than the header (a sibling to the header ends it). This
 * works uniformly across brace languages (JS/TS/JSON/CSS), Python, and other
 * indentation-sensitive code — no parser needed.
 *
 * Only the *shape* of the region is computed here (which model lines it
 * covers). Collapse state and the actual line hiding live in the editor.
 */

/** A foldable block: header at `startLine`, last covered line `endLine`. */
export interface FoldRegion {
  startLine: number;
  endLine: number;
}

export interface FoldContentProvider {
  /** Number of model lines in the buffer. */
  lineCount: number;
  /** Leading indentation of a line, in VISIBLE columns (tabs expanded). */
  indentOf(line: number): number;
  /** Whether a line is blank/whitespace-only (ignored for fold computation). */
  isBlank(line: number): boolean;
  /**
   * Whether a line *closes* a block (e.g. a bare `}`, `]` or `)` at the
   * header's indent). When the next line after a block's deepest child has
   * this shape, it is included in the fold region so a collapsed block reads as
   * a single line (the closing bracket is swallowed into the fold) instead of
   * leaving the closing line visible on the next line.
   *
   * Optional for backward compatibility — when absent, regions never absorb a
   * closing line (the historical indentation-only behaviour).
   */
  isClosing?(line: number): boolean;
}

/**
 * Compute the set of indentation-based fold regions for a buffer.
 *
 * A region begins at a "header" line whose next non-blank line is strictly
 * more indented, and ends at the last line whose indent is still strictly
 * greater than the header's (i.e. the header's whole child block), exclusive
 * of any later line at or above the header's indent.
 *
 * Regions are returned as maximal, non-nested-at-the-same-start siblings
 * sorted by `startLine`. A region always covers >= 1 child line (`endLine >
 * startLine`), so trivial "folds" are never produced.
 */
export function computeFoldRegions(provider: FoldContentProvider): FoldRegion[] {
  const regions: FoldRegion[] = [];
  const count = provider.lineCount;
  // Indent per line (0 for blanks) so a header region can be closed by the
  // first later line at or below the header's indent level.
  const indent: number[] = new Array(count + 1).fill(0);
  const blank: boolean[] = new Array(count + 1).fill(false);
  for (let line = 1; line <= count; line++) {
    blank[line] = provider.isBlank(line);
    indent[line] = provider.indentOf(line);
  }

  let line = 1;
  while (line <= count) {
    // Skip blanks.
    if (blank[line]) {
      line++;
      continue;
    }
    // Find the next non-blank line after `line`.
    let next = line + 1;
    while (next <= count && blank[next]) next++;
    if (next > count) break; // no later content

    // A fold header needs a strictly-more-indented child block.
    if (indent[next] > indent[line]) {
      const headerIndent = indent[line];
      // Extend to the last line (inclusive) still strictly deeper than the
      // header, stopping before the first line at or above the header level.
      let end = line + 1;
      while (end <= count && (blank[end] || indent[end] > headerIndent)) end++;
      // `end` now points at the first line NOT in the block (or past EOF).
      let blockEnd = end - 1;
      // Absorb the block's closing line (a bare `}`, `]` or `)` back at the
      // header's indent level) into the region, so a collapsed block folds to a
      // single line instead of leaving the closing bracket on the next line.
      if (end <= count && !blank[end] && provider.isClosing?.(end)) {
        blockEnd = end;
      }
      if (blockEnd > line) {
        regions.push({ startLine: line, endLine: blockEnd });
      }
      // A fold region never spans across a sibling later in the same parent,
      // so resume scanning just after the header.
      line++;
      continue;
    }

    line++;
  }

  return regions;
}
