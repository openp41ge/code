/**
 * buildInlineDiffFile — merge full post-commit file content with git hunks into
 * ONE inline-diff document for the file editor.
 *
 * The returned `text` is the ENTIRE file at the commit with the removed lines
 * spliced back in at their positions, forming a normal loadable buffer (real
 * line numbers, scroll, find — and crucially full syntax highlighting). `rows`
 * decorates that buffer for the editor:
 *   - "added"   → the real line is a commit addition (green row),
 *   - "removed" → a synthetic row re-injecting a deleted line (red row),
 *   - "context" → unchanged (plain).
 *
 * Each row also carries the OLD and NEW line numbers it pairs with, so the line
 * number column can show the unified `old new` pair plus a `+`/`−` sign on the
 * changed rows (a removed line "15 15 −", its replacement "15 15 +"; pure
 * additions/deletions fall back to a single number on that side).
 *
 * No `@@` section headers are produced — this is the file itself, not a diff.
 */

import type { SearchHunk } from "./git-types.js";

/** One rendered row of an inline-diff buffer. */
export interface InlineDiffRow {
  readonly kind: "context" | "added" | "removed";
  /** Old-file 1-based line number this row pairs with (null when that side is
   * absent — e.g. a pure insertion has no old line). */
  readonly oldLine: number | null;
  /** New-file 1-based line number this row pairs with (null for a pure
   * deletion, which has no new-side line). */
  readonly newLine: number | null;
}

/** A full-file inline diff: the merged document plus per-line decorations. */
export interface InlineDiffFile {
  /** Document to load into the editor (full file + removed lines spliced). */
  readonly text: string;
  /** One entry per line of `text`, in document order. */
  readonly rows: readonly InlineDiffRow[];
}

/** Split file content into lines, dropping the single trailing "\n" artifact. */
function splitLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Full `@@ -O,C +N,C2 @@` header parse (starts 0-safe for new files). */
interface HunkRanges {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

function parseHunkRanges(header: string): HunkRanges {
  const m = /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
  if (!m) return { oldStart: 1, oldCount: 0, newStart: 1, newCount: 0 };
  return {
    oldStart: Math.max(0, Number(m[1])),
    oldCount: Math.max(0, Number(m[2] ?? 1)),
    newStart: Math.max(0, Number(m[3])),
    newCount: Math.max(0, Number(m[4] ?? 1)),
  };
}

interface MergedLine {
  readonly kind: "context" | "added" | "removed";
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export function buildInlineDiffFile(
  fileContent: string | null | undefined,
  hunks: readonly SearchHunk[] | null | undefined,
): InlineDiffFile {
  const fileLines = splitLines(fileContent ?? "");
  const fileLen = fileLines.length;
  const sorted = [...(hunks ?? [])].sort((a, b) => {
    const sa = parseHunkRanges(a.header).newStart;
    const sb = parseHunkRanges(b.header).newStart;
    return sa - sb || (a.header < b.header ? -1 : a.header > b.header ? 1 : 0);
  });

  const merged: MergedLine[] = [];
  // Cursor into the NEW-side file: lines below it are already emitted.
  let newCursor = 1; // 1-based
  // Old-side drift: the number of OLD lines the hunks so far consumed minus the
  // NEW lines they emitted. Adds shift the after-column down relative to the
  // before-column and vice versa, so unchanged context lines TO the right of a
  // change show different before/after numbers (one number per side, mostly
  // both columns full).
  let shift = 0;

  for (const hunk of sorted) {
    const { oldStart, oldCount, newStart, newCount } = parseHunkRanges(hunk.header);
    const hunkLines = hunk.lines ?? [];

    // Full unchanged run BEFORE this hunk's new range — never cropped. Context
    // exists on both sides; BEFORE (old) drifts by the prior net deletions.
    const gapFrom = Math.min(newCursor, fileLen + 1);
    const gapTo = Math.min(newStart, fileLen + 1);
    for (let i = gapFrom; i < gapTo; i++) {
      merged.push({ kind: "context", text: fileLines[i - 1], oldLine: shift + i, newLine: i });
    }
    // Advance past the gap (or clamp if the hunk overlaps/starts earlier).
    newCursor = Math.max(newCursor, Math.min(newStart, fileLen + 1));

    // Walk the hunk's own line order in git's order, tracking the OLD- and
    // NEW-side cursors so every row carries its old|new pair.
    let oldN = oldStart > 0 ? oldStart : 0;
    let newN = newStart;
    for (const line of hunkLines) {
      const t = line.text;
      if (line.type === "-") {
        merged.push({
          kind: "removed",
          text: t,
          oldLine: oldN > 0 ? oldN : null,
          newLine: newN > 0 ? newN : null,
        });
        oldN += 1;
      } else if (line.type === "+") {
        merged.push({
          kind: "added",
          text: fileLines[newCursor - 1] ?? "",
          oldLine: null, // an added line has NO before-number
          newLine: newN,
        });
        if (newCursor <= fileLen) newCursor += 1;
        newN += 1;
      } else {
        merged.push({
          kind: "context",
          text: fileLines[newCursor - 1] ?? t,
          oldLine: oldN > 0 ? oldN : null,
          newLine: newN,
        });
        oldN += 1;
        newN += 1;
        if (newCursor <= fileLen) newCursor += 1;
      }
    }

    // Net old-minus-new line count this hunk consumed — drifts the before
    // numbers of every later context line.
    shift += oldCount - newCount;
  }

  // Remaining full content after the last hunk — never cropped.
  for (let i = newCursor; i <= fileLen; i++) {
    merged.push({
      kind: "context",
      text: fileLines[i - 1],
      oldLine: shift + i > 0 ? shift + i : null,
      newLine: i,
    });
  }

  const text = merged.map((l) => l.text).join("\n");
  const rows: InlineDiffRow[] = merged.map(({ kind, oldLine, newLine }) => ({
    kind,
    oldLine,
    newLine,
  }));
  return { text, rows };
}
