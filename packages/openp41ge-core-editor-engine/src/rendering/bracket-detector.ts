/**
 * IBracketDetector — detects bracket characters and returns their pair definitions.
 *
 * Single responsibility: identify bracket characters and their open/close pairs.
 */

/**
 * Result of checking a character for bracket pair membership.
 */
export interface BracketPairDef {
  readonly open: string;
  readonly close: string;
}

/**
 * Detects whether a character is a bracket and returns its pair definition.
 */
export interface IBracketDetector {
  /**
   * Returns the bracket pair for the given character, or null if the
   * character is not a recognized bracket.
   */
  getBracketPair(ch: string): BracketPairDef | null;
}

const BRACKET_MAP: Record<string, BracketPairDef> = {
  "(": { open: "(", close: ")" },
  ")": { open: "(", close: ")" },
  "[": { open: "[", close: "]" },
  "]": { open: "[", close: "]" },
  "{": { open: "{", close: "}" },
  "}": { open: "{", close: "}" },
};

/**
 * Default bracket detector supporting () [] {}.
 */
export class DefaultBracketDetector implements IBracketDetector {
  getBracketPair(ch: string): BracketPairDef | null {
    return BRACKET_MAP[ch] || null;
  }
}
