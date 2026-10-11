/**
 * TextAreaState — tracks the content and selection state of the hidden
 * textarea element.
 *
 * The hidden textarea's value and selectionStart/selectionEnd are synced
 * on every cursor move. This class computes what the textarea value should
 * be based on the current cursor context, and detects when the user has
 * changed it (indicating typed input).
 */

export class TextAreaState {
  /**
   * The value of the textarea.
   */
  value: string;

  /**
   * The selection start (0-based).
   */
  selectionStart: number;

  /**
   * The selection end (0-based).
   */
  selectionEnd: number;

  /**
   * The selection start within the original value (before any sync).
   */
  selectionStartPosition: number;

  /**
   * The selection end within the original value (before any sync).
   */
  selectionEndPosition: number;

  constructor(
    value: string = "",
    selectionStart: number = 0,
    selectionEnd: number = 0,
    selectionStartPosition: number = 0,
    selectionEndPosition: number = 0,
  ) {
    this.value = value;
    this.selectionStart = selectionStart;
    this.selectionEnd = selectionEnd;
    this.selectionStartPosition = selectionStartPosition;
    this.selectionEndPosition = selectionEndPosition;
  }

  /**
   * Create a new state from a textarea DOM element.
   */
  static fromTextArea(textarea: HTMLTextAreaElement): TextAreaState {
    return new TextAreaState(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
  }

  /**
   * Apply this state to a textarea DOM element.
   */
  applyToTextArea(textarea: HTMLTextAreaElement): void {
    if (textarea.value !== this.value) {
      textarea.value = this.value;
    }
    if (
      textarea.selectionStart !== this.selectionStart ||
      textarea.selectionEnd !== this.selectionEnd
    ) {
      textarea.selectionStart = this.selectionStart;
      textarea.selectionEnd = this.selectionEnd;
    }
  }

  /**
   * Compute the new value for the textarea based on the cursor context.
   * The textarea should contain a small amount of context around the cursor
   * for IME composition and screen reader support.
   *
   * @param textBeforeCursor - Text before the cursor (up to some limit).
   * @param textAfterCursor - Text after the cursor (up to some limit).
   * @returns A new TextAreaState with the computed value and selection.
   */
  static computeForCursorContext(textBeforeCursor: string, textAfterCursor: string): TextAreaState {
    const value = textBeforeCursor + textAfterCursor;
    const selectionStart = textBeforeCursor.length;
    const selectionEnd = textBeforeCursor.length;

    return new TextAreaState(value, selectionStart, selectionEnd, selectionStart, selectionEnd);
  }

  /**
   * Detect what key event should be synthesized based on the difference
   * between the previous state and the current DOM state.
   *
   * Returns the detected input type or null if nothing was typed.
   */
  static detectInputType(
    prevState: TextAreaState,
    currentState: TextAreaState,
  ):
    | "insertChar"
    | "insertNewLine"
    | "deleteLeft"
    | "deleteRight"
    | "replaceSelection"
    | "composition"
    | null {
    const prevVal = prevState.value;
    const curVal = currentState.value;
    const prevStart = prevState.selectionStart;
    const prevEnd = prevState.selectionEnd;
    const curStart = currentState.selectionStart;
    const curEnd = currentState.selectionEnd;

    // No change
    if (prevVal === curVal && prevStart === curStart && prevEnd === curEnd) {
      return null;
    }

    // Newline inserted
    if (curVal.includes("\n")) {
      return "insertNewLine";
    }

    // Single character inserted at cursor position
    if (
      curVal.length === prevVal.length + 1 &&
      curStart === curEnd &&
      curStart === prevStart + 1 &&
      curVal.substring(0, prevStart) === prevVal.substring(0, prevStart) &&
      curVal.substring(prevStart + 1) === prevVal.substring(prevStart)
    ) {
      return "insertChar";
    }

    // Text deleted (backspace)
    if (
      curVal.length === prevVal.length - 1 &&
      prevStart === prevEnd &&
      prevStart > 0 &&
      curStart === curEnd &&
      curStart === prevStart - 1 &&
      curVal === prevVal.substring(0, prevStart - 1) + prevVal.substring(prevStart)
    ) {
      return "deleteLeft";
    }

    // Text deleted (delete forward)
    if (
      curVal.length === prevVal.length - 1 &&
      prevStart === prevEnd &&
      prevStart < prevVal.length &&
      curStart === curEnd &&
      curStart === prevStart &&
      prevVal.substring(prevStart, prevStart + 1) !== "" &&
      curVal === prevVal.substring(0, prevStart) + prevVal.substring(prevStart + 1)
    ) {
      return "deleteRight";
    }

    // Selection replacement (paste, input method)
    if (prevStart !== prevEnd && curStart === curEnd && curVal !== prevVal) {
      return "replaceSelection";
    }

    // IME composition
    return "composition";
  }

  /**
   * Create a clone of this state.
   */
  clone(): TextAreaState {
    return new TextAreaState(
      this.value,
      this.selectionStart,
      this.selectionEnd,
      this.selectionStartPosition,
      this.selectionEndPosition,
    );
  }
}
