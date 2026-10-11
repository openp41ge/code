/**
 * DragDropHandler — handles drag-and-drop of text within the editor
 * and from external sources.
 */

import type { CursorController } from "../cursor/cursor-controller";
import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";

/**
 * Handles drag-and-drop events on the editor viewport.
 */
export class DragDropHandler {
  private _viewportEl: HTMLElement;
  private _model: PieceTreeTextContentModel;
  private _cursorController: CursorController;
  private _isDragging: boolean = false;
  private _dragStartLine: number = 0;
  private _dragStartCol: number = 0;
  private _disposed: boolean = false;

  constructor(
    viewportEl: HTMLElement,
    model: PieceTreeTextContentModel,
    cursorController: CursorController,
  ) {
    this._viewportEl = viewportEl;
    this._model = model;
    this._cursorController = cursorController;

    this._viewportEl.addEventListener("dragstart", this._onDragStart);
    this._viewportEl.addEventListener("dragover", this._onDragOver);
    this._viewportEl.addEventListener("drop", this._onDrop);
    this._viewportEl.addEventListener("dragend", this._onDragEnd);
  }

  /**
   * Enable/disable drag-and-drop.
   */
  setEnabled(enabled: boolean): void {
    this._viewportEl.draggable = enabled;
  }

  /**
   * Dispose the handler.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._viewportEl.removeEventListener("dragstart", this._onDragStart);
    this._viewportEl.removeEventListener("dragover", this._onDragOver);
    this._viewportEl.removeEventListener("drop", this._onDrop);
    this._viewportEl.removeEventListener("dragend", this._onDragEnd);
  }

  private _onDragStart = (e: DragEvent): void => {
    if (this._disposed) return;

    const selection = this._cursorController.selection;
    if (
      selection.selectionStartLineNumber === selection.positionLineNumber &&
      selection.selectionStartColumn === selection.positionColumn
    ) {
      e.preventDefault();
      return;
    }

    this._isDragging = true;
    this._dragStartLine = selection.selectionStartLineNumber;
    this._dragStartCol = selection.selectionStartColumn;

    // Get the selected text
    const range = normalizeSelection(selection);
    const text = this._model.getValueInRange({
      startLineNumber: range.startLineNumber,
      startColumn: range.startColumn,
      endLineNumber: range.endLineNumber,
      endColumn: range.endColumn,
    });

    e.dataTransfer?.setData("text/plain", text);
    e.dataTransfer!.effectAllowed = "move";
  };

  private _onDragOver = (e: DragEvent): void => {
    if (this._disposed || !this._isDragging) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";

    // Compute drop position from mouse coordinates
    const rect = this._viewportEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const lineHeight = 20;
    const charWidth = 8;
    const lineNumber = Math.floor(y / lineHeight) + 1;
    const column = Math.floor(x / charWidth) + 1;

    // Move cursor to show drop location
    this._cursorController["_cursor"].position = { lineNumber, column };
    this._cursorController["_cursor"].selectionAnchor = { lineNumber, column };
  };

  private _onDrop = (e: DragEvent): void => {
    if (this._disposed || !this._isDragging) return;
    e.preventDefault();

    const text = e.dataTransfer?.getData("text/plain");
    if (!text) return;

    // Compute drop position
    const rect = this._viewportEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const lineHeight = 20;
    const charWidth = 8;
    const dropLine = Math.floor(y / lineHeight) + 1;
    const dropCol = Math.floor(x / charWidth) + 1;

    // Delete the original selection (if it exists)
    if (this._dragStartLine > 0) {
      this._model.pushEditOperations([
        {
          range: {
            startLineNumber: this._dragStartLine,
            startColumn: this._dragStartCol,
            endLineNumber: this._cursorController.position.lineNumber,
            endColumn: this._cursorController.position.column,
          },
          text: "",
        },
      ]);
    }

    // Insert at drop position
    this._model.pushEditOperations([
      {
        range: {
          startLineNumber: dropLine,
          startColumn: dropCol,
          endLineNumber: dropLine,
          endColumn: dropCol,
        },
        text,
      },
    ]);

    this._isDragging = false;
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
  };
}

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
