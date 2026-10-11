/**
 * LazyTokenizationManager — tokenizes only visible lines initially,
 * then tokenizes off-screen lines in the background.
 *
 * Maintains per-line StateStack (from vscode-textmate) so multi-line
 * constructs (block comments, template literals) tokenize correctly.
 */

import type { StateStack } from "vscode-textmate";
import { ContiguousTokensStore } from "./contiguous-tokens-store";
import type { ITokenizer } from "./tokenizer";
import type { IToken } from "./line-tokens";

/**
 * Configuration for the lazy tokenization manager.
 */
export interface TokenizationConfig {
  /** Batch size for background tokenization. */
  readonly batchSize?: number;
  /** Delay (ms) before starting background tokenization. */
  readonly backgroundDelay?: number;
  /** Whether to tokenize all lines immediately (for small files). */
  readonly immediate?: boolean;
  /**
   * How many lines AHEAD of the visible range the background tokenizer may
   * pre-tokenize before idling. 0 disables background tokenization entirely.
   *
   * This bounds the background work to a window around whatever the user can
   * actually see instead of walking the WHOLE file to EOF forever (a legal
   * 50MB / 1M-line file would otherwise burn unbounded main-thread grammar
   * work in idle batches).
   */
  readonly backgroundWindow?: number;
}

const DEFAULT_CONFIG: TokenizationConfig = {
  batchSize: 50,
  backgroundDelay: 50,
  immediate: false,
  backgroundWindow: 500,
};

/**
 * Manages tokenization of a single TextContentModel.
 * Tracks per-line StateStack and provides tokens for visible lines.
 */
export class LazyTokenizationManager {
  private readonly _tokens: ContiguousTokensStore = new ContiguousTokensStore();
  private readonly _stateStacks: Map<number, StateStack | null> = new Map();
  private _tokenizer: ITokenizer | null = null;
  private _config: TokenizationConfig;
  private _lineCount: number = 0;
  private _isDisposed: boolean = false;
  private _bgTimer: ReturnType<typeof setTimeout> | null = null;
  private _nextBgLine: number = 1;
  /** Last visible range reported via tokenizeVisibleRange (1-based). */
  private _visibleStart: number = 1;
  private _visibleEnd: number = 1;
  /** Callback to get line content for tokenization. Set by ViewModel. */
  private _getLineContent: ((lineNumber: number) => string) | null = null;

  constructor(config?: TokenizationConfig) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set a callback to retrieve line content for tokenization.
   */
  setLineContentProvider(provider: (lineNumber: number) => string): void {
    this._getLineContent = provider;
  }

  /**
   * Set the tokenizer (language grammar) to use.
   * Call this when the language is detected.
   */
  setTokenizer(tokenizer: ITokenizer | null): void {
    this._tokenizer = tokenizer;
    if (!tokenizer) {
      this._tokens.clear();
      this._stateStacks.clear();
    }
  }

  /**
   * Get the current tokenizer.
   */
  get tokenizer(): ITokenizer | null {
    return this._tokenizer;
  }

  /**
   * Get the tokens store (for the rendering layer).
   */
  get tokens(): ContiguousTokensStore {
    return this._tokens;
  }

  /**
   * Set the total line count of the document.
   * Triggers tokenization of the first visible range.
   */
  setLineCount(lineCount: number): void {
    this._lineCount = lineCount;
  }

  /**
   * Tokenize a visible range of lines (the viewport).
   * This is synchronous — tokens for these lines are available immediately.
   *
   * @param startLine - 1-based first visible line.
   * @param endLine - 1-based last visible line.
   */
  tokenizeVisibleRange(startLine: number, endLine: number): void {
    if (!this._tokenizer || this._isDisposed) return;

    const maxEnd = Math.min(endLine, this._lineCount);
    let prevState: StateStack | null = this._getStateForLine(startLine);

    for (let line = startLine; line <= maxEnd; line++) {
      if (!this._tokens.hasTokens(line)) {
        const tokens = this._tokenizeLine(line, prevState);
        if (tokens) {
          // After tokenizing, update prevState from the stored state
          prevState = this._stateStacks.get(line) ?? null;
        }
      }
    }

    // Record the visible range so background tokenization stays inside a
    // window right ahead of it (see _getBackgroundCeiling / fast-forward).
    this._visibleStart = Math.max(1, startLine);
    this._visibleEnd = maxEnd;

    // When the viewport jumps FAR ahead of the background sweep (a deep
    // scroll or a larger-than-window forward edit), don't crawl the whole
    // file to reach it. Fast-forward the sweep to just behind the new
    // visible range — tokenizing far ahead of view is pure waste, and the
    // nearest cached state (possibly null) is a reasonable best-effort anchor.
    const window = this._config.backgroundWindow ?? DEFAULT_CONFIG.backgroundWindow ?? 0;
    if (window > 0 && this._nextBgLine < this._visibleStart - window) {
      this._nextBgLine = Math.max(1, this._visibleStart - window);
    }

    // Schedule background tokenization after visible range is done
    this._scheduleBackgroundTokenization();
  }

  /**
   * Peek at cached tokens for a line WITHOUT tokenizing.
   *
   * Returns null when the line has no cached tokens. This is the render-path-
   * safe accessor: the render loop may never block on TextMate, so uncached
   * lines are drawn as plain text and highlighted by the async catch-up pass
   * (see tokenizeVisibleRange called from a requestAnimationFrame).
   */
  tokenizeLineIfCached(lineNumber: number): IToken[] | null {
    if (lineNumber < 1 || lineNumber > this._lineCount) return null;
    return this._tokens.getTokens(lineNumber);
  }

  /**
   * Tokenize a single line immediately and return its tokens.
   * Useful for lines that newly entered the viewport.
   */
  tokenizeLine(lineNumber: number): IToken[] | null {
    if (!this._tokenizer || this._isDisposed) return null;
    if (lineNumber < 1 || lineNumber > this._lineCount) return null;
    if (this._tokens.hasTokens(lineNumber)) {
      return this._tokens.getTokens(lineNumber);
    }

    const prevState = this._getStateForLine(lineNumber);
    return this._tokenizeLine(lineNumber, prevState);
  }

  /**
   * Invalidate tokens after a content change.
   *
   * @param startLine - The line where the change started.
   * @param linesRemoved - Number of lines removed (0 if insertion only).
   * @param linesAdded - Number of lines added (0 if deletion only).
   */
  invalidateRange(startLine: number, linesRemoved: number, linesAdded: number): void {
    // Invalidate state stacks for affected lines
    // Always invalidate at least the startLine (content changed)
    const endRemove = startLine + Math.max(linesRemoved, linesAdded, 1) - 1;
    for (let line = startLine; line <= endRemove; line++) {
      this._stateStacks.delete(line);
    }

    // Shift state stacks
    const shift = linesAdded - linesRemoved;
    if (shift !== 0) {
      const keys = Array.from(this._stateStacks.keys()).sort((a, b) => (shift > 0 ? b - a : a - b));
      for (const key of keys) {
        if (key >= startLine) {
          const value = this._stateStacks.get(key)!;
          this._stateStacks.delete(key);
          this._stateStacks.set(key + shift, value);
        }
      }
      // After shifting, re-invalidate startLine: its content has changed but
      // a state from further down the file may have been shifted INTO startLine.
      this._stateStacks.delete(startLine);
    }

    // Invalidate ALL tokens from startLine to end of file.
    // The startLine content changed, which may have changed the TextMate
    // grammar state for ALL subsequent lines (e.g., entering/exiting a
    // multi-line comment or string). Cached tokens for lines after the edit
    // were computed with the OLD state and must be discarded.
    // `invalidateLines` handles shifting when lines are added/removed.
    // invalidateLines handles shifting when lines are added/removed, but only
    // invalidates the affected range (startLine to endRemove). Tokens for lines
    // after the affected range were computed with the old grammar state and are
    // stale when the edit changes grammar context (e.g., entering/exiting a
    // multi-line comment or string). Delete all of them so they get re-derived.
    this._tokens.invalidateLines(startLine, linesRemoved, linesAdded, this._lineCount);
    for (let line = endRemove + 1; line <= this._lineCount; line++) {
      this._tokens.deleteLine(line);
    }

    // Also invalidate state stacks for ALL lines from startLine onwards.
    // Since the startLine's grammar state changed, every subsequent line
    // must re-derive its state from the new startLine state.
    for (let line = endRemove + 1; line <= this._lineCount; line++) {
      this._stateStacks.delete(line);
    }

    // Reset background tokenization to start from the first invalidated line
    this._nextBgLine = Math.min(this._nextBgLine, startLine);
    this._cancelBackgroundTokenization();
  }

  /**
   * Reset all tokenization (e.g., when file content is replaced entirely).
   */
  reset(): void {
    this._tokens.clear();
    this._stateStacks.clear();
    this._nextBgLine = 1;
    this._visibleStart = 1;
    this._visibleEnd = 1;
    this._cancelBackgroundTokenization();
  }

  /**
   * Dispose the manager.
   */
  dispose(): void {
    this._isDisposed = true;
    this._cancelBackgroundTokenization();
    this._tokens.clear();
    this._stateStacks.clear();
  }

  /**
   * Tokenize a single line and store the result.
   */
  private _tokenizeLine(lineNumber: number, prevState: StateStack | null): IToken[] | null {
    if (!this._tokenizer) return null;

    const lineText = this._getLineContent ? this._getLineContent(lineNumber) : "";
    const result = this._tokenizer.tokenizeLine(lineText, prevState);
    this._tokens.setTokens(lineNumber, result.tokens);
    this._stateStacks.set(lineNumber, result.ruleStack as StateStack);
    return result.tokens;
  }

  /**
   * Get the state stack for a line. Walks back to find the nearest
   * tokenized line and forward-tokenizes if needed.
   */
  private _getStateForLine(line: number): StateStack | null {
    // Walk backward to find the closest line with a cached state stack
    for (let i = line - 1; i >= 1; i--) {
      const state = this._stateStacks.get(i);
      if (state !== undefined) {
        return state;
      }
    }
    return null; // No previous state — start of file
  }

  /**
   * The highest line number the background sweep may pre-tokenize: the
   * visible end plus the configured window (capped at EOF). 0 disables bg.
   */
  private _getBackgroundCeiling(): number {
    const window = this._config.backgroundWindow ?? DEFAULT_CONFIG.backgroundWindow ?? 0;
    if (window <= 0) return 0;
    return Math.min(this._lineCount, this._visibleEnd + window);
  }

  /**
   * Schedule background tokenization of off-screen lines.
   */
  private _scheduleBackgroundTokenization(): void {
    if (this._config.immediate) {
      this._tokenizeAll();
      return;
    }

    if ((this._config.backgroundWindow ?? DEFAULT_CONFIG.backgroundWindow ?? 0) <= 0) return;

    if (this._bgTimer !== null) return; // Already scheduled

    this._bgTimer = setTimeout(() => {
      this._bgTimer = null;
      this._doBackgroundTokenization();
    }, this._config.backgroundDelay);
  }

  /**
   * Tokenize all lines immediately.
   */
  private _tokenizeAll(): void {
    if (!this._tokenizer || this._isDisposed) return;
    let prevState: StateStack | null = null;

    for (let line = 1; line <= this._lineCount; line++) {
      if (this._tokens.hasTokens(line)) {
        prevState = this._stateStacks.get(line) ?? null;
        continue;
      }
      const tokens = this._tokenizeLine(line, prevState);
      if (tokens) {
        prevState = this._stateStacks.get(line) ?? null;
      }
    }
  }

  /**
   * Tokenize the next batch of off-screen lines, bounded by the visible
   * range's window. Stops (no reschedule) once the ceiling is reached until
   * the visible range moves — idling instead of churning to EOF forever.
   */
  private _doBackgroundTokenization(): void {
    if (!this._tokenizer || this._isDisposed) return;

    const batchSize = this._config.batchSize ?? 50;
    const ceiling = this._getBackgroundCeiling();
    if (this._nextBgLine > ceiling) return; // Window satisfied — idle.

    let tokenized = 0;

    for (let line = this._nextBgLine; line <= ceiling && tokenized < batchSize; line++) {
      if (this._tokens.hasTokens(line)) {
        // Skip already tokenized lines, but update our position
        if (line > this._nextBgLine) {
          this._nextBgLine = line;
        }
        continue;
      }

      const prevState = this._getStateForLine(line);
      const result = this._tokenizeLine(line, prevState);
      if (result) {
        tokenized++;
        this._nextBgLine = line + 1;
      }
    }

    // Schedule next batch if the window still has more lines
    if (this._nextBgLine <= ceiling && !this._isDisposed) {
      this._bgTimer = setTimeout(() => {
        this._bgTimer = null;
        this._doBackgroundTokenization();
      }, this._config.backgroundDelay);
    }
  }

  private _cancelBackgroundTokenization(): void {
    if (this._bgTimer !== null) {
      clearTimeout(this._bgTimer);
      this._bgTimer = null;
    }
  }
}
