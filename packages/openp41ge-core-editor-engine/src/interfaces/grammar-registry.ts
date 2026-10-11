/**
 * A single grammar definition — tokenizes one line of text into
 * syntax-highlighted HTML.
 */
export interface IGrammar {
  readonly name: string;
  tokenizeLine(line: string): string;
}

/**
 * Maps file extensions to grammar definitions.
 * Extensions are stored without the leading dot.
 */
export interface IGrammarRegistry {
  register(extensions: string[], grammar: IGrammar): void;
  get(extension: string): IGrammar | null;
}
