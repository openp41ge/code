/* eslint-disable no-console */
/**
 * TokenRegistry — maps language IDs (from file extensions) to
 * vscode-textmate IGrammar instances wrapped as ITokenizers.
 *
 * Supports lazy loading: grammars are loaded on first access.
 */

import type { IGrammar, Registry } from "vscode-textmate";
import { TextMateTokenizer, type ITokenizer } from "./tokenizer";

/**
 * Language definition mapping.
 */
export interface LanguageDefinition {
  /** Language ID used internally (e.g. "javascript"). */
  readonly id: string;
  /** TextMate scope name (e.g. "source.js"). */
  readonly scopeName: string;
  /** File extensions without the dot (e.g. ["js", "jsx", "mjs"]). */
  readonly extensions: string[];
  /** Optional parent scope for embedded languages. */
  readonly parentScopeName?: string;
}

/**
 * Built-in language definitions.
 */
export const BUILTIN_LANGUAGES: LanguageDefinition[] = [
  { id: "javascript", scopeName: "source.js", extensions: ["js", "mjs", "cjs"] },
  { id: "javascriptreact", scopeName: "source.js.jsx", extensions: ["jsx"] },
  { id: "typescript", scopeName: "source.ts", extensions: ["ts", "mts", "cts"] },
  { id: "typescriptreact", scopeName: "source.tsx", extensions: ["tsx"] },
  { id: "json", scopeName: "source.json", extensions: ["json", "jsonc"] },
  { id: "html", scopeName: "text.html.basic", extensions: ["html", "htm", "xhtml"] },
  { id: "css", scopeName: "source.css", extensions: ["css", "scss", "less"] },
  { id: "markdown", scopeName: "text.html.markdown", extensions: ["md", "markdown"] },
  { id: "yaml", scopeName: "source.yaml", extensions: ["yaml", "yml", "lock"] },
  { id: "shell", scopeName: "source.shell", extensions: ["sh", "bash", "zsh"] },
  { id: "python", scopeName: "source.python", extensions: ["py", "pyw", "pyx", "pyi"] },
  { id: "rust", scopeName: "source.rust", extensions: ["rs"] },
  { id: "go", scopeName: "source.go", extensions: ["go"] },
  { id: "java", scopeName: "source.java", extensions: ["java"] },
  { id: "c", scopeName: "source.c", extensions: ["c", "h"] },
  {
    id: "cpp",
    scopeName: "source.cpp",
    extensions: ["cpp", "hpp", "cc", "cxx", "hxx", "c++", "h++"],
  },
  { id: "ruby", scopeName: "source.ruby", extensions: ["rb", "erb", "rbi"] },
  { id: "php", scopeName: "source.php", extensions: ["php", "phtml", "php3", "php4", "php5"] },
  { id: "sql", scopeName: "source.sql", extensions: ["sql"] },
  { id: "toml", scopeName: "source.toml", extensions: ["toml"] },
  { id: "dockerfile", scopeName: "source.dockerfile", extensions: ["dockerfile", "Dockerfile"] },
  { id: "hcl", scopeName: "source.hcl", extensions: ["hcl"] },
  { id: "terraform", scopeName: "source.hcl.terraform", extensions: ["tf", "tfvars"] },
];

/**
 * TokenRegistry — manages grammar loading and language ID lookup.
 */
export class TokenRegistry {
  private readonly _registry: Registry;
  private readonly _grammars: Map<string, IGrammar> = new Map();
  private readonly _tokenizers: Map<string, ITokenizer> = new Map();
  private readonly _extToLangId: Map<string, string> = new Map();
  private readonly _langDefs: Map<string, LanguageDefinition> = new Map();
  private _loadPromises: Map<string, Promise<IGrammar | null>> = new Map();

  constructor(registry: Registry) {
    this._registry = registry;

    // Build extension -> language ID and language ID -> definition maps
    for (const def of BUILTIN_LANGUAGES) {
      this._langDefs.set(def.id, def);
      for (const ext of def.extensions) {
        this._extToLangId.set(ext, def.id);
      }
    }
  }

  /**
   * Get the language ID for a file extension.
   * Returns undefined if no language is registered for this extension.
   */
  getLanguageId(extension: string): string | undefined {
    return this._extToLangId.get(extension);
  }

  /**
   * Get the ITokenizer for a language. Lazily loads the grammar on first access.
   * Returns null if the language is unknown or loading fails.
   */
  async getTokenizer(languageId: string): Promise<ITokenizer | null> {
    // Return cached tokenizer
    const existing = this._tokenizers.get(languageId);
    if (existing) return existing;

    // Check if language is known
    const def = this._langDefs.get(languageId);
    if (!def) return null;

    // Try to get the grammar
    const grammar = await this.getGrammar(languageId);
    if (!grammar) return null;

    const tokenizer = new TextMateTokenizer(grammar, languageId, def.scopeName);
    this._tokenizers.set(languageId, tokenizer);
    return tokenizer;
  }

  /**
   * Get the underlying IGrammar for a language.
   */
  async getGrammar(languageId: string): Promise<IGrammar | null> {
    // Return cached grammar
    const existing = this._grammars.get(languageId);
    if (existing) return existing;

    // Check if there's an in-flight load
    const inFlight = this._loadPromises.get(languageId);
    if (inFlight) return inFlight;

    const def = this._langDefs.get(languageId);
    if (!def) return null;

    // Lazy-load the grammar
    const promise = this._doLoadGrammar(def);
    this._loadPromises.set(languageId, promise);

    const grammar = await promise;
    this._loadPromises.delete(languageId);
    return grammar;
  }

  private async _doLoadGrammar(def: LanguageDefinition): Promise<IGrammar | null> {
    try {
      const grammar = await this._registry.loadGrammar(def.scopeName);
      if (grammar) {
        this._grammars.set(def.id, grammar);
      }
      return grammar;
    } catch (err) {
      console.warn(`[TokenRegistry] Failed to load grammar "${def.id}" (${def.scopeName}):`, err);
      return null;
    }
  }

  /**
   * Get the number of loaded grammars.
   */
  get loadedCount(): number {
    return this._grammars.size;
  }

  /**
   * Get all registered language IDs.
   */
  get languages(): string[] {
    return Array.from(this._langDefs.keys());
  }
}
