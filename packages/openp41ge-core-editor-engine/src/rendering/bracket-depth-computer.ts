/**
 * BracketDepthComputer — computes bracket pair depths for colorization.
 *
 * Uses a shared stack across all bracket types, matching open/close pairs
 * to assign the same depth to matching brackets. Depth is the stack position
 * (0-indexed) before the pair is added/removed.
 */

import type { IBracketDetector } from "./bracket-detector";
import type { IScopeFilter } from "./scope-filter";

// ── Input lines for bracket depth computation ───────────────────────────

/**
 * A single line of text with its tokens, used as input to bracket depth computation.
 */
export interface BracketLineInput {
  readonly lineNumber: number;
  readonly text: string;
  readonly tokens: IToken[] | null;
}

import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";

// ── Stack entry for matching ────────────────────────────────────────────

interface StackEntry {
  readonly openChar: string;
  readonly line: number;
  readonly startIndex: number;
}

/**
 * Computes bracket pair depths for a set of lines.
 */
export class BracketDepthComputer {
  constructor(
    private _detector: IBracketDetector,
    private _filter: IScopeFilter,
  ) {}

  /**
   * Compute bracket depths for the given lines.
   *
   * @param lines - Array of lines with text and tokens to scan.
   * @returns Map of `"lineNumber:startIndex"` keys to depth values.
   */
  compute(lines: BracketLineInput[]): Map<string, number> {
    const depths = new Map<string, number>();
    const stack: StackEntry[] = [];

    for (const { lineNumber, text, tokens } of lines) {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const pair = this._detector.getBracketPair(ch);

        if (!pair) continue;

        if (tokens && this._filter.shouldSkip(tokens, i)) {
          continue;
        }

        if (ch === pair.open) {
          const depth = stack.length;
          depths.set(`${lineNumber}:${i}`, depth);
          stack.push({ openChar: ch, line: lineNumber, startIndex: i });
        } else {
          const matchIdx = this._findMatchingOpen(stack, pair.open);
          if (matchIdx >= 0) {
            const depth = matchIdx;
            depths.set(`${lineNumber}:${i}`, depth);
            stack.splice(matchIdx, 1);
          }
        }
      }
    }

    return depths;
  }

  /**
   * Find the last occurrence of an opening bracket matching the given char.
   */
  private _findMatchingOpen(stack: StackEntry[], openChar: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].openChar === openChar) {
        return i;
      }
    }
    return -1;
  }
}
