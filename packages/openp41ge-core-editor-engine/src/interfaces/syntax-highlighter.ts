import type { IGrammar } from "./grammar-registry";

/** Transforms plain text into syntax-highlighted HTML. */
export interface ISyntaxHighlighter {
  /**
   * Highlight the given content using the provided grammar.
   * If grammar is null, returns escapeHtml(content).
   */
  highlight(content: string, grammar: IGrammar | null): string;
}
