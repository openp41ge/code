/**
 * BracketPairService — thin facade for bracket pair depth computation.
 *
 * Wires together IBracketDetector, IScopeFilter, and BracketDepthComputer
 * with sensible defaults. All dependencies are injectable for testing.
 */

import type { IBracketDetector } from "./bracket-detector";
import { DefaultBracketDetector } from "./bracket-detector";
import type { IScopeFilter } from "./scope-filter";
import { StringCommentScopeFilter } from "./scope-filter";
import { BracketDepthComputer, type BracketLineInput } from "./bracket-depth-computer";

export type { BracketLineInput } from "./bracket-depth-computer";
export type { IBracketDetector, BracketPairDef } from "./bracket-detector";
export type { IScopeFilter } from "./scope-filter";

/**
 * Service that computes bracket pair depth for visible-range lines.
 *
 * Thin facade over BracketDepthComputer with sensible defaults.
 */
export class BracketPairService {
  private _depthComputer: BracketDepthComputer;

  constructor(detector?: IBracketDetector, filter?: IScopeFilter) {
    this._depthComputer = new BracketDepthComputer(
      detector ?? new DefaultBracketDetector(),
      filter ?? new StringCommentScopeFilter(),
    );
  }

  /**
   * Compute bracket depths for the given lines.
   *
   * @param lines - Array of lines with text and tokens.
   * @returns Map of `"lineNumber:startIndex"` keys to depth values.
   */
  compute(lines: BracketLineInput[]): Map<string, number> {
    if (lines.length === 0) return new Map();
    return this._depthComputer.compute(lines);
  }
}
