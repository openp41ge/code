/**
 * save-cleanup.ts — what a `<file-editor>` save tidies first, when the host
 * turns it on (`setSaveCleanup`): trailing whitespace trimmed from every
 * line, and the file ended with a newline.
 *
 * `saveCleanupEdits` returns the edits for one `pushEditOperations` call
 * (one undoable step), last position first, so each edit's range is still
 * valid when it is applied.
 */

import type { TextEditOperation } from "openp41ge-core-editor-engine/model/piece-tree-text-content-model";

export interface SaveCleanupOptions {
  /** Remove spaces and tabs at the end of every line. */
  readonly trimTrailingWhitespace: boolean;
  /** End a non-empty file with a newline. */
  readonly insertFinalNewline: boolean;
}

/** The lines of a document, as far as the cleanup reads them. */
export interface SaveCleanupLines {
  readonly lineCount: number;
  getLineContent(lineNumber: number): string;
}

const TRAILING = /[ \t]+$/;

/** The edits a save makes first; none when the document is already tidy. */
export function saveCleanupEdits(
  doc: SaveCleanupLines,
  opts: SaveCleanupOptions,
): TextEditOperation[] {
  const edits: TextEditOperation[] = [];
  const last = doc.lineCount;
  const lastLine = doc.getLineContent(last);
  if (opts.insertFinalNewline) {
    // A last line that trimming will empty already ends the file.
    const kept = opts.trimTrailingWhitespace ? lastLine.replace(TRAILING, "") : lastLine;
    if (kept.length > 0) {
      const end = { lineNumber: last, column: lastLine.length + 1 };
      edits.push({
        range: {
          startLineNumber: end.lineNumber,
          startColumn: end.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        text: "\n",
      });
    }
  }
  if (opts.trimTrailingWhitespace) {
    for (let line = last; line >= 1; line--) {
      const text = line === last ? lastLine : doc.getLineContent(line);
      const match = TRAILING.exec(text);
      if (!match) continue;
      edits.push({
        range: {
          startLineNumber: line,
          startColumn: match.index + 1,
          endLineNumber: line,
          endColumn: text.length + 1,
        },
        text: "",
      });
    }
  }
  return edits;
}
