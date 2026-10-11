/**
 * TokenSegmentAdjuster — adjusts token offsets for wrapped line segments.
 *
 * When word wrap splits a model line into multiple visual segments, the
 * tokens from the grammar tokenization have offsets relative to the full
 * model line. This adjuster maps those offsets to each segment's substring
 * so that syntax highlighting applies correctly on continuation lines.
 *
 * Usage:
 * ```ts
 * const adjuster = new TokenSegmentAdjuster();
 * const adjusted = adjuster.adjust(tokens, seg.startColumn - 1, seg.text.length);
 * viewLine.setContent(seg.text, adjusted, tabSize);
 * ```
 */

import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";

/**
 * Interface for adjusting token offsets to a substring segment.
 * Follows Interface Segregation — focused single-method contract.
 */
export interface ITokenSegmentAdjuster {
  /**
   * Adjust token offsets to be relative to a segment substring.
   *
   * @param tokens - The original tokens with offsets relative to the full line.
   * @param segmentOffset - The character offset of the segment within the full line (0-based).
   * @param segmentLength - The character length of the segment.
   * @returns Adjusted tokens with offsets relative to the segment, or null if no tokens apply.
   */
  adjust(tokens: IToken[] | null, segmentOffset: number, segmentLength: number): IToken[] | null;
}

/**
 * Default implementation of ITokenSegmentAdjuster.
 *
 * If segmentOffset is 0 (the first segment), returns the original tokens
 * unchanged (same reference — safe since IToken is read-only), satisfying
 * Liskov Substitution: no unnecessary copies for the no-adjustment case.
 */
export class TokenSegmentAdjuster implements ITokenSegmentAdjuster {
  adjust(tokens: IToken[] | null, segmentOffset: number, segmentLength: number): IToken[] | null {
    // No tokens or empty tokens — nothing to adjust
    if (!tokens || tokens.length === 0) return null;
    // No adjustment needed for the first segment (offset === 0)
    if (segmentOffset === 0) return tokens;

    const segmentEnd = segmentOffset + segmentLength;
    const result: IToken[] = [];

    for (const token of tokens) {
      const adjustedStart = Math.max(token.startIndex, segmentOffset) - segmentOffset;
      const adjustedEnd = Math.min(token.endIndex, segmentEnd) - segmentOffset;

      // Only include tokens that have a non-empty overlap with this segment
      if (adjustedStart < adjustedEnd && adjustedEnd > 0) {
        result.push({
          startIndex: Math.max(0, adjustedStart),
          endIndex: adjustedEnd,
          tokenType: token.tokenType,
          fontStyle: token.fontStyle,
          foreground: token.foreground,
          background: token.background,
          languageId: token.languageId,
          scope: token.scope,
        });
      }
    }

    return result.length > 0 ? result : null;
  }
}
