/**
 * CursorController — manages the primary cursor position, selection,
 * multi-cursor support, and delegates operations to the text model.
 */

import type { PieceTreeTextContentModel } from "../model/piece-tree-text-content-model";
import type { TextPosition, TextSelection } from "../model";
import type { CoordinatesConverter } from "../model/coordinates-converter";
import {
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  moveToLineStart,
  moveToLineEnd,
  moveWordLeft,
  moveWordRight,
  movePageUp,
  movePageDown,
} from "./cursor-move-operations";
import { isSelectionNonEmpty, selectionRange, findWordBounds } from "./cursor-utils";

/**
 * A single cursor state (primary or secondary).
 */
export interface CursorState {
  position: TextPosition;
  selectionAnchor: TextPosition;
  goalColumn: number;
}

/**
 * Events emitted by CursorController.
 */
export interface CursorEvent {
  readonly type:
    "position-changed" | "selection-changed" | "edit" | "undo" | "redo" | "multi-cursor";
}

/**
 * Callback for cursor events.
 */
export type CursorEventHandler = (event: CursorEvent) => void;

/**
 * CursorController — primary cursor management, multi-cursor, editing.
 */
export class CursorController {
  private _model: PieceTreeTextContentModel;
  private _cursor: CursorState;
  private _secondaryCursors: CursorState[] = [];
  private _onDidChange: CursorEventHandler | null = null;
  private _visibleLineCount: number = 30;
  private _coordinatesConverter: CoordinatesConverter | null | undefined = null;

  constructor(model: PieceTreeTextContentModel) {
    this._model = model;
    this._cursor = {
      position: { lineNumber: 1, column: 1 },
      selectionAnchor: { lineNumber: 1, column: 1 },
      goalColumn: 1,
    };
  }

  get position(): TextPosition {
    return this._cursor.position;
  }

  get selection(): TextSelection {
    return {
      selectionStartLineNumber: this._cursor.selectionAnchor.lineNumber,
      selectionStartColumn: this._cursor.selectionAnchor.column,
      positionLineNumber: this._cursor.position.lineNumber,
      positionColumn: this._cursor.position.column,
    };
  }

  get cursorState(): CursorState {
    return { ...this._cursor };
  }

  getAllCursors(): CursorState[] {
    return [this._cursor, ...this._secondaryCursors];
  }

  get cursorCount(): number {
    return 1 + this._secondaryCursors.length;
  }

  get hasMultipleCursors(): boolean {
    return this._secondaryCursors.length > 0;
  }

  setVisibleLineCount(count: number): void {
    this._visibleLineCount = count;
  }

  set onDidChange(handler: CursorEventHandler | null) {
    this._onDidChange = handler as CursorEventHandler | null;
  }

  /**
   * Set the coordinates converter for word-wrap-aware movement.
   */
  setCoordinatesConverter(converter: CoordinatesConverter | null | undefined): void {
    this._coordinatesConverter = converter;
  }

  get model(): PieceTreeTextContentModel {
    return this._model;
  }

  // ── Multi-cursor ──

  addCursor(position: TextPosition): void {
    if (
      this._cursor.position.lineNumber === position.lineNumber &&
      this._cursor.position.column === position.column
    )
      return;
    for (const c of this._secondaryCursors) {
      if (c.position.lineNumber === position.lineNumber && c.position.column === position.column)
        return;
    }
    this._secondaryCursors.push({
      position: { ...position },
      selectionAnchor: { ...position },
      goalColumn: position.column,
    });
    this._emit("multi-cursor");
  }

  addCursorAt(lineNumber: number, column: number): void {
    this.addCursor({ lineNumber, column });
  }

  /** Add a cursor one line above the primary cursor. */
  addCursorAbove(): void {
    const pos = this._cursor.position;
    if (pos.lineNumber > 1) {
      this.addCursor({ lineNumber: pos.lineNumber - 1, column: pos.column });
    }
  }

  /** Add a cursor one line below the primary cursor. */
  addCursorBelow(): void {
    const pos = this._cursor.position;
    if (pos.lineNumber < this._model.lineCount) {
      this.addCursor({ lineNumber: pos.lineNumber + 1, column: pos.column });
    }
  }

  /** Add cursors at the start of each line in the current selection. */
  addCursorsToSelectionLines(): void {
    const sel = this.selection;
    const startLine = Math.min(sel.selectionStartLineNumber, sel.positionLineNumber);
    const endLine = Math.max(sel.selectionStartLineNumber, sel.positionLineNumber);
    this.removeSecondaryCursors();
    for (let line = startLine; line <= endLine; line++) {
      this.addCursor({ lineNumber: line, column: 1 });
    }
    this._emit("multi-cursor");
  }

  removeSecondaryCursors(): void {
    if (this._secondaryCursors.length === 0) return;
    this._secondaryCursors = [];
    this._emit("multi-cursor");
  }

  addCursorsToLineEnds(): void {
    const sel = this.selection;
    const startLine = Math.min(sel.selectionStartLineNumber, sel.positionLineNumber);
    const endLine = Math.max(sel.selectionStartLineNumber, sel.positionLineNumber);
    this.removeSecondaryCursors();
    for (let line = startLine; line <= endLine; line++) {
      const lineLen = this._model.getLineContent(line).length;
      this.addCursor({ lineNumber: line, column: lineLen + 1 });
    }
    const lastLineLen = this._model.getLineContent(endLine).length;
    this._cursor.position = { lineNumber: endLine, column: lastLineLen + 1 };
    this._cursor.selectionAnchor = this._cursor.position;
    this._emit("multi-cursor");
  }

  /**
   * Add a cursor at the next occurrence of the currently selected text.
   * If no text is selected, this is a no-op.
   */
  addSelectionToNextFindMatch(): void {
    const sel = this.selection;
    if (!isSelectionNonEmpty(sel)) return;

    const selectedText = this._model.getValueInRange({
      startLineNumber: Math.min(sel.selectionStartLineNumber, sel.positionLineNumber),
      startColumn: Math.min(sel.selectionStartColumn, sel.positionColumn),
      endLineNumber: Math.max(sel.selectionStartLineNumber, sel.positionLineNumber),
      endColumn: Math.max(sel.selectionStartColumn, sel.positionColumn),
    });
    if (selectedText.length === 0) return;

    // Find the end offset of the current selection
    const endOffset = this._model.getOffsetAt({
      lineNumber: Math.max(sel.selectionStartLineNumber, sel.positionLineNumber),
      column: Math.max(sel.selectionStartColumn, sel.positionColumn),
    });
    const fullText = this._model.getValue();
    const nextIndex = fullText.indexOf(selectedText, endOffset + 1);

    if (nextIndex >= 0) {
      const pos = this._model.getPositionAt(nextIndex);
      const endPos = this._model.getPositionAt(nextIndex + selectedText.length);
      this.addCursor(pos);
      // Select the matched text at the new cursor
      const newCursor = this._secondaryCursors[this._secondaryCursors.length - 1];
      if (newCursor) {
        newCursor.selectionAnchor = pos;
        newCursor.position = endPos;
      }
    }
  }

  /**
   * Add cursors at all occurrences of the currently selected text.
   */
  selectAllOccurrences(): void {
    const sel = this.selection;
    if (!isSelectionNonEmpty(sel)) return;

    const selectedText = this._model.getValueInRange({
      startLineNumber: Math.min(sel.selectionStartLineNumber, sel.positionLineNumber),
      startColumn: Math.min(sel.selectionStartColumn, sel.positionColumn),
      endLineNumber: Math.max(sel.selectionStartLineNumber, sel.positionLineNumber),
      endColumn: Math.max(sel.selectionStartColumn, sel.positionColumn),
    });
    if (selectedText.length === 0) return;

    this.removeSecondaryCursors();
    const fullText = this._model.getValue();
    let searchOffset = 0;
    let firstFound = true;

    while (true) {
      const index = fullText.indexOf(selectedText, searchOffset);
      if (index < 0) break;

      const pos = this._model.getPositionAt(index);
      const endPos = this._model.getPositionAt(index + selectedText.length);

      if (firstFound) {
        // Update primary cursor
        this._cursor.position = { ...endPos };
        this._cursor.selectionAnchor = { ...pos };
        this._cursor.goalColumn = endPos.column;
        firstFound = false;
      } else {
        this.addCursor(pos);
        // Select the match at the new cursor
        const newCursor = this._secondaryCursors[this._secondaryCursors.length - 1];
        if (newCursor) {
          newCursor.selectionAnchor = { ...pos };
          newCursor.position = { ...endPos };
        }
      }

      searchOffset = index + selectedText.length;
    }
  }

  // ── Movement (applies to ALL cursors — compute first, then emit) ──

  moveLeft(): void {
    const primaryPos = moveLeft(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveLeft(this._model, c.position),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }
  moveRight(): void {
    const primaryPos = moveRight(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveRight(this._model, c.position),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }

  moveUp(): void {
    const cc = this._coordinatesConverter;
    // Collapse selection to the top first, then compute all cursor moves
    let primaryStart = this._cursor.position;
    let primaryGoal = this._cursor.goalColumn;
    const sel = this.selection;
    if (isSelectionNonEmpty(sel)) {
      const topLine = Math.min(sel.selectionStartLineNumber, sel.positionLineNumber);
      const topCol =
        sel.selectionStartLineNumber <= sel.positionLineNumber
          ? sel.selectionStartColumn
          : sel.positionColumn;
      primaryStart = { lineNumber: topLine, column: topCol };
      primaryGoal = topCol;
    }

    const result = moveUp(this._model, primaryStart, primaryGoal, cc);
    const goalCol = result.goalColumn;
    const primaryPos = result.position;

    const secondaryPositions = this._secondaryCursors.map((c) => {
      const r = moveUp(this._model, c.position, c.goalColumn, cc);
      c.goalColumn = r.goalColumn;
      return { index: c, pos: r.position };
    });

    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
    this._cursor.goalColumn = goalCol;
  }

  moveDown(): void {
    const cc = this._coordinatesConverter;
    // Collapse selection to the bottom first, then compute all cursor moves
    let primaryStart = this._cursor.position;
    let primaryGoal = this._cursor.goalColumn;
    const sel = this.selection;
    if (isSelectionNonEmpty(sel)) {
      const bottomLine = Math.max(sel.selectionStartLineNumber, sel.positionLineNumber);
      const bottomCol =
        sel.selectionStartLineNumber >= sel.positionLineNumber
          ? sel.selectionStartColumn
          : sel.positionColumn;
      primaryStart = { lineNumber: bottomLine, column: bottomCol };
      primaryGoal = bottomCol;
    }

    const result = moveDown(this._model, primaryStart, primaryGoal, cc);
    const goalCol = result.goalColumn;
    const primaryPos = result.position;

    const secondaryPositions = this._secondaryCursors.map((c) => {
      const r = moveDown(this._model, c.position, c.goalColumn, cc);
      c.goalColumn = r.goalColumn;
      return { index: c, pos: r.position };
    });

    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
    this._cursor.goalColumn = goalCol;
  }

  moveTo(lineNumber: number, column: number): void {
    const lineCount = this._model.lineCount;
    const clampedLine = Math.max(1, Math.min(lineNumber, lineCount));
    const lineLen = this._model.getLineContent(clampedLine).length;
    const clampedCol = Math.max(1, Math.min(column, lineLen + 1));
    this._cursor.goalColumn = clampedCol;
    this._setPosition({ lineNumber: clampedLine, column: clampedCol });
  }

  /**
   * Select the entire content of a line. The cursor ends up at the start
   * of the line with the selection extending to the end of the line.
   */
  selectLine(lineNumber: number): void {
    const lineCount = this._model.lineCount;
    const clampedLine = Math.max(1, Math.min(lineNumber, lineCount));
    const lineLen = this._model.getLineContent(clampedLine).length;
    const startCol = 1;
    const endCol = lineLen + 1;
    this._applyToSecondaryCursors((cursor) => {
      cursor.selectionAnchor = { lineNumber: clampedLine, column: startCol };
      cursor.position = { lineNumber: clampedLine, column: endCol };
      cursor.goalColumn = endCol;
    });
    this._cursor.selectionAnchor = { lineNumber: clampedLine, column: startCol };
    this._cursor.position = { lineNumber: clampedLine, column: endCol };
    this._cursor.goalColumn = endCol;
    this._emit("selection-changed");
  }

  /**
   * Select the word at the given position.
   * Expands left and right to word boundaries (whitespace/separator).
   * On empty lines, moves cursor to column 1 with no selection.
   */
  selectWordAt(position: { lineNumber: number; column: number }): void {
    const bounds = findWordBounds(this._model, position.lineNumber, position.column);
    if (!bounds) {
      // Empty line: just move cursor to column 1
      this._setPosition({ lineNumber: position.lineNumber, column: 1 });
      return;
    }
    this._cursor.selectionAnchor = {
      lineNumber: position.lineNumber,
      column: bounds.start,
    };
    this._cursor.position = {
      lineNumber: position.lineNumber,
      column: bounds.end,
    };
    this._cursor.goalColumn = bounds.end;
    this._emit("selection-changed");
  }
  moveToLineStart(): void {
    const primaryPos = moveToLineStart(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveToLineStart(this._model, c.position),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }
  moveToLineEnd(): void {
    const primaryPos = moveToLineEnd(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveToLineEnd(this._model, c.position),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }
  moveToFileStart(): void {
    const pos = { lineNumber: 1, column: 1 };
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: { ...pos },
    }));
    for (const { index: c, pos: p } of secondaryPositions) {
      c.position = p;
      c.selectionAnchor = { ...p };
    }
    this._setPosition(pos);
  }
  moveToFileEnd(): void {
    const lastLine = this._model.lineCount;
    const lastLineLen = this._model.getLineContent(lastLine).length;
    const pos = { lineNumber: lastLine, column: lastLineLen + 1 };
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: { ...pos },
    }));
    for (const { index: c, pos: p } of secondaryPositions) {
      c.position = p;
      c.selectionAnchor = { ...p };
    }
    this._setPosition(pos);
  }
  moveWordLeft(): void {
    const primaryPos = moveWordLeft(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveWordLeft(this._model, c.position),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }
  moveWordRight(): void {
    const primaryPos = moveWordRight(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveWordRight(this._model, c.position),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }
  movePageUp(): void {
    const primaryPos = movePageUp(this._model, this._cursor.position, this._visibleLineCount);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: movePageUp(this._model, c.position, this._visibleLineCount),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }
  movePageDown(): void {
    const primaryPos = movePageDown(this._model, this._cursor.position, this._visibleLineCount);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: movePageDown(this._model, c.position, this._visibleLineCount),
    }));
    for (const { index: c, pos } of secondaryPositions) {
      c.position = pos;
      c.selectionAnchor = { ...pos };
    }
    this._setPosition(primaryPos);
  }

  // ── Selection (applies to ALL cursors) ──

  selectLeft(): void {
    // Update ALL cursors before emitting — prevents stale view render
    const primaryPos = moveLeft(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveLeft(this._model, c.position),
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectRight(): void {
    const primaryPos = moveRight(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveRight(this._model, c.position),
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectUp(): void {
    const cc = this._coordinatesConverter;
    const result = moveUp(this._model, this._cursor.position, this._cursor.goalColumn, cc);
    const goalCol = result.goalColumn;
    const primaryPos = result.position;
    const secondaryPositions = this._secondaryCursors.map((c) => {
      const r = moveUp(this._model, c.position, c.goalColumn, cc);
      c.goalColumn = r.goalColumn;
      return { index: c, pos: r.position };
    });
    this._cursor.goalColumn = goalCol;
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectDown(): void {
    const cc = this._coordinatesConverter;
    const result = moveDown(this._model, this._cursor.position, this._cursor.goalColumn, cc);
    const goalCol = result.goalColumn;
    const primaryPos = result.position;
    const secondaryPositions = this._secondaryCursors.map((c) => {
      const r = moveDown(this._model, c.position, c.goalColumn, cc);
      c.goalColumn = r.goalColumn;
      return { index: c, pos: r.position };
    });
    this._cursor.goalColumn = goalCol;
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectToLineStart(): void {
    const primaryPos = moveToLineStart(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveToLineStart(this._model, c.position),
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectToLineEnd(): void {
    const primaryPos = moveToLineEnd(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveToLineEnd(this._model, c.position),
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectToFileStart(): void {
    const primaryPos = { lineNumber: 1, column: 1 };
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: { lineNumber: 1, column: 1 },
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectToFileEnd(): void {
    const ll = this._model.lineCount;
    const lll = this._model.getLineContent(ll).length;
    const endPos = { lineNumber: ll, column: lll + 1 };
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: { ...endPos },
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(endPos);
  }
  selectWordLeft(): void {
    const primaryPos = moveWordLeft(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveWordLeft(this._model, c.position),
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectWordRight(): void {
    const primaryPos = moveWordRight(this._model, this._cursor.position);
    const secondaryPositions = this._secondaryCursors.map((c) => ({
      index: c,
      pos: moveWordRight(this._model, c.position),
    }));
    this._applySecondarySelectionPositions(secondaryPositions);
    this._moveSelectionTo(primaryPos);
  }
  selectAll(): void {
    const lineCount = this._model.lineCount;
    const lastLine = this._model.getLineContent(lineCount);
    const endCol = lastLine.length + 1;
    const anchor = { lineNumber: 1, column: 1 };
    const end = { lineNumber: lineCount, column: endCol };
    // Update ALL cursors before emitting
    this._applyToSecondaryCursors((cursor) => {
      cursor.selectionAnchor = { ...anchor };
      cursor.position = { ...end };
      cursor.goalColumn = endCol;
    });
    this._cursor.selectionAnchor = anchor;
    this._cursor.position = end;
    this._cursor.goalColumn = endCol;
    this._emit("selection-changed");
  }

  /**
   * Replace all cursor states (primary + secondaries), preserving any
   * selections — including multiple cursors at the same position.
   *
   * Used by hosts that maintain their own coordinate model (e.g. a folding
   * editor whose visible buffer maps to a shared text model) to seed the
   * controller with their caret state before delegating a movement/selection
   * command, and by hosts restoring cursor state after the model changes.
   */
  setCursorStates(states: Array<{ position: TextPosition; selectionAnchor: TextPosition }>): void {
    if (states.length === 0) return;
    const first = states[0];
    this._cursor = {
      position: { ...first.position },
      selectionAnchor: { ...first.selectionAnchor },
      goalColumn: first.position.column,
    };
    this._secondaryCursors = states.slice(1).map((s) => ({
      position: { ...s.position },
      selectionAnchor: { ...s.selectionAnchor },
      goalColumn: s.position.column,
    }));
    this._emit(states.length > 1 ? "multi-cursor" : "selection-changed");
  }

  /**
   * Move the cursor position to (lineNumber, column) without changing the
   * selection anchor. This extends or shrinks the current selection.
   * Used for mouse-driven text selection (click and drag).
   */
  selectTo(lineNumber: number, column: number): void {
    const lineCount = this._model.lineCount;
    const clampedLine = Math.max(1, Math.min(lineNumber, lineCount));
    const lineLen = this._model.getLineContent(clampedLine).length;
    const clampedCol = Math.max(1, Math.min(column, lineLen + 1));
    this._cursor.goalColumn = clampedCol;
    this._moveSelectionTo({ lineNumber: clampedLine, column: clampedCol });
  }

  // ── Editing (applies to ALL cursors) ──

  private _captureCursorState(): void {
    const allCursors = this.getAllCursors();
    this._model.setBeforeEditCursorState(
      allCursors.map((c) => ({
        selectionStartLineNumber: c.selectionAnchor?.lineNumber ?? c.position.lineNumber,
        selectionStartColumn: c.selectionAnchor?.column ?? c.position.column,
        positionLineNumber: c.position.lineNumber,
        positionColumn: c.position.column,
      })),
    );
  }

  insertChar(char: string): void {
    this._captureCursorState();
    // Batch all edits into a single model operation for proper undo
    const allCursors = this.getAllCursors();
    const edits = allCursors.map((c) => {
      const sel = this._getSelectionOrNullFor(c);
      const range =
        sel && isSelectionNonEmpty(sel)
          ? selectionRange(sel)
          : {
              startLineNumber: c.position.lineNumber,
              startColumn: c.position.column,
              endLineNumber: c.position.lineNumber,
              endColumn: c.position.column,
            };
      return { range, text: char };
    });
    this._model.pushEditOperations(edits);

    // Update positions for all cursors after the batched edit
    const newPositions = edits.map((e) => this._computeNewPosition(e.range, char));
    this._cursor.position = newPositions[0];
    this._cursor.selectionAnchor = this._cursor.position;
    this._cursor.goalColumn = this._cursor.position.column;
    for (let i = 1; i < newPositions.length; i++) {
      const c = this._secondaryCursors[i - 1];
      if (c) {
        c.position = newPositions[i];
        c.selectionAnchor = newPositions[i];
        c.goalColumn = newPositions[i].column;
      }
    }
    this._emit("edit");
  }

  insertNewLine(): void {
    this.insertChar("\n");
  }

  /** Alt/Option+ArrowUp/Down — move the primary cursor's current line up/down
   *  (VS Code). Swaps the line with its neighbor and follows the caret to the
   *  same column on the moved line. */
  moveLine(dir: 1 | -1): void {
    const line = this._cursor.position.lineNumber;
    const target = line + dir;
    if (target < 1 || target > this._model.lineCount) return;
    const self = this._model.getLineContent(line);
    const other = this._model.getLineContent(target);
    this._captureCursorState();
    const range =
      dir < 0
        ? {
            startLineNumber: target,
            startColumn: 1,
            endLineNumber: line,
            endColumn: self.length + 1,
          }
        : {
            startLineNumber: line,
            startColumn: 1,
            endLineNumber: target,
            endColumn: other.length + 1,
          };
    // The model stores lines ","-separated; the EOL is owned by the model, so
    // insert with "\n" (it normalizes \r\n on the way in).
    const text = dir < 0 ? `${self}\n${other}` : `${other}\n${self}`;
    this._model.pushEditOperations([{ range, text }]);
    // Follow the caret to the moved line at the same (clamped) column.
    const newCol = Math.min(this._cursor.position.column, self.length + 1);
    this._cursor.position = { lineNumber: target, column: newCol };
    this._cursor.selectionAnchor = this._cursor.position;
    this._cursor.goalColumn = newCol;
    this._emit("edit");
  }

  insertTab(): void {
    this._captureCursorState();
    const spaces = "    ";
    const allCursors = this.getAllCursors();
    const edits = allCursors.map((c) => ({
      range: {
        startLineNumber: c.position.lineNumber,
        startColumn: c.position.column,
        endLineNumber: c.position.lineNumber,
        endColumn: c.position.column,
      },
      text: spaces,
    }));
    this._model.pushEditOperations(edits);

    const newPositions = edits.map((e) => this._computeNewPosition(e.range, spaces));
    this._cursor.position = newPositions[0];
    this._cursor.selectionAnchor = this._cursor.position;
    this._cursor.goalColumn = this._cursor.position.column;
    for (let i = 1; i < newPositions.length; i++) {
      const c = this._secondaryCursors[i - 1];
      if (c) {
        c.position = newPositions[i];
        c.selectionAnchor = newPositions[i];
      }
    }
    this._emit("edit");
  }

  deleteLeft(): void {
    this._captureCursorState();
    const allCursors = this.getAllCursors();
    // Sort in reverse order (right-to-left) so earlier deletions don't shift later cursors
    const sortedCursors = [...allCursors].sort((a, b) => {
      if (a.position.lineNumber !== b.position.lineNumber) {
        return b.position.lineNumber - a.position.lineNumber;
      }
      return b.position.column - a.position.column;
    });
    const edits = sortedCursors.map((c) => {
      const sel = this._getSelectionOrNullFor(c);
      if (sel && isSelectionNonEmpty(sel)) {
        const range = selectionRange(sel);
        return { range, text: "" };
      }
      // Backspace at column 1 on a non-first line: delete the newline and
      // join the current line with the previous one.
      if (c.position.column === 1 && c.position.lineNumber > 1) {
        const prevLineLen = this._model.getLineContent(c.position.lineNumber - 1).length;
        return {
          range: {
            startLineNumber: c.position.lineNumber - 1,
            startColumn: prevLineLen + 1,
            endLineNumber: c.position.lineNumber,
            endColumn: 1,
          },
          text: "",
        };
      }
      return {
        range: {
          startLineNumber: c.position.lineNumber,
          startColumn: Math.max(1, c.position.column - 1),
          endLineNumber: c.position.lineNumber,
          endColumn: c.position.column,
        },
        text: "",
      };
    });
    // Capture pre-edit previous line lengths for backspace-at-column-1
    // before the model is modified by pushEditOperations.
    const joinColumns = allCursors.map((c) => {
      if (c.position.column === 1 && c.position.lineNumber > 1) {
        return this._model.getLineContent(c.position.lineNumber - 1).length;
      }
      return undefined;
    });

    this._model.pushEditOperations(edits);

    // Update positions
    this._cursor.position = this._computeDeleteLeftPosition(
      allCursors[0].position,
      this._getSelectionOrNullFor(allCursors[0]),
      joinColumns[0],
    );
    this._cursor.selectionAnchor = this._cursor.position;
    this._cursor.goalColumn = this._cursor.position.column;
    for (let i = 1; i < allCursors.length; i++) {
      const c = this._secondaryCursors[i - 1];
      if (c) {
        c.position = this._computeDeleteLeftPosition(
          allCursors[i].position,
          this._getSelectionOrNullFor(allCursors[i]),
          joinColumns[i],
        );
        c.selectionAnchor = c.position;
      }
    }
    this._emit("edit");
  }

  deleteRight(): void {
    this._captureCursorState();
    const allCursors = this.getAllCursors();
    // Sort in reverse order (right-to-left) so earlier deletions don't shift later cursors
    const sortedCursors = [...allCursors].sort((a, b) => {
      if (a.position.lineNumber !== b.position.lineNumber) {
        return b.position.lineNumber - a.position.lineNumber;
      }
      return b.position.column - a.position.column;
    });
    const edits = sortedCursors.map((c) => {
      const sel = this._getSelectionOrNullFor(c);
      if (sel && isSelectionNonEmpty(sel)) {
        const range = selectionRange(sel);
        return { range, text: "" };
      }
      const lineLen = this._model.getLineContent(c.position.lineNumber).length;
      // Delete at end of line: delete the newline and join with next line
      if (c.position.column > lineLen && c.position.lineNumber < this._model.lineCount) {
        return {
          range: {
            startLineNumber: c.position.lineNumber,
            startColumn: lineLen + 1,
            endLineNumber: c.position.lineNumber + 1,
            endColumn: 1,
          },
          text: "",
        };
      }
      return {
        range: {
          startLineNumber: c.position.lineNumber,
          startColumn: c.position.column,
          endLineNumber: c.position.lineNumber,
          endColumn: Math.min(lineLen + 1, c.position.column + 1),
        },
        text: "",
      };
    });
    this._model.pushEditOperations(edits);

    this._cursor.position = { ...allCursors[0].position };
    this._cursor.selectionAnchor = this._cursor.position;
    this._cursor.goalColumn = this._cursor.position.column;
    for (let i = 1; i < allCursors.length; i++) {
      const c = this._secondaryCursors[i - 1];
      if (c) {
        c.position = { ...allCursors[i].position };
        c.selectionAnchor = c.position;
      }
    }
    this._emit("edit");
  }

  undo(): void {
    const result = this._model.undo();
    if (result && result.length > 0) {
      // First element is primary cursor
      const sel = result[0];
      this._cursor.position = { lineNumber: sel.positionLineNumber, column: sel.positionColumn };
      this._cursor.selectionAnchor = {
        lineNumber: sel.selectionStartLineNumber,
        column: sel.selectionStartColumn,
      };
      this._cursor.goalColumn = this._cursor.position.column;

      // Rest of elements are secondary cursors
      this._secondaryCursors = [];
      for (let i = 1; i < result.length; i++) {
        const s = result[i];
        this._secondaryCursors.push({
          position: { lineNumber: s.positionLineNumber, column: s.positionColumn },
          selectionAnchor: {
            lineNumber: s.selectionStartLineNumber,
            column: s.selectionStartColumn,
          },
          goalColumn: s.positionColumn,
        });
      }
      this._emit("undo");
    }
  }

  redo(): void {
    const result = this._model.redo();
    if (result && result.length > 0) {
      // First element is primary cursor
      const sel = result[0];
      this._cursor.position = { lineNumber: sel.positionLineNumber, column: sel.positionColumn };
      this._cursor.selectionAnchor = {
        lineNumber: sel.selectionStartLineNumber,
        column: sel.selectionStartColumn,
      };
      this._cursor.goalColumn = this._cursor.position.column;

      // Rest of elements are secondary cursors
      this._secondaryCursors = [];
      for (let i = 1; i < result.length; i++) {
        const s = result[i];
        this._secondaryCursors.push({
          position: { lineNumber: s.positionLineNumber, column: s.positionColumn },
          selectionAnchor: {
            lineNumber: s.selectionStartLineNumber,
            column: s.selectionStartColumn,
          },
          goalColumn: s.positionColumn,
        });
      }
      this._emit("redo");
    }
  }

  // ── Private ──

  private _setPosition(position: TextPosition): void {
    this._cursor.position = position;
    this._cursor.selectionAnchor = position;
    this._cursor.goalColumn = position.column;
    this._emit("position-changed");
  }

  private _moveSelectionTo(position: TextPosition): void {
    this._cursor.position = position;
    this._emit("selection-changed");
  }

  private _getSelectionOrNull(): TextSelection | null {
    const sel = this.selection;
    return isSelectionNonEmpty(sel) ? sel : null;
  }

  private _getSelectionOrNullFor(cursor: CursorState): TextSelection | null {
    if (
      cursor.position.lineNumber === cursor.selectionAnchor.lineNumber &&
      cursor.position.column === cursor.selectionAnchor.column
    )
      return null;
    return {
      selectionStartLineNumber: cursor.selectionAnchor.lineNumber,
      selectionStartColumn: cursor.selectionAnchor.column,
      positionLineNumber: cursor.position.lineNumber,
      positionColumn: cursor.position.column,
    };
  }

  private _applyToSecondaryCursors(fn: (cursor: CursorState) => void): void {
    if (this._secondaryCursors.length === 0) return;
    const sorted = [...this._secondaryCursors].sort((a, b) => {
      if (a.position.lineNumber !== b.position.lineNumber) {
        return b.position.lineNumber - a.position.lineNumber;
      }
      return b.position.column - a.position.column;
    });
    for (const cursor of sorted) fn(cursor);
  }

  /**
   * Apply computed positions to secondary cursors without emitting.
   * Used by selection methods to update all cursors before the event fires.
   */
  private _applySecondarySelectionPositions(
    positions: Array<{ index: CursorState; pos: TextPosition }>,
  ): void {
    for (const { index: c, pos } of positions) {
      c.position = pos;
    }
  }

  /**
   * Compute the new cursor position after inserting `text` at `range`.
   */
  private _computeNewPosition(
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    },
    text: string,
  ): TextPosition {
    if (text === "") {
      return { lineNumber: range.startLineNumber, column: range.startColumn };
    }
    if (text === "\n") {
      return { lineNumber: range.startLineNumber + 1, column: 1 };
    }
    const lines = text.split("\n");
    if (lines.length > 1) {
      return {
        lineNumber: range.startLineNumber + lines.length - 1,
        column: lines[lines.length - 1].length + 1,
      };
    }
    return {
      lineNumber: range.startLineNumber,
      column: range.startColumn + text.length,
    };
  }

  /**
   * Compute the new cursor position after a delete-left operation.
   */
  private _computeDeleteLeftPosition(
    cursor: TextPosition,
    selection: TextSelection | null,
    /** Pre-computed target column for the backspace-at-column-1 case,
     *  to avoid reading the model after edits have been applied. */
    joinColumn?: number,
  ): TextPosition {
    if (selection && isSelectionNonEmpty(selection)) {
      // Normalize: return the EARLIER position in file order (the start of
      // the deleted range), regardless of whether the user selected forward
      // or backward. Otherwise a backward selection (anchor after cursor)
      // would place the cursor at the anchor (later point) instead of at the
      // beginning of the deleted content.
      if (
        selection.selectionStartLineNumber < selection.positionLineNumber ||
        (selection.selectionStartLineNumber === selection.positionLineNumber &&
          selection.selectionStartColumn <= selection.positionColumn)
      ) {
        // Forward selection: anchor is before cursor
        return {
          lineNumber: selection.selectionStartLineNumber,
          column: selection.selectionStartColumn,
        };
      }
      // Reversed selection: cursor is before anchor
      return {
        lineNumber: selection.positionLineNumber,
        column: selection.positionColumn,
      };
    }
    // Backspace at column 1: move to end of previous line
    if (cursor.column === 1 && cursor.lineNumber > 1) {
      const prevLineLen = joinColumn ?? this._model.getLineContent(cursor.lineNumber - 1).length;
      return {
        lineNumber: cursor.lineNumber - 1,
        column: prevLineLen + 1,
      };
    }
    return {
      lineNumber: cursor.lineNumber,
      column: Math.max(1, cursor.column - 1),
    };
  }

  private _emit(type: CursorEvent["type"]): void {
    this._onDidChange?.({ type });
  }

  dispose(): void {
    this._onDidChange = null;
  }
}
