/**
 * EncodedTokenAttributes — re-implementation of vscode-textmate's internal
 * EncodedTokenAttributes namespace for decoding binary token metadata.
 *
 * Bit layout of the 32-bit encoded token attribute:
 * - Bits  0- 7: languageId (8 bits)
 * - Bits  8-10: tokenType (3 bits) — 0=Other, 1=Comment, 2=String, 4=RegEx
 * - Bits 11-12: containsBalancedBrackets (2 bits)
 * - Bits 13-17: fontStyle (5 bits) — Italic=1, Bold=2, Underline=4
 * - Bits 18-23: foreground (6 bits) — color index into theme color map
 * - Bits 24-29: background (6 bits) — color index into theme color map
 * - Bits 30-31: unused
 *
 * This mirrors vscode-textmate's internal encoding exactly.
 */

export namespace EncodedTokenAttributes {
  const LANGUAGE_ID_MASK = 0b00000000_00000000_00000000_11111111;
  const TOKEN_TYPE_MASK = 0b00000000_00000000_00000111_00000000;
  const BALANCED_BRACKETS_MASK = 0b00000000_00000000_00011000_00000000;
  const FONT_STYLE_MASK = 0b00000000_00000011_11100000_00000000;
  const FOREGROUND_MASK = 0b00000000_11111100_00000000_00000000;
  const BACKGROUND_MASK = 0b11111111_00000000_00000000_00000000;

  const TOKEN_TYPE_OFFSET = 8;
  const BALANCED_BRACKETS_OFFSET = 11;
  const FONT_STYLE_OFFSET = 13;
  const FOREGROUND_OFFSET = 18;
  const BACKGROUND_OFFSET = 24;

  const TOKEN_TYPE_COMMENT = 1;
  const TOKEN_TYPE_STRING = 2;
  const TOKEN_TYPE_REGEX = 3; // Stored as 3, mapped to 4 externally

  export function getLanguageId(encoded: number): number {
    return encoded & LANGUAGE_ID_MASK;
  }

  export function getTokenType(encoded: number): number {
    const val = (encoded & TOKEN_TYPE_MASK) >>> TOKEN_TYPE_OFFSET;
    // Map internal value to StandardTokenType
    switch (val) {
      case TOKEN_TYPE_COMMENT:
        return 1; // Comment
      case TOKEN_TYPE_STRING:
        return 2; // String
      case TOKEN_TYPE_REGEX:
        return 4; // RegEx
      default:
        return 0; // Other
    }
  }

  export function containsBalancedBrackets(encoded: number): boolean {
    return (encoded & BALANCED_BRACKETS_MASK) >>> BALANCED_BRACKETS_OFFSET !== 0;
  }

  export function getFontStyle(encoded: number): number {
    const val = (encoded & FONT_STYLE_MASK) >>> FONT_STYLE_OFFSET;
    // If all bits are set, it's "NotSet" (-1)
    if (val === 0b11111) return -1;
    return val;
  }

  export function getForeground(encoded: number): number {
    return (encoded & FOREGROUND_MASK) >>> FOREGROUND_OFFSET;
  }

  export function getBackground(encoded: number): number {
    return (encoded & BACKGROUND_MASK) >>> BACKGROUND_OFFSET;
  }
}
