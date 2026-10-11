/**
 * FindInEditor — search UI overlay for finding and replacing text.
 *
 * Provides a simple find bar at the top of the editor with:
 * - Find input field
 * - Match count display
 * - Next/Previous navigation
 * - Case-sensitive toggle
 * - Replace input and button (optional)
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";

/**
 * A single match result.
 */
export interface FindMatch {
  readonly lineNumber: number;
  readonly column: number;
  readonly length: number;
  readonly text: string;
}

/**
 * Search options.
 */
export interface FindOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
}

/**
 * Performs find-in-editor search operations.
 */
export class FindInEditor {
  private _model: PieceTreeTextContentModel;
  private _matches: FindMatch[] = [];
  private _currentIndex: number = -1;
  private _lastQuery: string = "";
  private _lastOptions: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };

  constructor(model: PieceTreeTextContentModel) {
    this._model = model;
  }

  /**
   * Perform a search and return matches.
   *
   * @param query - The search string.
   * @param options - Search options.
   * @returns Array of matches.
   */
  find(query: string, options?: Partial<FindOptions>): FindMatch[] {
    const opts: FindOptions = {
      caseSensitive: options?.caseSensitive ?? this._lastOptions.caseSensitive,
      wholeWord: options?.wholeWord ?? this._lastOptions.wholeWord,
      regex: options?.regex ?? this._lastOptions.regex,
    };

    this._lastQuery = query;
    this._lastOptions = opts;
    this._matches = [];
    this._currentIndex = -1;

    if (!query) return [];

    const flags = opts.caseSensitive ? "g" : "gi";
    let regex: RegExp;
    try {
      regex = opts.regex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    } catch {
      return [];
    }

    for (let line = 1; line <= this._model.lineCount; line++) {
      const content = this._model.getLineContent(line);
      let match: RegExpExecArray | null;

      // Reset regex for each line
      regex.lastIndex = 0;

      while ((match = regex.exec(content)) !== null) {
        const matchText = match[0];
        if (opts.wholeWord && !isWholeWord(content, match.index, matchText.length)) {
          continue;
        }
        this._matches.push({
          lineNumber: line,
          column: match.index + 1, // 1-based
          length: matchText.length,
          text: matchText,
        });
      }
    }

    if (this._matches.length > 0) {
      this._currentIndex = 0;
    }

    return this._matches;
  }

  /**
   * Get the current match count.
   */
  get matchCount(): number {
    return this._matches.length;
  }

  /**
   * Get the current match index (0-based).
   */
  get currentIndex(): number {
    return this._currentIndex;
  }

  /**
   * Get the current match.
   */
  get currentMatch(): FindMatch | null {
    if (this._currentIndex < 0 || this._currentIndex >= this._matches.length) return null;
    return this._matches[this._currentIndex];
  }

  /**
   * Navigate to the next match.
   */
  next(): FindMatch | null {
    if (this._matches.length === 0) return null;
    this._currentIndex = (this._currentIndex + 1) % this._matches.length;
    return this._matches[this._currentIndex];
  }

  /**
   * Navigate to the previous match.
   */
  previous(): FindMatch | null {
    if (this._matches.length === 0) return null;
    this._currentIndex = (this._currentIndex - 1 + this._matches.length) % this._matches.length;
    return this._matches[this._currentIndex];
  }

  /**
   * Get all matches.
   */
  getMatches(): FindMatch[] {
    return this._matches;
  }

  /**
   * Get matches on a specific line.
   */
  getMatchesOnLine(lineNumber: number): FindMatch[] {
    return this._matches.filter((m) => m.lineNumber === lineNumber);
  }

  /**
   * Replace the current match with replacement text.
   */
  replaceCurrent(replacement: string): boolean {
    const match = this.currentMatch;
    if (!match) return false;

    this._model.pushEditOperations([
      {
        range: {
          startLineNumber: match.lineNumber,
          startColumn: match.column,
          endLineNumber: match.lineNumber,
          endColumn: match.column + match.length,
        },
        text: replacement,
      },
    ]);

    // Re-run search to update positions
    this.find(this._lastQuery, this._lastOptions);
    return true;
  }

  /**
   * Replace all matches.
   */
  replaceAll(replacement: string): number {
    let count = 0;

    // Replace from bottom to top to preserve positions
    const sorted = [...this._matches].sort((a, b) => {
      if (a.lineNumber !== b.lineNumber) return b.lineNumber - a.lineNumber;
      return b.column - a.column;
    });

    for (const match of sorted) {
      this._model.pushEditOperations([
        {
          range: {
            startLineNumber: match.lineNumber,
            startColumn: match.column,
            endLineNumber: match.lineNumber,
            endColumn: match.column + match.length,
          },
          text: replacement,
        },
      ]);
      count++;
    }

    // Re-run search
    this.find(this._lastQuery, this._lastOptions);
    return count;
  }

  /**
   * Clear the current search.
   */
  clear(): void {
    this._matches = [];
    this._currentIndex = -1;
    this._lastQuery = "";
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWholeWord(content: string, index: number, length: number): boolean {
  const before = index > 0 ? content[index - 1] : " ";
  const after = index + length < content.length ? content[index + length] : " ";
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    ch === "_"
  );
}
