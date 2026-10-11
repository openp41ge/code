/**
 * LineTokens — structured Token[] array decoded from vscode-textmate's
 * ITokenizeLineResult2 binary Uint32Array format.
 *
 * The binary format from tokenizeLine2() is:
 *   [startOffset_0, metadata_0, startOffset_1, metadata_1, ...]
 *
 * Each token's end offset is implied by the next token's start offset
 * (or the line length for the last token).
 */

import { EncodedTokenAttributes } from "./encoded-token-attributes";

/**
 * Token types that map to CSS classes for syntax highlighting.
 * Mirrors vscode-textmate's StandardTokenType.
 */
export const enum StandardTokenType {
  Other = 0,
  Comment = 1,
  String = 2,
  RegEx = 4,
}

/**
 * Font style flags.
 */
export const enum FontStyle {
  NotSet = -1,
  None = 0,
  Italic = 1,
  Bold = 2,
  Underline = 4,
  Strikethrough = 8,
}

/**
 * A single decoded token for a line.
 */
export interface IToken {
  /** Start character offset (0-based, inclusive). */
  readonly startIndex: number;
  /** End character offset (0-based, exclusive). */
  readonly endIndex: number;
  /** The standard token type for CSS class selection. */
  readonly tokenType: StandardTokenType;
  /** Font style flags (italic, bold, underline). */
  readonly fontStyle: FontStyle;
  /** Foreground color index into the theme's color map. */
  readonly foreground: number;
  /** Background color index into the theme's color map. */
  readonly background: number;
  /** Language ID for embedded language support. */
  readonly languageId: number;
  /**
   * The top-level grammar scope (e.g. "keyword", "string", "comment",
   * "constant", "storage", "variable", "entity", "support", "markup").
   * Empty string if not available. Used for CSS class-based syntax highlighting.
   */
  readonly scope: string;
}

/**
 * Parsed result for a single line. Contains decoded tokens and the
 * rule stack to pass to the next line for correct multi-line tokenization.
 */
export interface ITokenizeLineResult {
  readonly tokens: IToken[];
  readonly ruleStack: unknown; // StateStack from vscode-textmate
}

/**
 * Decode a vscode-textmate ITokenizeLineResult2 into a structured IToken[].
 *
 * @param binaryTokens - The Uint32Array from grammar.tokenizeLine2()
 * @param lineLength - The length of the line text (for computing last token's endIndex)
 * @returns Decoded IToken[] array
 */
export function decodeTokens(binaryTokens: Uint32Array, lineLength: number): IToken[] {
  const count = binaryTokens.length >> 1; // 2 entries per token
  const tokens: IToken[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const startIndex = binaryTokens[i << 1];
    const metadata = binaryTokens[(i << 1) + 1];
    const endIndex = i + 1 < count ? binaryTokens[(i + 1) << 1] : lineLength;

    tokens[i] = {
      startIndex,
      endIndex,
      tokenType: EncodedTokenAttributes.getTokenType(metadata) as StandardTokenType,
      fontStyle: EncodedTokenAttributes.getFontStyle(metadata) as FontStyle,
      foreground: EncodedTokenAttributes.getForeground(metadata),
      background: EncodedTokenAttributes.getBackground(metadata),
      languageId: EncodedTokenAttributes.getLanguageId(metadata),
      scope: "",
    };
  }

  return tokens;
}
