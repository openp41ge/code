/**
 * EditStack — command-based undo/redo for TextContentModel.
 *
 * Stores edits as stacks of TextChange deltas rather than full snapshots.
 * Each stack element represents one user-visible undo step (which may
 * consist of multiple individual edit operations).
 *
 * Undo/redo is per-model — when multiple tabs share the same model,
 * they also share the same edit stack.
 */

import type { TextChange } from "./text-change";

/**
 * Local TextSelection type matching the openp41ge package's TextSelection
 * structurally — avoids a direct package import dependency.
 */
export interface EditorTextSelection {
  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;
}

export interface EditStackElement {
  /** The text changes that make up this edit (forward direction). */
  readonly changes: TextChange[];
  /** The cursor state before this edit was applied. */
  readonly beforeCursorState: EditorTextSelection[] | null;
  /** The cursor state after this edit was applied. */
  readonly afterCursorState: EditorTextSelection[] | null;
  /** The EOL before this edit. */
  readonly beforeEOL: "\n" | "\r\n";
  /** The EOL after this edit. */
  readonly afterEOL: "\n" | "\r\n";
  /** The version ID before this edit. */
  readonly beforeVersionId: number;
  /** The version ID after this edit. */
  readonly afterVersionId: number;
}

export class EditStack {
  private _undoStack: EditStackElement[] = [];
  private _redoStack: EditStackElement[] = [];

  /** Current stack pointer — points to the last applied element. */
  private _currentIndex: number = -1;

  get canUndo(): boolean {
    return this._currentIndex >= 0;
  }

  get canRedo(): boolean {
    return this._currentIndex < this._undoStack.length - 1;
  }

  get size(): number {
    return this._undoStack.length;
  }

  /**
   * Push a new edit stack element (i.e., the user performed an action).
   * Clears any redo history.
   */
  pushElement(element: EditStackElement): void {
    this._undoStack = this._undoStack.slice(0, this._currentIndex + 1);
    this._undoStack.push(element);
    this._currentIndex++;
    this._redoStack = [];
  }

  /**
   * Pop the top element from the undo stack (for reverting).
   */
  popUndo(): EditStackElement | null {
    if (!this.canUndo) return null;
    const element = this._undoStack[this._currentIndex];
    this._redoStack.push(element);
    this._currentIndex--;
    return element;
  }

  /**
   * Pop the top element from the redo stack (for re-applying).
   */
  popRedo(): EditStackElement | null {
    if (!this.canRedo) return null;
    this._currentIndex++;
    const element = this._undoStack[this._currentIndex];
    this._redoStack.pop();
    return element;
  }

  /**
   * Peek at the top of the undo stack without popping.
   */
  peekUndo(): EditStackElement | null {
    if (!this.canUndo) return null;
    return this._undoStack[this._currentIndex];
  }

  /**
   * Peek at the top of the redo stack without popping.
   */
  peekRedo(): EditStackElement | null {
    if (!this.canRedo) return null;
    return this._undoStack[this._currentIndex + 1];
  }

  /**
   * Clear all undo/redo history.
   */
  clear(): void {
    this._undoStack = [];
    this._redoStack = [];
    this._currentIndex = -1;
  }

  /**
   * Get the version ID at the top of the undo stack.
   */
  getAlternativeVersionId(): number {
    if (this._currentIndex >= 0) {
      return this._undoStack[this._currentIndex].afterVersionId;
    }
    return 0;
  }
}
