/**
 * CompositionHandler — manages IME composition state.
 *
 * During IME composition (e.g., Japanese, Chinese, Korean input),
 * the textarea contains the composing text. When composition ends,
 * the final committed text is sent to the cursor controller.
 *
 * The TextAreaInput already handles compositionstart/compositionupdate/
 * compositionend events. This handler provides additional logic for
 * managing the composition state across the editor.
 */

import type { CursorController } from "../cursor/cursor-controller";

/**
 * Composition state.
 */
export interface CompositionState {
  /** Whether a composition is in progress. */
  readonly isComposing: boolean;
  /** The current composing text (partial input). */
  readonly composingText: string;
}

/**
 * Handles IME composition events.
 */
export class CompositionHandler {
  private _cursorController: CursorController;
  private _isComposing: boolean = false;
  private _composingText: string = "";

  constructor(cursorController: CursorController) {
    this._cursorController = cursorController;
  }

  /**
   * Get the current composition state.
   */
  get state(): CompositionState {
    return {
      isComposing: this._isComposing,
      composingText: this._composingText,
    };
  }

  /**
   * Handle composition start.
   */
  onCompositionStart(): void {
    this._isComposing = true;
    this._composingText = "";
  }

  /**
   * Handle composition update (partial input changed).
   */
  onCompositionUpdate(data: string): void {
    this._composingText = data;
  }

  /**
   * Handle composition end (committed text).
   * The committed text is inserted into the model.
   */
  onCompositionEnd(data: string): void {
    this._isComposing = false;
    this._composingText = "";

    if (data && data.length > 0) {
      // Insert the final composed text
      this._cursorController.insertChar(data);
    }
  }

  /**
   * Check if a composition is in progress.
   */
  get isComposing(): boolean {
    return this._isComposing;
  }

  /**
   * Reset the composition state (e.g., on blur).
   */
  reset(): void {
    this._isComposing = false;
    this._composingText = "";
  }

  /**
   * Dispose the handler.
   */
  dispose(): void {
    this.reset();
  }
}
