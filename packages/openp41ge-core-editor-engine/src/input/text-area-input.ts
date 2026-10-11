/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * TextAreaInput — captures keyboard, IME, and clipboard input via a hidden
 * transparent textarea positioned precisely over the cursor.
 *
 * The textarea is:
 *   - Transparent (opacity: 0 or color: transparent)
 *   - Positioned absolutely over the cursor using pixel coordinates
 *   - Sized to approximately one character width/height
 *   - Always focused when the editor is active
 *   - Its value is synced on every cursor move with cursor context
 *
 * This is the same approach VS Code uses. It handles all edge cases:
 * IME composition, emoji input, clipboard, screen readers, dead keys.
 */

import { TextAreaState } from "./text-area-state";
import type { CursorController } from "../cursor/cursor-controller";

/**
 * Callback for when text is typed (single character).
 */
export type OnTypeCallback = (char: string) => void;

/**
 * Callback for when a newline is inserted.
 */
export type OnNewLineCallback = () => void;

/**
 * Callback for when text is deleted left (backspace).
 */
export type OnDeleteLeftCallback = () => void;

/**
 * Callback for when text is deleted right (delete key).
 */
export type OnDeleteRightCallback = () => void;

/**
 * Callback for when a selection is replaced (paste, input method).
 */
export type OnReplaceSelectionCallback = (text: string) => void;

/**
 * Callback for IME composition.
 * Returns the composing text.
 */
export type OnCompositionCallback = (text: string) => void;

/**
 * Callback for paste event.
 */
export type OnPasteCallback = (text: string) => void;

/**
 * Callback for cut event.
 */
export type OnCutCallback = () => string;

/**
 * Callback for copy event.
 * Returns the selected text to be written to the clipboard.
 */
export type OnCopyCallback = () => string;

/**
 * Callback for keyboard shortcuts (Cmd+Z, Cmd+S, etc.).
 * Returns true if the shortcut was handled.
 */
export type OnKeyCallback = (event: KeyboardEvent) => boolean;

/**
 * Configuration for TextAreaInput.
 */
export interface TextAreaInputConfig {
  /** Parent element for the textarea. */
  parentElement: HTMLElement;
  /** Cursor controller for position/sync. */
  cursorController: CursorController;
  /** Called when a character is typed. */
  onType?: OnTypeCallback;
  /** Called when Enter is pressed. */
  onNewLine?: OnNewLineCallback;
  /** Called on backspace. */
  onDeleteLeft?: OnDeleteLeftCallback;
  /** Called on Delete key. */
  onDeleteRight?: OnDeleteRightCallback;
  /** Called when pasted/replacement text arrives. */
  onReplaceSelection?: OnReplaceSelectionCallback;
  /** Called during IME composition. */
  onComposition?: OnCompositionCallback;
  /** Called on paste (before onReplaceSelection). */
  onPaste?: OnPasteCallback;
  /** Called on cut. */
  onCut?: OnCutCallback;
  /** Called on copy. Should return the selected text. */
  onCopy?: OnCopyCallback;
  /** Called for keyboard shortcuts. Return true if handled. */
  onKey?: OnKeyCallback;
  /** Called on focus gained. */
  onFocus?: () => void;
  /** Called on focus lost. */
  onBlur?: () => void;
}

/**
 * The hidden textarea input capture system.
 */
export class TextAreaInput {
  private _textArea: HTMLTextAreaElement;
  private _config: TextAreaInputConfig;
  private _prevState: TextAreaState = new TextAreaState();
  private _isComposing: boolean = false;
  private _compositionText: string = "";
  private _disposed: boolean = false;

  constructor(config: TextAreaInputConfig) {
    this._config = config;

    // Create the hidden textarea
    this._textArea = document.createElement("textarea");
    this._textArea.className = "fe-hidden-textarea";
    this._textArea.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: 0;
      border: none;
      outline: none;
      resize: none;
      overflow: hidden;
      opacity: 0;
      z-index: -10;
      white-space: pre;
      tab-size: 1;
      font-size: inherit;
      font-family: inherit;
      line-height: inherit;
    `;

    // The textarea is visually hidden via CSS (opacity:0, z-index:-10).
    // We intentionally do NOT set aria-hidden because the textarea retains
    // focus (required for keyboard input capture), and aria-hidden on a
    // focused element triggers an accessibility warning.

    config.parentElement.appendChild(this._textArea);

    // Bind events
    this._textArea.addEventListener("beforeinput", this._onBeforeInput);
    this._textArea.addEventListener("input", this._onInput);
    this._textArea.addEventListener("compositionstart", this._onCompositionStart);
    this._textArea.addEventListener("compositionupdate", this._onCompositionUpdate);
    this._textArea.addEventListener("compositionend", this._onCompositionEnd);
    this._textArea.addEventListener("keydown", this._onKeyDown);
    this._textArea.addEventListener("focus", this._onFocus);
    this._textArea.addEventListener("blur", this._onBlur);
    this._textArea.addEventListener("paste", this._onPaste);
    this._textArea.addEventListener("cut", this._onCut);
    this._textArea.addEventListener("copy", this._onCopy);
  }

  /**
   * Focus the textarea — call this when the editor is activated.
   */
  focus(): void {
    this._textArea.focus({ preventScroll: true });
  }

  /**
   * Check if the textarea is focused.
   */
  get isFocused(): boolean {
    return document.activeElement === this._textArea;
  }

  /**
   * Get the underlying textarea element.
   */
  get element(): HTMLTextAreaElement {
    return this._textArea;
  }

  /**
   * Position the textarea at a given screen pixel coordinate.
   * Called on every cursor move and scroll.
   *
   * @param x - Left position in pixels.
   * @param y - Top position in pixels.
   * @param width - Width in pixels (typically 1 character width).
   * @param height - Height in pixels (typically line height).
   */
  positionAt(x: number, y: number, width: number = 20, height: number = 18): void {
    this._textArea.style.left = `${Math.max(0, x)}px`;
    this._textArea.style.top = `${Math.max(0, y)}px`;
    this._textArea.style.width = `${width}px`;
    this._textArea.style.height = `${height}px`;
  }

  /**
   * Sync the textarea value with the current cursor context.
   * This should be called on every cursor move.
   *
   * @param textBeforeCursor - Text before the cursor position.
   * @param textAfterCursor - Text after the cursor position.
   */
  syncWithCursor(textBeforeCursor: string, textAfterCursor: string): void {
    const newState = TextAreaState.computeForCursorContext(textBeforeCursor, textAfterCursor);

    // Store previous state BEFORE applying new one
    this._prevState = new TextAreaState(
      this._textArea.value,
      this._textArea.selectionStart,
      this._textArea.selectionEnd,
      this._textArea.selectionStart,
      this._textArea.selectionEnd,
    );

    newState.applyToTextArea(this._textArea);
  }

  /**
   * Sync selection state (for multi-cursor / selection changes without content change).
   */
  syncSelection(selectionStart: number, selectionEnd: number): void {
    this._prevState = new TextAreaState(
      this._textArea.value,
      this._textArea.selectionStart,
      this._textArea.selectionEnd,
      this._textArea.selectionStart,
      this._textArea.selectionEnd,
    );

    this._textArea.selectionStart = selectionStart;
    this._textArea.selectionEnd = selectionEnd;
  }

  /**
   * Get the currently selected text in the textarea.
   */
  getSelectedText(): string {
    return this._textArea.value.substring(
      this._textArea.selectionStart,
      this._textArea.selectionEnd,
    );
  }

  /**
   * Dispose the input handler.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._textArea.removeEventListener("beforeinput", this._onBeforeInput);
    this._textArea.removeEventListener("input", this._onInput);
    this._textArea.removeEventListener("compositionstart", this._onCompositionStart);
    this._textArea.removeEventListener("compositionupdate", this._onCompositionUpdate);
    this._textArea.removeEventListener("compositionend", this._onCompositionEnd);
    this._textArea.removeEventListener("keydown", this._onKeyDown);
    this._textArea.removeEventListener("focus", this._onFocus);
    this._textArea.removeEventListener("blur", this._onBlur);
    this._textArea.removeEventListener("paste", this._onPaste);
    this._textArea.removeEventListener("cut", this._onCut);
    this._textArea.removeEventListener("copy", this._onCopy);

    this._textArea.remove();
  }

  // ── Event Handlers ──

  private _onBeforeInput = (e: InputEvent): void => {
    if (this._disposed) return;
    // beforeinput fires before input, allowing us to cancel certain actions
    // We let it proceed normally; the actual input handling is in _onInput
  };

  private _onInput = (e: Event): void => {
    if (this._disposed) return;

    const currentState = TextAreaState.fromTextArea(this._textArea);
    const inputType = TextAreaState.detectInputType(this._prevState, currentState);

    if (inputType === "insertChar") {
      // Find the inserted character
      const prevVal = this._prevState.value;
      const curVal = currentState.value;
      const insertedChar = curVal.substring(prevVal.length);
      this._config.onType?.(insertedChar || curVal[currentState.selectionStart - 1]);
    } else if (inputType === "insertNewLine") {
      this._config.onNewLine?.();
    } else if (inputType === "deleteLeft") {
      this._config.onDeleteLeft?.();
    } else if (inputType === "deleteRight") {
      this._config.onDeleteRight?.();
    } else if (inputType === "replaceSelection") {
      this._config.onReplaceSelection?.(currentState.value);
    }

    this._prevState = currentState.clone();
  };

  private _onCompositionStart = (): void => {
    if (this._disposed) return;
    this._isComposing = true;
    this._compositionText = "";
  };

  private _onCompositionUpdate = (e: CompositionEvent): void => {
    if (this._disposed) return;
    this._compositionText = e.data;
    this._config.onComposition?.(e.data);
  };

  private _onCompositionEnd = (e: CompositionEvent): void => {
    if (this._disposed) return;
    this._isComposing = false;

    // The final composition text may have been committed
    if (e.data && e.data.length > 0) {
      this._config.onType?.(e.data);
    }
    this._compositionText = "";
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (this._disposed) return;
    if (this._isComposing) return;

    // Let the key handler attempt to handle it
    if (this._config.onKey) {
      const handled = this._config.onKey(e);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  private _onFocus = (): void => {
    this._config.onFocus?.();
  };

  private _onBlur = (): void => {
    this._config.onBlur?.();
  };

  private _onCopy = (e: ClipboardEvent): void => {
    if (this._disposed) return;
    const text = this._config.onCopy?.() || "";
    if (text) {
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
    }
  };

  private _onPaste = (e: ClipboardEvent): void => {
    if (this._disposed) return;
    const text = e.clipboardData?.getData("text/plain") || "";
    this._config.onPaste?.(text);
  };

  private _onCut = (e: ClipboardEvent): void => {
    if (this._disposed) return;
    const text = this._config.onCut?.() || "";
    if (text) {
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
    }
  };
}
