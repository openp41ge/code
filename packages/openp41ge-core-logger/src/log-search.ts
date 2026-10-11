/**
 * log-search.ts — pure text-search helpers for the log viewer's find bar.
 *
 * `findMatchRanges` locates all occurrences of a query in a string with
 * optional regex / match-case / whole-word semantics, returning character
 * offset ranges so the viewer can wrap each match in a `<mark>`. It is
 * framework-free (no DOM / Lit) so it can be unit-tested in isolation and
 * reused by both the viewer and (optionally) a main-process pre-search.
 */

export interface TextRange {
  start: number;
  end: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
}

/** Safety cap so a pathological query can't produce unbounded matches. */
export const MAX_MATCHES_PER_STRING = 1000;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the `[start, end)` character ranges of every match of `query` in
 * `text` (in read order). An empty query, an invalid regular expression, or no
 * matches all yield `[]`. Matches are capped at `MAX_MATCHES_PER_STRING`.
 */
export function findMatchRanges(
  text: string,
  query: string,
  options: SearchOptions = {},
): TextRange[] {
  const q = query.trim();
  if (!q) return [];

  let pattern = options.regex ? q : escapeRegex(q);
  if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;

  const flags = options.caseSensitive ? "g" : "gi";
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    return [];
  }

  const ranges: TextRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    if (ranges.length >= MAX_MATCHES_PER_STRING) break;
    // Guard against zero-length matches producing an infinite loop.
    if (m[0].length === 0) re.lastIndex++;
  }
  return ranges;
}
