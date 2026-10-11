/**
 * ViewModel — wraps PieceTreeTextContentModel for the view layer.
 *
 * Listens to model events, transforms them via CoordinatesConverter,
 * and emits view-level events that the rendering layer consumes.
 *
 * Responsibilities:
 *   - Translate model content changes into view line changes
 *   - Provide CoordinatesConverter for model↔view position transforms
 *   - Manage tokenization of visible lines via LazyTokenizationManager
 *   - Track which lines need re-rendering after edit operations
 */

import type { PieceTreeTextContentModel } from "./piece-tree-text-content-model";
import type { TextContentChangeEvent } from "./piece-tree-text-content-model";
import { CoordinatesConverter } from "./coordinates-converter";
import { Emitter } from "./event-emitter";
import { LazyTokenizationManager } from "openp41ge-core-syntax-highlighting/lazy-tokenization-manager";
import type { ITokenizer } from "openp41ge-core-syntax-highlighting/tokenizer";
import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";

/**
 * Events emitted by the ViewModel.
 */
export interface ViewModelEvent {
  /**
   * Lines that changed and need re-rendering (1-based).
   */
  readonly changedLines: readonly number[];
  /**
   * The version ID after the change (for synchronisation).
   */
  readonly versionId: number;
  /**
   * Whether the content changed (vs just decorations).
   */
  readonly contentChanged: boolean;
}

/**
 * Options for creating a ViewModel.
 */
export interface ViewModelOptions {
  /** Line height in pixels. */
  lineHeight?: number;
  /** Tab size (spaces per tab). */
  tabSize?: number;
}

/**
 * ViewModel — bridges the text model with the view.
 */
export class ViewModel {
  private _model: PieceTreeTextContentModel;
  private _coordinatesConverter: CoordinatesConverter;
  private _tokenizer: LazyTokenizationManager;
  private _onDidChange = new Emitter<ViewModelEvent>();
  private _options: ViewModelOptions;

  constructor(model: PieceTreeTextContentModel, options?: ViewModelOptions) {
    this._model = model;
    this._options = options ?? {};
    this._coordinatesConverter = new CoordinatesConverter(model);
    this._tokenizer = new LazyTokenizationManager({
      batchSize: 50,
      backgroundDelay: 50,
      immediate: false,
    });
    this._tokenizer.setLineContentProvider((lineNumber) => model.getLineContent(lineNumber));
    this._tokenizer.setLineCount(model.lineCount);

    // Listen for model content changes
    model.onDidChangeContent((event) => {
      this._handleModelChange(event);
    });
  }

  /**
   * The underlying text model.
   */
  get model(): PieceTreeTextContentModel {
    return this._model;
  }

  /**
   * The coordinates converter (model ↔ view space).
   */
  get coordinatesConverter(): CoordinatesConverter {
    return this._coordinatesConverter;
  }

  /** Whether a language grammar (tokenizer) is ready for this model. */
  get hasTokenizer(): boolean {
    return this._tokenizer.tokenizer != null;
  }

  /**
   * The tokenization manager.
   */
  get tokenizer(): LazyTokenizationManager {
    return this._tokenizer;
  }

  /**
   * The options.
   */
  get options(): ViewModelOptions {
    return this._options;
  }

  /**
   * Line height in pixels.
   */
  get lineHeight(): number {
    return this._options.lineHeight ?? 20;
  }

  /**
   * Tab size.
   */
  get tabSize(): number {
    return this._options.tabSize ?? 4;
  }

  /**
   * Event: emitted when the view needs to re-render.
   */
  get onDidChange(): Emitter<ViewModelEvent> {
    return this._onDidChange;
  }

  /**
   * Get the content of a model line.
   */
  getLineContent(lineNumber: number): string {
    return this._model.getLineContent(lineNumber);
  }

  /**
   * Get the tokens for a line. Returns null if the line is not yet tokenized.
   * Tokenizes the line synchronously if needed.
   */
  getLineTokens(lineNumber: number): IToken[] | null {
    return this._tokenizer.tokenizeLine(lineNumber);
  }

  /**
   * Get the tokens for a line WITHOUT tokenizing. Returns null when the line
   * is not yet tokenized. The render loop uses this so painting never blocks
   * on TextMate; uncached lines render plain and are highlighted afterwards by
   * the async catch-up pass.
   */
  getLineTokensIfCached(lineNumber: number): IToken[] | null {
    return this._tokenizer.tokenizeLineIfCached(lineNumber);
  }

  /**
   * Tokenize a range of visible lines synchronously.
   */
  tokenizeVisibleRange(startLine: number, endLine: number): void {
    this._tokenizer.tokenizeVisibleRange(startLine, endLine);
  }

  /**
   * Set the tokenizer (language grammar) for the model.
   */
  setTokenizer(tokenizer: ITokenizer | null): void {
    this._tokenizer.setTokenizer(tokenizer);
    // Re-tokenize when language changes
    if (tokenizer) {
      this._tokenizer.tokenizeVisibleRange(1, Math.min(100, this._model.lineCount));
    }
  }

  /**
   * Enable or disable word wrap.
   */
  setWordWrap(enabled: boolean, wrapColumn?: number): void {
    this._coordinatesConverter.setWordWrap(enabled);
    if (wrapColumn !== undefined) {
      this._coordinatesConverter.setWrapColumn(wrapColumn);
    }
    // Recompute view line count and notify
    this._onDidChange.fire({
      changedLines: [],
      versionId: this._model.versionId,
      contentChanged: false,
    });
  }

  /**
   * Get the total number of lines in the model.
   */
  get lineCount(): number {
    return this._model.lineCount;
  }

  /**
   * Get the view line count (same as model line count without word wrap).
   */
  get viewLineCount(): number {
    return this._coordinatesConverter.getTotalViewLineCount();
  }

  /**
   * Handle a model content change event.
   */
  private _handleModelChange(event: TextContentChangeEvent): void {
    // Invalidate the coordinates converter's wrap cache: per-line wrap segment
    // counts from the previous content would otherwise make view<->model
    // conversion and getTotalViewLineCount stale (e.g. after a wrapped
    // document is replaced with a different one, click-to-caret and the total
    // view-line count stay short by the old lines' segment-count delta).
    this._coordinatesConverter.markDirty();

    // Collect affected lines
    const changedLines = new Set<number>();

    for (const change of event.changes) {
      // The range that was replaced
      for (let line = change.range.startLineNumber; line <= change.range.endLineNumber; line++) {
        changedLines.add(line);
      }

      // The new text may add lines
      const addedLines = (change.text.match(/\n/g) || []).length;
      if (addedLines > 0) {
        const lastAffectedLine = change.range.startLineNumber + addedLines;
        for (let line = change.range.startLineNumber; line <= lastAffectedLine; line++) {
          changedLines.add(line);
        }
      }
    }

    // Update tokenizer state
    for (const change of event.changes) {
      const linesRemoved = change.range.endLineNumber - change.range.startLineNumber;
      const linesAdded = (change.text.match(/\n/g) || []).length;
      this._tokenizer.invalidateRange(change.range.startLineNumber, linesRemoved, linesAdded);
    }
    this._tokenizer.setLineCount(this._model.lineCount);

    // Emit view event
    this._onDidChange.fire({
      changedLines: Array.from(changedLines),
      versionId: event.versionId,
      contentChanged: true,
    });
  }

  /**
   * Dispose the view model.
   */
  dispose(): void {
    this._tokenizer.dispose();
    this._onDidChange.dispose();
  }
}
