/**
 * ITokenizer — wraps vscode-textmate's IGrammar.tokenizeLine2() and
 * converts the result to structured IToken[] arrays.
 *
 * The tokenizer is stateless per-line but requires a prevState stack
 * for correct multi-line tokenization (block comments, template literals).
 */

import type { IGrammar, StateStack } from "vscode-textmate";
import type { ITokenizeLineResult, IToken } from "./line-tokens";

export type { StateStack };

/**
 * Pick the best scope for CSS class matching from a scope stack array.
 * Grammars can assign multiple scopes (e.g. "string.quoted.double.json"
 * AND "meta.structure.dictionary.key.json"). The innermost scope is the
 * most specific. Skip structural scopes that have no visual meaning:
 *   - source.*, text.*              — root language scopes
 *   - meta.embedded.*               — string content wrapper
 *   - punctuation.definition.string.* — string delimiters (quotes, backticks)
 *     inherit color from parent scope (key blue vs value pink)
 * Keep other meta.* and punctuation.* scopes — some (like
 * meta.structure.dictionary.key.json) have specific entries in SCOPE_CLASSES
 * for distinct coloring (keys vs values).
 */
export function pickBestScope(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s) {
      const first = s.split(".")[0];
      if (
        first !== "source" &&
        first !== "text" &&
        s !== "meta.embedded" &&
        !s.startsWith("meta.embedded") &&
        !s.startsWith("punctuation.definition.string")
      ) {
        return s;
      }
    }
  }
  return scopes[scopes.length - 1] ?? "";
}

/**
 * Tokenizer interface — abstracts the underlying TextMate grammar engine.
 */
export interface ITokenizer {
  /** The language ID this tokenizer handles (e.g. "javascript"). */
  readonly languageId: string;

  /** The TextMate scope name (e.g. "source.js"). */
  readonly scopeName: string;

  /**
   * Tokenize a single line of text.
   *
   * @param lineText - The line content (without line ending).
   * @param prevState - The rule stack from the previous line, or null for the first line.
   * @returns Tokenization result with decoded tokens and next state stack.
   */
  tokenizeLine(lineText: string, prevState: StateStack | null): ITokenizeLineResult;
}

/**
 * Wraps a vscode-textmate IGrammar as an ITokenizer.
 */
export class TextMateTokenizer implements ITokenizer {
  readonly languageId: string;
  readonly scopeName: string;
  private readonly _grammar: IGrammar;

  constructor(grammar: IGrammar, languageId: string, scopeName: string) {
    this._grammar = grammar;
    this.languageId = languageId;
    this.scopeName = scopeName;
  }

  tokenizeLine(lineText: string, prevState: StateStack | null): ITokenizeLineResult {
    const result = this._grammar.tokenizeLine(lineText, prevState);
    const tokens: IToken[] = [];
    for (const t of result.tokens) {
      const scope = pickBestScope(t.scopes);
      tokens.push({
        startIndex: t.startIndex,
        endIndex: t.endIndex,
        tokenType: scopeToTokenType(t.scopes),
        fontStyle: 0,
        foreground: 0,
        background: 0,
        languageId: 0,
        scope,
      });
    }
    return {
      tokens,
      ruleStack: result.ruleStack,
    };
  }
}

/**
 * Determine standard token type from scope array.
 * Uses the innermost (most specific) scope.
 */
function scopeToTokenType(scopes: string[]): number {
  const target = pickBestScope(scopes);
  const first = target.split(".")[0];
  switch (first) {
    case "comment":
      return 1; // Comment
    case "string":
      return 2; // String
    default:
      return 0; // Other
  }
}
