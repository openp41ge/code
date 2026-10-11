/**
 * IScopeFilter — filters positions that should be skipped (e.g., inside strings/comments).
 *
 * Single responsibility: determine whether a token position should be
 * excluded from bracket colorization based on its scope.
 */

import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";

/**
 * Filters positions that should be skipped (e.g., inside strings/comments).
 */
export interface IScopeFilter {
  /**
   * Returns true if the position at the given index, covered by the
   * provided tokens, should be skipped (not colorized as a bracket).
   */
  shouldSkip(tokens: IToken[], index: number): boolean;
}

/**
 * Find the scope string of the token covering a given character position.
 * Returns the token's scope, or empty string if no token covers the position.
 */
function scopeAtPosition(tokens: IToken[], index: number): string {
  let low = 0;
  let high = tokens.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const token = tokens[mid];

    if (index < token.startIndex) {
      high = mid - 1;
    } else if (index >= token.endIndex) {
      low = mid + 1;
    } else {
      return token.scope || "";
    }
  }

  return "";
}

/**
 * Scope filter that skips positions inside string or comment scopes.
 */
export class StringCommentScopeFilter implements IScopeFilter {
  constructor(
    private _stringPrefixes: string[] = ["string."],
    private _commentPrefixes: string[] = ["comment."],
  ) {}

  shouldSkip(tokens: IToken[], index: number): boolean {
    const scope = scopeAtPosition(tokens, index);
    if (!scope) return false;
    return (
      this._stringPrefixes.some((p) => scope.startsWith(p)) ||
      this._commentPrefixes.some((p) => scope.startsWith(p))
    );
  }
}
