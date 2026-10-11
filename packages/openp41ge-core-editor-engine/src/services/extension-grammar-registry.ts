import type { IGrammar, IGrammarRegistry } from "../interfaces/grammar-registry";

/**
 * Maps file extensions to grammar implementations.
 * Extensions are stored without the leading dot.
 */
export class ExtensionGrammarRegistry implements IGrammarRegistry {
  private _map = new Map<string, IGrammar>();

  register(extensions: string[], grammar: IGrammar): void {
    for (const ext of extensions) {
      this._map.set(ext, grammar);
    }
  }

  get(extension: string): IGrammar | null {
    return this._map.get(extension) ?? null;
  }

  /** Number of registered grammars (unique by extension). */
  get size(): number {
    return this._map.size;
  }
}
