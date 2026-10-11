/**
 * KeyboardHandler — maps keyboard events to edit commands.
 *
 * Handles:
 *   - Typing (single characters via TextAreaInput)
 *   - Enter key
 *   - Backspace / Delete
 *   - Arrow keys for cursor movement
 *   - Cmd+Z / Cmd+Shift+Z for undo/redo
 *   - Cmd+S for save
 *   - Cmd+A for select all
 *   - Home / End
 *   - PageUp / PageDown
 *   - Option+Arrow for word movement
 *   - Shift+Arrow for selection
 *   - Multi-cursor shortcuts (Cmd+Alt+ArrowUp/Down, Cmd+D, Cmd+Shift+L, Escape, Alt+Shift+I)
 */

import type { CursorController } from "../cursor/cursor-controller";

/**
 * KeyboardHandler — maps key events to CursorController operations.
 */
export class KeyboardHandler {
  private _cursorController: CursorController;

  constructor(cursorController: CursorController) {
    this._cursorController = cursorController;
  }

  /**
   * Handle a keydown event. Returns true if the event was handled.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    const isCmd = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;
    const isAlt = event.altKey;

    // Multi-cursor: Escape collapses to single cursor
    if (event.key === "Escape" && !isCmd && !isAlt && !isShift) {
      if (this._cursorController.hasMultipleCursors) {
        this._cursorController.removeSecondaryCursors();
        return true;
      }
    }

    // Multi-cursor: Cmd+Alt+ArrowUp/Down — add cursor above/below
    if (isCmd && isAlt && !isShift) {
      switch (event.key) {
        case "ArrowDown":
          this._cursorController.addCursorBelow();
          return true;
        case "ArrowUp":
          this._cursorController.addCursorAbove();
          return true;
      }
    }

    // Multi-cursor: Alt+Shift+I — add cursors to selection line ends
    if (isAlt && isShift && !isCmd) {
      switch (event.key) {
        case "i":
        case "I":
          this._cursorController.addCursorsToSelectionLines();
          return true;
      }
    }

    // Command shortcuts (Cmd+...)
    if (isCmd && !isAlt) {
      switch (event.key) {
        case "z":
        case "Z":
          if (isShift) {
            this._cursorController.redo();
          } else {
            this._cursorController.undo();
          }
          return true;
        case "s":
        case "S":
          // Save is handled at the platform level (app.ts keyboard manager).
          // Return false so the event propagates to the document listener.
          return false;
        case "a":
        case "A":
          this._cursorController.selectAll();
          return true;
        case "c":
        case "C":
          // Copy is handled natively by the hidden textarea
          return false;
        case "x":
        case "X":
          // Cut is handled natively
          return false;
        case "v":
        case "V":
          // Paste is handled via input events
          return false;
        case "d":
        case "D":
          if (isShift) {
            // Cmd+Shift+L — select all occurrences
            this._cursorController.selectAllOccurrences();
          } else {
            // Cmd+D — add next match
            this._cursorController.addSelectionToNextFindMatch();
          }
          return true;
        case "l":
        case "L":
          if (isShift) {
            // Cmd+Shift+L — select all occurrences
            this._cursorController.selectAllOccurrences();
          }
          return true;
        case "ArrowLeft":
          if (isShift) {
            this._cursorController.selectToLineStart();
          } else {
            this._cursorController.moveToLineStart();
          }
          return true;
        case "ArrowRight":
          if (isShift) {
            this._cursorController.selectToLineEnd();
          } else {
            this._cursorController.moveToLineEnd();
          }
          return true;
        case "ArrowUp":
          if (isShift) {
            this._cursorController.selectToFileStart();
          } else {
            this._cursorController.moveToFileStart();
          }
          return true;
        case "ArrowDown":
          if (isShift) {
            this._cursorController.selectToFileEnd();
          } else {
            this._cursorController.moveToFileEnd();
          }
          return true;
      }
    }

    // Non-modified keys
    if (!isCmd && !isAlt && !isShift) {
      switch (event.key) {
        case "Enter":
          this._cursorController.insertNewLine();
          return true;
        case "Backspace":
          this._cursorController.deleteLeft();
          return true;
        case "Delete":
          this._cursorController.deleteRight();
          return true;
        case "ArrowUp":
          this._cursorController.moveUp();
          return true;
        case "ArrowDown":
          this._cursorController.moveDown();
          return true;
        case "ArrowLeft":
          this._cursorController.moveLeft();
          return true;
        case "ArrowRight":
          this._cursorController.moveRight();
          return true;
        case "Home":
          this._cursorController.moveToLineStart();
          return true;
        case "End":
          this._cursorController.moveToLineEnd();
          return true;
        case "PageUp":
          this._cursorController.movePageUp();
          return true;
        case "PageDown":
          this._cursorController.movePageDown();
          return true;
        case "Tab":
          this._cursorController.insertTab();
          return true;
      }
    }

    // Shift+arrows for selection
    if (isShift && !isCmd && !isAlt) {
      switch (event.key) {
        case "ArrowUp":
          this._cursorController.selectUp();
          return true;
        case "ArrowDown":
          this._cursorController.selectDown();
          return true;
        case "ArrowLeft":
          this._cursorController.selectLeft();
          return true;
        case "ArrowRight":
          this._cursorController.selectRight();
          return true;
        case "Home":
          this._cursorController.selectToLineStart();
          return true;
        case "End":
          this._cursorController.selectToLineEnd();
          return true;
      }
    }

    // Option+Arrow for word movement & line move
    if (isAlt && !isCmd && !isShift) {
      switch (event.key) {
        case "ArrowLeft":
          this._cursorController.moveWordLeft();
          return true;
        case "ArrowRight":
          this._cursorController.moveWordRight();
          return true;
        case "ArrowUp":
          // Move the current line up (no-op at the top boundary).
          this._cursorController.moveLine(-1);
          return true;
        case "ArrowDown":
          // Move the current line down (no-op at the bottom boundary).
          this._cursorController.moveLine(1);
          return true;
      }
    }

    // Option+Shift+Arrow for word selection
    if (isAlt && isShift && !isCmd) {
      switch (event.key) {
        case "ArrowLeft":
          this._cursorController.selectWordLeft();
          return true;
        case "ArrowRight":
          this._cursorController.selectWordRight();
          return true;
      }
    }

    // Let the character fall through to input event
    return false;
  }
}
