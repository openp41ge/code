/**
 * content-search — pure full-text content matching for the Explorer search.
 *
 * This module only matches a query against an in-memory string; it performs no
 * filesystem I/O. The IPC handlers (`file:searchContentsStream`,
 * `file:contentMatchesForFile`) walk roots and read text files, then delegate
 * to `countMatchesInText` / `findMatchesInText`.
 *
 * Keeping the matching logic pure makes it unit-testable without a filesystem.
 */

import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "content-search");

export interface ContentMatchOptions {
  /** Treat the query as a regular expression. */
  regex?: boolean;
  /** Case-sensitive matching (default false, i.e. case-insensitive). */
  caseSensitive?: boolean;
  /**
   * Stop after this many matches in a single file (0/undefined = unlimited).
   *
   * A short query ("d", "dr") matches thousands of times per file; collecting
   * every instance produced megabyte-sized IPC payloads and a match row per
   * instance in the Explorer tree, which froze the renderer. Capping here means
   * the scan also stops early, so a huge file costs the cap, not its length.
   */
  maxMatches?: number;
  /**
   * Longest `lineText` reported per match (0/undefined = the whole line).
   *
   * `lineText` is the full source line, and a minified file is one line that
   * can be a megabyte long — so 50 matches in it used to carry 50 copies of
   * that megabyte across IPC to render 50 rows of ~44 visible characters.
   * Longer lines are cropped to a window around the match and `startIndex` /
   * `endIndex` are rebased onto the cropped text. No ellipsis is added: the
   * renderer crops again to its display width and marks the cut itself.
   */
  maxLineChars?: number;
}

export interface FileContentMatch {
  /** 1-based line number. */
  lineNumber: number;
  /** 1-based column of the first matching character. */
  column: number;
  /** 0-based offset of the match start within the line. */
  startIndex: number;
  /** 0-based offset of the match end (exclusive) within the line. */
  endIndex: number;
  /** The full (untrimmed) line containing the match, without the trailing \r. */
  lineText: string;
}

/** Escape regex metacharacters so a literal query is matched exactly. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count matches of `query` in `text`, stopping at `options.maxMatches`.
 *
 * The streaming Explorer walk only needs a per-file count — it renders badges
 * and folder totals from it and fetches the match lines separately, for the
 * few files whose rows are expanded. Counting skips the line-start table and
 * the per-match slicing that `findMatchesInText` does, so the walk pays for
 * finding files, not for describing every hit in them.
 */
export function countMatchesInText(
  text: string,
  query: string,
  options: ContentMatchOptions = {},
): number {
  if (!query) return 0;
  const flags = options.caseSensitive ? "g" : "gi";
  let re: RegExp;
  try {
    re = new RegExp(options.regex ? query : escapeRegExp(query), flags);
  } catch (err) {
    log.debug("countMatches invalid regex; no matches:", query, err);
    return 0; // invalid regex → no matches
  }
  const limit = options.maxMatches && options.maxMatches > 0 ? options.maxMatches : Infinity;
  let count = 0;
  let m: RegExpExecArray | null;
  while (count < limit && (m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    count++;
  }
  return count;
}

/** Share of a cropped window spent on context *before* the match. */
const CROP_LEAD_RATIO = 0.3;

/**
 * Crop `line` to at most `cap` characters around [start, end), rebasing the
 * match offsets onto the cropped text. `cap` of 0 returns the line unchanged.
 */
function cropAroundMatch(
  line: string,
  start: number,
  end: number,
  cap: number,
): { lineText: string; startIndex: number; endIndex: number } {
  if (cap <= 0 || line.length <= cap) {
    return { lineText: line, startIndex: start, endIndex: end };
  }
  const matchLen = end - start;
  // A match longer than the whole budget is itself clipped; there is no room
  // for context and the renderer only ever shows the leading characters.
  if (matchLen >= cap) {
    return { lineText: line.slice(start, start + cap), startIndex: 0, endIndex: cap };
  }
  const lead = Math.floor((cap - matchLen) * CROP_LEAD_RATIO);
  let winStart = Math.max(0, start - lead);
  let winEnd = Math.min(line.length, winStart + cap);
  if (winEnd - winStart < cap) winStart = Math.max(0, winEnd - cap);
  return {
    lineText: line.slice(winStart, winEnd),
    startIndex: start - winStart,
    endIndex: Math.min(cap, end - winStart),
  };
}

/**
 * Find every match of `query` in `text`.
 *
 * An empty query returns `[]`. An invalid regex (when `regex` is on) also
 * returns `[]` rather than throwing. Zero-length matches are skipped to avoid
 * an infinite loop. At most `options.maxMatches` matches are returned; the scan
 * stops as soon as the cap is reached.
 */
export function findMatchesInText(
  text: string,
  query: string,
  options: ContentMatchOptions = {},
): FileContentMatch[] {
  if (!query) return [];
  const flags = options.caseSensitive ? "g" : "gi";
  let re: RegExp;
  try {
    re = new RegExp(options.regex ? query : escapeRegExp(query), flags);
  } catch (err) {
    log.debug("findMatches invalid regex; no matches:", query, err);
    return []; // invalid regex → no matches
  }

  // Precompute line-start offsets (index just after each '\n').
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  const limit = options.maxMatches && options.maxMatches > 0 ? options.maxMatches : Infinity;
  const lineCap = options.maxLineChars && options.maxLineChars > 0 ? options.maxLineChars : 0;
  const matches: FileContentMatch[] = [];
  let m: RegExpExecArray | null;
  while (matches.length < limit && (m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const idx = m.index;

    // Find the line containing idx via binary search over lineStarts.
    let lo = 0;
    let hi = lineStarts.length - 1;
    let lineIdx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= idx) {
        lineIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const lineStart = lineStarts[lineIdx];
    // Derive the line end from the precomputed line starts instead of
    // scanning with `indexOf("\n", idx)` on every match. On a huge minified
    // file with a single line and a short query matching thousands of times,
    // the per-match `indexOf` scan was O(n²) and could stall the whole search
    // (leaving the Explorer stuck on “Searching…”).
    const nextLineStart = lineStarts[lineIdx + 1];
    const lineEnd = nextLineStart !== undefined ? nextLineStart - 1 : text.length;
    const lineText = text.slice(lineStart, lineEnd).replace(/\r$/, "");

    const cropped = cropAroundMatch(
      lineText,
      idx - lineStart,
      idx - lineStart + m[0].length,
      lineCap,
    );
    matches.push({
      lineNumber: lineIdx + 1,
      column: idx - lineStart + 1,
      startIndex: cropped.startIndex,
      endIndex: cropped.endIndex,
      lineText: cropped.lineText,
    });
  }

  return matches;
}
