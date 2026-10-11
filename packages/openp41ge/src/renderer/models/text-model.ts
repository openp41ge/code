/* eslint-disable max-classes-per-file */
/**
 * Core text model value types — Position, Range, Selection.
 *
 * Immutable classes mirroring Monaco's editor common types.
 * Line numbers and columns are 1-based.
 */

// ─── TextPosition ─────────────────────────────────────────────────────────

export interface ITextPosition {
  readonly lineNumber: number;
  readonly column: number;
}

export class TextPosition {
  constructor(
    readonly lineNumber: number,
    readonly column: number,
  ) {}

  with(newLineNumber: number = this.lineNumber, newColumn: number = this.column): TextPosition {
    if (newLineNumber === this.lineNumber && newColumn === this.column) return this;
    return new TextPosition(newLineNumber, newColumn);
  }

  delta(deltaLine: number = 0, deltaColumn: number = 0): TextPosition {
    return this.with(
      Math.max(1, this.lineNumber + deltaLine),
      Math.max(1, this.column + deltaColumn),
    );
  }

  equals(other: ITextPosition): boolean {
    return TextPosition.equals(this, other);
  }

  isBefore(other: ITextPosition): boolean {
    return TextPosition.isBefore(this, other);
  }

  isBeforeOrEqual(other: ITextPosition): boolean {
    return TextPosition.isBeforeOrEqual(this, other);
  }

  compareTo(other: ITextPosition): number {
    return TextPosition.compare(this, other);
  }

  clone(): TextPosition {
    return new TextPosition(this.lineNumber, this.column);
  }

  toJSON(): ITextPosition {
    return { lineNumber: this.lineNumber, column: this.column };
  }

  toString(): string {
    return `(${this.lineNumber},${this.column})`;
  }

  // ── Static ──

  static equals(a: ITextPosition | null, b: ITextPosition | null): boolean {
    if (!a && !b) return true;
    return !!a && !!b && a.lineNumber === b.lineNumber && a.column === b.column;
  }

  static isBefore(a: ITextPosition, b: ITextPosition): boolean {
    if (a.lineNumber < b.lineNumber) return true;
    if (b.lineNumber < a.lineNumber) return false;
    return a.column < b.column;
  }

  static isBeforeOrEqual(a: ITextPosition, b: ITextPosition): boolean {
    if (a.lineNumber < b.lineNumber) return true;
    if (b.lineNumber < a.lineNumber) return false;
    return a.column <= b.column;
  }

  static compare(a: ITextPosition, b: ITextPosition): number {
    const lineDiff = a.lineNumber - b.lineNumber;
    if (lineDiff !== 0) return lineDiff;
    return a.column - b.column;
  }

  static isIPosition(obj: unknown): obj is ITextPosition {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as ITextPosition).lineNumber === "number" &&
      typeof (obj as ITextPosition).column === "number"
    );
  }

  static lift(pos: ITextPosition): TextPosition {
    return new TextPosition(pos.lineNumber, pos.column);
  }

  static readonly MIN = new TextPosition(1, 1);
}

// ─── TextRange ─────────────────────────────────────────────────────────────

export interface ITextRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export class TextRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;

  constructor(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) {
    // Normalise: ensure start <= end
    if (
      startLineNumber > endLineNumber ||
      (startLineNumber === endLineNumber && startColumn > endColumn)
    ) {
      this.startLineNumber = endLineNumber;
      this.startColumn = endColumn;
      this.endLineNumber = startLineNumber;
      this.endColumn = startColumn;
    } else {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  }

  isEmpty(): boolean {
    return TextRange.isEmpty(this);
  }

  containsPosition(position: ITextPosition): boolean {
    return TextRange.containsPosition(this, position);
  }

  containsRange(range: ITextRange): boolean {
    return TextRange.containsRange(this, range);
  }

  intersects(other: ITextRange): boolean {
    return TextRange.areIntersecting(this, other);
  }

  plusRange(range: ITextRange): TextRange {
    return TextRange.plusRange(this, range);
  }

  intersectRanges(range: ITextRange): TextRange | null {
    return TextRange.intersectRanges(this, range);
  }

  equalsRange(other: ITextRange | null | undefined): boolean {
    return TextRange.equalsRange(this, other);
  }

  getStartPosition(): TextPosition {
    return new TextPosition(this.startLineNumber, this.startColumn);
  }

  getEndPosition(): TextPosition {
    return new TextPosition(this.endLineNumber, this.endColumn);
  }

  setEndPosition(endLineNumber: number, endColumn: number): TextRange {
    return new TextRange(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
  }

  setStartPosition(startLineNumber: number, startColumn: number): TextRange {
    return new TextRange(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
  }

  collapseToStart(): TextRange {
    return TextRange.collapseToStart(this);
  }

  collapseToEnd(): TextRange {
    return TextRange.collapseToEnd(this);
  }

  isSingleLine(): boolean {
    return this.startLineNumber === this.endLineNumber;
  }

  delta(lineCount: number): TextRange {
    return new TextRange(
      this.startLineNumber + lineCount,
      this.startColumn,
      this.endLineNumber + lineCount,
      this.endColumn,
    );
  }

  toJSON(): ITextRange {
    return {
      startLineNumber: this.startLineNumber,
      startColumn: this.startColumn,
      endLineNumber: this.endLineNumber,
      endColumn: this.endColumn,
    };
  }

  toString(): string {
    return `[${this.startLineNumber},${this.startColumn} -> ${this.endLineNumber},${this.endColumn}]`;
  }

  // ── Static ──

  static isEmpty(range: ITextRange): boolean {
    return range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
  }

  static containsPosition(range: ITextRange, position: ITextPosition): boolean {
    if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber)
      return false;
    if (position.lineNumber === range.startLineNumber && position.column < range.startColumn)
      return false;
    if (position.lineNumber === range.endLineNumber && position.column > range.endColumn)
      return false;
    return true;
  }

  static containsRange(range: ITextRange, otherRange: ITextRange): boolean {
    if (
      otherRange.startLineNumber < range.startLineNumber ||
      otherRange.endLineNumber < range.startLineNumber
    )
      return false;
    if (
      otherRange.startLineNumber > range.endLineNumber ||
      otherRange.endLineNumber > range.endLineNumber
    )
      return false;
    if (
      otherRange.startLineNumber === range.startLineNumber &&
      otherRange.startColumn < range.startColumn
    )
      return false;
    if (otherRange.endLineNumber === range.endLineNumber && otherRange.endColumn > range.endColumn)
      return false;
    return true;
  }

  static areIntersecting(a: ITextRange, b: ITextRange): boolean {
    if (
      a.endLineNumber < b.startLineNumber ||
      (a.endLineNumber === b.startLineNumber && a.endColumn <= b.startColumn)
    )
      return false;
    if (
      b.endLineNumber < a.startLineNumber ||
      (b.endLineNumber === a.startLineNumber && b.endColumn <= a.startColumn)
    )
      return false;
    return true;
  }

  static plusRange(a: ITextRange, b: ITextRange): TextRange {
    const startLine =
      b.startLineNumber < a.startLineNumber
        ? b.startLineNumber
        : b.startLineNumber === a.startLineNumber
          ? b.startLineNumber
          : a.startLineNumber;
    const startCol =
      b.startLineNumber < a.startLineNumber
        ? b.startColumn
        : b.startLineNumber === a.startLineNumber
          ? Math.min(b.startColumn, a.startColumn)
          : a.startColumn;
    const endLine =
      b.endLineNumber > a.endLineNumber
        ? b.endLineNumber
        : b.endLineNumber === a.endLineNumber
          ? b.endLineNumber
          : a.endLineNumber;
    const endCol =
      b.endLineNumber > a.endLineNumber
        ? b.endColumn
        : b.endLineNumber === a.endLineNumber
          ? Math.max(b.endColumn, a.endColumn)
          : a.endColumn;
    return new TextRange(startLine, startCol, endLine, endCol);
  }

  static intersectRanges(a: ITextRange, b: ITextRange): TextRange | null {
    let resultStartLine = a.startLineNumber;
    let resultStartCol = a.startColumn;
    let resultEndLine = a.endLineNumber;
    let resultEndCol = a.endColumn;

    if (resultStartLine < b.startLineNumber) {
      resultStartLine = b.startLineNumber;
      resultStartCol = b.startColumn;
    } else if (resultStartLine === b.startLineNumber) {
      resultStartCol = Math.max(resultStartCol, b.startColumn);
    }
    if (resultEndLine > b.endLineNumber) {
      resultEndLine = b.endLineNumber;
      resultEndCol = b.endColumn;
    } else if (resultEndLine === b.endLineNumber) {
      resultEndCol = Math.min(resultEndCol, b.endColumn);
    }

    if (resultStartLine > resultEndLine) return null;
    if (resultStartLine === resultEndLine && resultStartCol > resultEndCol) return null;
    return new TextRange(resultStartLine, resultStartCol, resultEndLine, resultEndCol);
  }

  static equalsRange(a: ITextRange | null | undefined, b: ITextRange | null | undefined): boolean {
    if (!a && !b) return true;
    return (
      !!a &&
      !!b &&
      a.startLineNumber === b.startLineNumber &&
      a.startColumn === b.startColumn &&
      a.endLineNumber === b.endLineNumber &&
      a.endColumn === b.endColumn
    );
  }

  static collapseToStart(range: ITextRange): TextRange {
    return new TextRange(
      range.startLineNumber,
      range.startColumn,
      range.startLineNumber,
      range.startColumn,
    );
  }

  static collapseToEnd(range: ITextRange): TextRange {
    return new TextRange(
      range.endLineNumber,
      range.endColumn,
      range.endLineNumber,
      range.endColumn,
    );
  }

  static fromPositions(start: ITextPosition, end: ITextPosition = start): TextRange {
    return new TextRange(start.lineNumber, start.column, end.lineNumber, end.column);
  }

  static isIRange(obj: unknown): obj is ITextRange {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as ITextRange).startLineNumber === "number" &&
      typeof (obj as ITextRange).startColumn === "number" &&
      typeof (obj as ITextRange).endLineNumber === "number" &&
      typeof (obj as ITextRange).endColumn === "number"
    );
  }

  static lift(range: ITextRange): TextRange {
    return new TextRange(
      range.startLineNumber,
      range.startColumn,
      range.endLineNumber,
      range.endColumn,
    );
  }
}

// ─── TextSelection ─────────────────────────────────────────────────────────

export interface ITextSelection extends ITextRange {
  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;
}

export type SelectionDirection = "ltr" | "rtl";

export class TextSelection extends TextRange {
  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;

  constructor(
    selectionStartLineNumber: number,
    selectionStartColumn: number,
    positionLineNumber: number,
    positionColumn: number,
  ) {
    super(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn);
    this.selectionStartLineNumber = selectionStartLineNumber;
    this.selectionStartColumn = selectionStartColumn;
    this.positionLineNumber = positionLineNumber;
    this.positionColumn = positionColumn;
  }

  getDirection(): SelectionDirection {
    if (
      this.selectionStartLineNumber === this.startLineNumber &&
      this.selectionStartColumn === this.startColumn
    ) {
      return "ltr";
    }
    return "rtl";
  }

  getPosition(): TextPosition {
    return new TextPosition(this.positionLineNumber, this.positionColumn);
  }

  getSelectionStart(): TextPosition {
    return new TextPosition(this.selectionStartLineNumber, this.selectionStartColumn);
  }

  equalsSelection(other: ITextSelection): boolean {
    return TextSelection.selectionsEqual(this, other);
  }

  setEndPosition(endLineNumber: number, endColumn: number): TextSelection {
    if (this.getDirection() === "ltr") {
      return new TextSelection(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
    }
    return new TextSelection(endLineNumber, endColumn, this.startLineNumber, this.startColumn);
  }

  setStartPosition(startLineNumber: number, startColumn: number): TextSelection {
    if (this.getDirection() === "ltr") {
      return new TextSelection(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
    }
    return new TextSelection(this.endLineNumber, this.endColumn, startLineNumber, startColumn);
  }

  toJSON(): ITextSelection {
    return {
      startLineNumber: this.startLineNumber,
      startColumn: this.startColumn,
      endLineNumber: this.endLineNumber,
      endColumn: this.endColumn,
      selectionStartLineNumber: this.selectionStartLineNumber,
      selectionStartColumn: this.selectionStartColumn,
      positionLineNumber: this.positionLineNumber,
      positionColumn: this.positionColumn,
    };
  }

  override toString(): string {
    return `[${this.selectionStartLineNumber},${this.selectionStartColumn} -> ${this.positionLineNumber},${this.positionColumn}]`;
  }

  // ── Static ──

  static selectionsEqual(a: ITextSelection, b: ITextSelection): boolean {
    return (
      a.selectionStartLineNumber === b.selectionStartLineNumber &&
      a.selectionStartColumn === b.selectionStartColumn &&
      a.positionLineNumber === b.positionLineNumber &&
      a.positionColumn === b.positionColumn
    );
  }

  static fromPositions(start: ITextPosition, end: ITextPosition = start): TextSelection {
    return new TextSelection(start.lineNumber, start.column, end.lineNumber, end.column);
  }

  static fromRange(range: TextRange, direction: SelectionDirection): TextSelection {
    if (direction === "ltr") {
      return new TextSelection(
        range.startLineNumber,
        range.startColumn,
        range.endLineNumber,
        range.endColumn,
      );
    }
    return new TextSelection(
      range.endLineNumber,
      range.endColumn,
      range.startLineNumber,
      range.startColumn,
    );
  }

  static liftSelection(sel: ITextSelection): TextSelection {
    return new TextSelection(
      sel.selectionStartLineNumber,
      sel.selectionStartColumn,
      sel.positionLineNumber,
      sel.positionColumn,
    );
  }

  static isISelection(obj: unknown): obj is ITextSelection {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as ITextSelection).selectionStartLineNumber === "number" &&
      typeof (obj as ITextSelection).selectionStartColumn === "number" &&
      typeof (obj as ITextSelection).positionLineNumber === "number" &&
      typeof (obj as ITextSelection).positionColumn === "number"
    );
  }

  static createWithDirection(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
    direction: SelectionDirection,
  ): TextSelection {
    if (direction === "ltr") {
      return new TextSelection(startLineNumber, startColumn, endLineNumber, endColumn);
    }
    return new TextSelection(endLineNumber, endColumn, startLineNumber, startColumn);
  }
}
