/* eslint-disable max-classes-per-file */
/**
 * PieceTreeTextContentModel — TextContentModel implementation backed by PieceTreeBase.
 *
 * This is the core editable text model for the file editor.
 * It wraps the piece tree data structure and provides the TextContentModel
 * contract (structurally matching the openp41ge package's TextContentModel).
 */

import { PieceTreeBase, StringBuffer, createLineStartsFast } from "openp41ge-core-piece-tree";
import { Emitter, type EventListener, type Disposable } from "./event-emitter";
import { TextChange } from "./text-change";
import { EditStack } from "./edit-stack";
import type { EditorTextSelection } from "./edit-stack";

// ─── Local types matching openp41ge's TextContentModel structurally ──────────

export interface TextPosition {
  readonly lineNumber: number;
  readonly column: number;
}

export interface TextRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export interface TextSelection {
  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;
}

export interface TextEditOperation {
  range: TextRange;
  text: string;
  forceMoveMarkers?: boolean;
  isAutoWhitespaceEdit?: boolean;
}

export interface TextContentChange {
  readonly range: TextRange;
  readonly rangeLength: number;
  readonly text: string;
  readonly rangeOffset: number;
}

export interface TextContentChangeEvent {
  readonly changes: TextContentChange[];
  readonly isUndoing: boolean;
  readonly isRedoing: boolean;
  readonly versionId: number;
}

export interface TextDecorationOptions {
  inlineClassName?: string;
  inlineClassNameAffectsCharacterSpacing?: boolean;
  lineClassName?: string;
  isWholeLine?: boolean;
  stickiness?: string;
  zIndex?: number;
}

export interface TextDecoration {
  readonly id: string;
  readonly range: TextRange;
  readonly options: TextDecorationOptions;
}

export interface ITextDecorationProvider {
  addDecoration(range: TextRange, options: TextDecorationOptions): string;
  removeDecoration(id: string): void;
  setDecorations(decorationId: string, range: TextRange, options: TextDecorationOptions): void;
  getDecorationsInRange(range: TextRange): TextDecoration[];
  getDecoration(id: string): TextDecoration | null;
  removeAllDecorations(): void;
}

export interface CursorStateComputer {
  (inverseEditOperations: TextEditOperation[]): TextSelection[];
}

// ─── Simple decoration provider ─────────────────────────────────────────

class PieceTreeDecorationProvider implements ITextDecorationProvider {
  private _decorations: Map<string, TextDecoration> = new Map();
  private _nextId = 1;

  addDecoration(range: TextRange, options: TextDecorationOptions): string {
    const id = `decoration_${this._nextId++}`;
    this._decorations.set(id, { id, range, options });
    return id;
  }

  removeDecoration(id: string): void {
    this._decorations.delete(id);
  }

  setDecorations(decorationId: string, range: TextRange, options: TextDecorationOptions): void {
    this._decorations.set(decorationId, { id: decorationId, range, options });
  }

  getDecorationsInRange(range: TextRange): TextDecoration[] {
    const result: TextDecoration[] = [];
    for (const decoration of this._decorations.values()) {
      if (this._rangesIntersect(decoration.range, range)) {
        result.push(decoration);
      }
    }
    return result;
  }

  getDecoration(id: string): TextDecoration | null {
    return this._decorations.get(id) ?? null;
  }

  removeAllDecorations(): void {
    this._decorations.clear();
  }

  private _rangesIntersect(a: TextRange, b: TextRange): boolean {
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
}

// ─── Production implementation ──────────────────────────────────────────

export type EOL = "\n" | "\r\n";

interface FileReadResult {
  data: string;
  totalSize: number;
}

/**
 * Options for creating a PieceTreeTextContentModel.
 */
export interface ModelOptions {
  /**
   * Optional file read function. If provided, the model will use it
   * for `pushEditOperations` persistence. If not provided, the model
   * is in-memory only.
   */
  fileReader?: {
    readRange(path: string, offset: number, length: number): Promise<FileReadResult>;
    writeFile(path: string, content: string): Promise<{ success: boolean }>;
  };
  /**
   * The line ending to use. Auto-detected from content if not set.
   */
  eol?: EOL;
}

export class PieceTreeTextContentModel {
  readonly uri: string;
  private _pieceTree: PieceTreeBase;
  private _eol: EOL = "\n";
  private _isDirty: boolean = false;
  private _versionId: number = 0;
  private _editStack: EditStack = new EditStack();
  private _pendingCursorState: EditorTextSelection[] | null = null;
  private _decorationProvider: PieceTreeDecorationProvider = new PieceTreeDecorationProvider();
  private _onDidChangeContent: Emitter<TextContentChangeEvent> = new Emitter();
  private _onDidChangeDirty: Emitter<boolean> = new Emitter();
  private _fileReader: ModelOptions["fileReader"];
  private _disposed: boolean = false;

  constructor(uri: string, content: string, options?: ModelOptions) {
    this.uri = uri;
    this._fileReader = options?.fileReader;

    // Detect EOL from content
    const crlfIndex = content.indexOf("\r\n");
    const lfIndex = content.indexOf("\n");
    if (crlfIndex >= 0 && (lfIndex < 0 || crlfIndex < lfIndex)) {
      this._eol = "\r\n";
    } else {
      this._eol = "\n";
    }
    if (options?.eol) {
      this._eol = options.eol;
    }

    // Normalize content to \n internally
    const normalized = content.replace(/\r\n/g, "\n");

    // Build piece tree
    const lineStarts = createLineStartsFast(normalized);
    const buffer = new StringBuffer(normalized, lineStarts);
    this._pieceTree = new PieceTreeBase([buffer], "\n", true);
  }

  // ─── Read-only properties ────────────────────────────────────────────

  get eol(): EOL {
    return this._eol;
  }

  get lineCount(): number {
    return this._pieceTree.getLineCount();
  }

  get length(): number {
    return this._pieceTree.getLength();
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  get versionId(): number {
    return this._versionId;
  }

  get alternativeVersionId(): number {
    return this._editStack.getAlternativeVersionId();
  }

  get decorationProvider(): ITextDecorationProvider {
    return this._decorationProvider;
  }

  // ─── Events ──────────────────────────────────────────────────────────

  get onDidChangeContent(): (listener: EventListener<TextContentChangeEvent>) => Disposable {
    return this._onDidChangeContent.event;
  }

  get onDidChangeDirty(): (listener: EventListener<boolean>) => Disposable {
    return this._onDidChangeDirty.event;
  }

  // ─── Reading ──────────────────────────────────────────────────────────

  getLineContent(lineNumber: number): string {
    return this._pieceTree.getLineContent(lineNumber);
  }

  getValueInRange(range: TextRange): string {
    return this._pieceTree.getValueInRange(
      range.startLineNumber,
      range.startColumn,
      range.endLineNumber,
      range.endColumn,
    );
  }

  getValue(): string {
    return this._pieceTree.getValue(this._eol);
  }

  getOffsetAt(position: TextPosition): number {
    return this._pieceTree.getOffsetAt(position.lineNumber, position.column);
  }

  getPositionAt(offset: number): TextPosition {
    return this._pieceTree.getPositionAt(offset);
  }

  getLineMinColumn(_lineNumber: number): number {
    return 1;
  }

  getLineMaxColumn(lineNumber: number): number {
    const line = this.getLineContent(lineNumber);
    return line.length + 1;
  }

  // ─── Writing ──────────────────────────────────────────────────────────

  /**
   * Set the cursor state before the next edit operation.
   * Consumed by pushEditOperations to record the pre-edit cursor position
   * in the undo stack, so undo can restore it.
   */
  setBeforeEditCursorState(states: TextSelection[] | null): void {
    if (!states || states.length === 0) {
      this._pendingCursorState = null;
      return;
    }
    this._pendingCursorState = states.map((state) => ({
      selectionStartLineNumber: state.selectionStartLineNumber,
      selectionStartColumn: state.selectionStartColumn,
      positionLineNumber: state.positionLineNumber,
      positionColumn: state.positionColumn,
    }));
  }

  pushEditOperations(
    edits: TextEditOperation[],
    cursorStateComputer?: CursorStateComputer | null,
  ): TextSelection[] | null {
    if (edits.length === 0) return null;

    // Consume the pending cursor state (set by cursor controller before edit)
    const beforeCursorState = this._pendingCursorState;
    this._pendingCursorState = null;

    const textChanges: TextChange[] = [];
    const beforeVersionId = this._versionId;

    // Apply each edit and collect text changes
    for (const edit of edits) {
      const { range, text } = edit;

      // Normalize text
      const normalizedText = text.replace(/\r\n/g, "\n");

      // Get the range boundaries in offsets
      const startOffset = this.getOffsetAt({
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      });
      const endOffset =
        range.endLineNumber >= 0
          ? this.getOffsetAt({
              lineNumber: range.endLineNumber,
              column: range.endColumn,
            })
          : startOffset;

      const rangeLength = endOffset - startOffset;
      const oldText = this.getValueInRange(range);

      // Perform the edit on the piece tree
      if (rangeLength > 0) {
        this._pieceTree.delete(startOffset, rangeLength);
      }
      if (normalizedText.length > 0) {
        this._pieceTree.insert(startOffset, normalizedText, true);
      }

      // Record the text change
      const textChange = new TextChange(startOffset, oldText, startOffset, normalizedText);
      textChanges.push(textChange);

      this._versionId++;
    }

    // Batch all changes into ONE undo stack element
    this._editStack.pushElement({
      changes: textChanges,
      beforeCursorState: beforeCursorState,
      afterCursorState: null,
      beforeEOL: this._eol,
      afterEOL: this._eol,
      beforeVersionId: beforeVersionId,
      afterVersionId: this._versionId,
    });

    // Mark dirty
    if (!this._isDirty) {
      this._isDirty = true;
      this._onDidChangeDirty.fire(true);
    }

    // Fire content change event
    const changes: TextContentChange[] = edits.map((edit) => ({
      range: {
        startLineNumber: edit.range.startLineNumber,
        startColumn: edit.range.startColumn,
        endLineNumber: edit.range.endLineNumber,
        endColumn: edit.range.endColumn,
      },
      rangeLength:
        edit.text.length > 0
          ? this.getOffsetAt({
              lineNumber: edit.range.endLineNumber,
              column: edit.range.endColumn,
            }) -
            this.getOffsetAt({
              lineNumber: edit.range.startLineNumber,
              column: edit.range.startColumn,
            })
          : 0,
      text: edit.text,
      rangeOffset: this.getOffsetAt({
        lineNumber: edit.range.startLineNumber,
        column: edit.range.startColumn,
      }),
    }));

    this._onDidChangeContent.fire({
      changes,
      isUndoing: false,
      isRedoing: false,
      versionId: this._versionId,
    });

    // Compute cursor state
    if (cursorStateComputer) {
      const inverseEdits: TextEditOperation[] = edits.map((edit) => ({
        range: {
          startLineNumber: edit.range.startLineNumber,
          startColumn: edit.range.startColumn,
          endLineNumber: edit.range.endLineNumber,
          endColumn: edit.range.endColumn,
        },
        text: this.getValueInRange({
          startLineNumber: edit.range.startLineNumber,
          startColumn: edit.range.startColumn,
          endLineNumber: edit.range.endLineNumber,
          endColumn: edit.range.endColumn,
        }),
      }));
      return cursorStateComputer(inverseEdits);
    }

    return null;
  }

  setValue(newValue: string): void {
    const normalized = newValue.replace(/\r\n/g, "\n");
    const lineStarts = createLineStartsFast(normalized);
    const buffer = new StringBuffer(normalized, lineStarts);
    this._pieceTree = new PieceTreeBase([buffer], "\n", true);
    this._editStack.clear();
    this._versionId++;

    if (!this._isDirty) {
      this._isDirty = true;
      this._onDidChangeDirty.fire(true);
    }

    this._onDidChangeContent.fire({
      changes: [
        {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: this.lineCount,
            endColumn: 1,
          },
          rangeLength: 0,
          text: newValue,
          rangeOffset: 0,
        },
      ],
      isUndoing: false,
      isRedoing: false,
      versionId: this._versionId,
    });
  }

  markClean(): void {
    if (this._isDirty) {
      this._isDirty = false;
      this._onDidChangeDirty.fire(false);
    }
  }

  // ─── Undo / Redo ─────────────────────────────────────────────────────

  canUndo(): boolean {
    return this._editStack.canUndo;
  }

  canRedo(): boolean {
    return this._editStack.canRedo;
  }

  undo(): TextSelection[] | null {
    const element = this._editStack.popUndo();
    if (!element) return null;

    // Apply reverse changes
    for (let i = element.changes.length - 1; i >= 0; i--) {
      const change = element.changes[i];
      // Delete what was inserted
      if (change.modifiedText.length > 0) {
        this._pieceTree.delete(change.modifiedOffset, change.modifiedText.length);
      }
      // Re-insert what was deleted
      if (change.originalText.length > 0) {
        this._pieceTree.insert(change.originalOffset, change.originalText, true);
      }
    }

    this._versionId = element.beforeVersionId;

    this._onDidChangeContent.fire({
      changes: element.changes.map((c) => {
        // After undo, the document is in the pre-edit state.
        // c.originalOffset is the position in the current document
        // and c.originalText was restored at that position.
        const startPos = this.getPositionAt(c.originalOffset);
        const endPos = this.getPositionAt(c.originalOffset + c.originalText.length);
        return {
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
          rangeLength: c.modifiedText.length,
          text: c.originalText,
          rangeOffset: c.originalOffset,
        };
      }),
      isUndoing: true,
      isRedoing: false,
      versionId: this._versionId,
    });

    return element.beforeCursorState as unknown as TextSelection[] | null;
  }

  redo(): TextSelection[] | null {
    const element = this._editStack.popRedo();
    if (!element) return null;

    // Apply forward changes
    for (const change of element.changes) {
      if (change.originalText.length > 0) {
        this._pieceTree.delete(change.originalOffset, change.originalText.length);
      }
      if (change.modifiedText.length > 0) {
        this._pieceTree.insert(change.modifiedOffset, change.modifiedText, true);
      }
    }

    this._versionId = element.afterVersionId;

    this._onDidChangeContent.fire({
      changes: element.changes.map((c) => {
        // After redo, the document is in the post-edit state.
        // c.modifiedOffset is the position in the current document
        // and c.modifiedText was restored at that position.
        const startPos = this.getPositionAt(c.modifiedOffset);
        const endPos = this.getPositionAt(c.modifiedOffset + c.modifiedText.length);
        return {
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
          rangeLength: c.originalText.length,
          text: c.modifiedText,
          rangeOffset: c.modifiedOffset,
        };
      }),
      isUndoing: false,
      isRedoing: true,
      versionId: this._versionId,
    });

    return element.afterCursorState as unknown as TextSelection[] | null;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._onDidChangeContent.dispose();
    this._onDidChangeDirty.dispose();
    this._decorationProvider.removeAllDecorations();
    this._editStack.clear();
  }
}
