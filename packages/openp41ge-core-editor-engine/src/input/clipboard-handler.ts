/**
 * ClipboardHandler — handles cut, copy, and paste operations.
 *
 * Cut/copy use the hidden textarea's native clipboard access.
 * Paste extracts plain text from the clipboard and delegates to
 * the cursor controller for insertion.
 */

import type { CursorController } from "../cursor/cursor-controller";
import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";

/**
 * Configuration for the clipboard handler.
 */
export interface ClipboardHandlerConfig {
  /** The text model to read from / write to. */
  model: PieceTreeTextContentModel;
  /** The cursor controller. */
  cursorController: CursorController;
  /** The hidden textarea element for native clipboard access. */
  textArea: HTMLTextAreaElement;
}

/**
 * Handles clipboard operations.
 */
export class ClipboardHandler {
  private _model: PieceTreeTextContentModel;
  private _cursorController: CursorController;
  private _textArea: HTMLTextAreaElement;
  private _disposed: boolean = false;

  constructor(config: ClipboardHandlerConfig) {
    this._model = config.model;
    this._cursorController = config.cursorController;
    this._textArea = config.textArea;
  }

  /**
   * Handle a copy event.
   * Copies the current selection to the clipboard.
   */
  onCopy(): string {
    const selection = this._cursorController.selection;
    const range = normalizeSelection(selection);

    const text = this._model.getValueInRange({
      startLineNumber: range.startLineNumber,
      startColumn: range.startColumn,
      endLineNumber: range.endLineNumber,
      endColumn: range.endColumn,
    });

    return text;
  }

  /**
   * Handle a cut event.
   * Copies the selection to the clipboard and deletes it.
   */
  onCut(): string {
    const selection = this._cursorController.selection;
    const range = normalizeSelection(selection);

    const text = this._model.getValueInRange({
      startLineNumber: range.startLineNumber,
      startColumn: range.startColumn,
      endLineNumber: range.endLineNumber,
      endColumn: range.endColumn,
    });

    // Delete the selection
    if (range.startLineNumber !== range.endLineNumber || range.startColumn !== range.endColumn) {
      this._model.pushEditOperations([
        {
          range: {
            startLineNumber: range.startLineNumber,
            startColumn: range.startColumn,
            endLineNumber: range.endLineNumber,
            endColumn: range.endColumn,
          },
          text: "",
        },
      ]);

      // Move cursor to the deletion point
      this._cursorController["_cursor"].position = {
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      };
      this._cursorController["_cursor"].selectionAnchor = {
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      };
    }

    return text;
  }

  /**
   * Handle a paste event.
   * Inserts the given text at the cursor position.
   */
  onPaste(text: string): void {
    if (!text) return;

    // Normalize line endings
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Insert at cursor
    this._cursorController.insertChar(normalized);
  }

  /**
   * Dispose the handler.
   */
  dispose(): void {
    this._disposed = true;
  }
}

/**
 * Normalize a TextSelection to a range where start <= end.
 */
function normalizeSelection(selection: {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } {
  if (
    selection.selectionStartLineNumber < selection.positionLineNumber ||
    (selection.selectionStartLineNumber === selection.positionLineNumber &&
      selection.selectionStartColumn <= selection.positionColumn)
  ) {
    return {
      startLineNumber: selection.selectionStartLineNumber,
      startColumn: selection.selectionStartColumn,
      endLineNumber: selection.positionLineNumber,
      endColumn: selection.positionColumn,
    };
  }
  return {
    startLineNumber: selection.positionLineNumber,
    startColumn: selection.positionColumn,
    endLineNumber: selection.selectionStartLineNumber,
    endColumn: selection.selectionStartColumn,
  };
}
