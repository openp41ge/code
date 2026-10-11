/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-classes-per-file */
/**
 * TestTextContentModel — in-memory TextContentModel for tests.
 *
 * Uses a simple string buffer (not piece tree) to avoid dependency on
 * the openp41ge-file-editor package in test scenarios. For unit tests of the
 * piece tree itself, use PieceTreeTextContentModel directly.
 */

import type { TextPosition, TextRange, TextSelection } from "./text-model";
import type { TextEditOperation } from "./text-edit";
import type { TextContentChangeEvent } from "./text-model-events";
import type { ITextDecorationProvider } from "./text-decoration-provider";

type EventListener<T> = (event: T) => void;
type Disposable = { dispose(): void };
type CursorStateComputer = (inverseEditOperations: TextEditOperation[]) => TextSelection[];

/**
 * Simple in-memory decoration provider for testing.
 */
class TestDecorationProvider implements ITextDecorationProvider {
  private _decorations: Map<string, { range: TextRange; options: any }> = new Map();
  private _nextId = 1;

  addDecoration(range: TextRange, options: any): string {
    const id = `test-decoration-${this._nextId++}`;
    this._decorations.set(id, { range, options });
    return id;
  }

  removeDecoration(id: string): void {
    this._decorations.delete(id);
  }

  setDecorations(decorationId: string, range: TextRange, options: any): void {
    this._decorations.set(decorationId, { range, options });
  }

  getDecorationsInRange(_range: TextRange): any[] {
    return Array.from(this._decorations.values());
  }

  getDecoration(id: string): any | null {
    return this._decorations.get(id) ?? null;
  }

  removeAllDecorations(): void {
    this._decorations.clear();
  }
}

export class TestTextContentModel {
  readonly uri: string;
  private _content: string;
  private _eol: "\n" | "\r\n" = "\n";
  private _isDirty: boolean = false;
  private _versionId: number = 0;
  private _undoStack: Array<{ content: string; cursor: TextSelection[] | null }> = [];
  private _redoStack: Array<{ content: string; cursor: TextSelection[] | null }> = [];
  private _decorationProvider: TestDecorationProvider = new TestDecorationProvider();
  private _contentListeners: Array<EventListener<TextContentChangeEvent>> = [];
  private _dirtyListeners: Array<EventListener<boolean>> = [];

  constructor(uri: string, content: string = "") {
    this.uri = uri;
    this._content = content;
    if (content.includes("\r\n")) this._eol = "\r\n";
  }

  get eol(): "\n" | "\r\n" {
    return this._eol;
  }
  get lineCount(): number {
    return this._content.split("\n").length;
  }
  get length(): number {
    return this._content.length;
  }
  get isDirty(): boolean {
    return this._isDirty;
  }
  get versionId(): number {
    return this._versionId;
  }
  get alternativeVersionId(): number {
    return this._versionId;
  }
  get decorationProvider(): ITextDecorationProvider {
    return this._decorationProvider;
  }

  get onDidChangeContent(): (listener: EventListener<TextContentChangeEvent>) => Disposable {
    return (listener: EventListener<TextContentChangeEvent>) => {
      this._contentListeners.push(listener);
      return {
        dispose: () => {
          this._contentListeners = this._contentListeners.filter((l) => l !== listener);
        },
      };
    };
  }

  get onDidChangeDirty(): (listener: EventListener<boolean>) => Disposable {
    return (listener: EventListener<boolean>) => {
      this._dirtyListeners.push(listener);
      return {
        dispose: () => {
          this._dirtyListeners = this._dirtyListeners.filter((l) => l !== listener);
        },
      };
    };
  }

  getLineContent(lineNumber: number): string {
    const lines = this._content.split("\n");
    if (lineNumber < 1 || lineNumber > lines.length) return "";
    return lines[lineNumber - 1];
  }

  getValueInRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): string {
    const lines = this._content.split("\n");
    if (range.startLineNumber === range.endLineNumber) {
      return lines[range.startLineNumber - 1].substring(range.startColumn - 1, range.endColumn - 1);
    }
    const parts: string[] = [];
    for (let i = range.startLineNumber; i <= range.endLineNumber; i++) {
      if (i === range.startLineNumber) {
        parts.push(lines[i - 1].substring(range.startColumn - 1));
      } else if (i === range.endLineNumber) {
        parts.push(lines[i - 1].substring(0, range.endColumn - 1));
      } else {
        parts.push(lines[i - 1]);
      }
    }
    return parts.join("\n");
  }

  getValue(): string {
    return this._content;
  }

  getOffsetAt(position: { lineNumber: number; column: number }): number {
    const lines = this._content.split("\n");
    let offset = 0;
    for (let i = 1; i < position.lineNumber && i <= lines.length; i++) {
      offset += lines[i - 1].length + 1; // +1 for \n
    }
    return offset + (position.column - 1);
  }

  getPositionAt(offset: number): TextPosition {
    const text = this._content;
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { lineNumber: line, column: col } as TextPosition;
  }

  getLineMinColumn(): number {
    return 1;
  }

  getLineMaxColumn(lineNumber: number): number {
    return this.getLineContent(lineNumber).length + 1;
  }

  pushEditOperations(
    edits: TextEditOperation[],
    cursorStateComputer?: CursorStateComputer | null,
  ): TextSelection[] | null {
    // Save undo state before edits
    this._undoStack.push({ content: this._content, cursor: null });
    this._redoStack = [];

    for (const edit of edits) {
      const { range, text } = edit;
      const startOffset = this.getOffsetAt({
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      });
      const endOffset = this.getOffsetAt({
        lineNumber: range.endLineNumber,
        column: range.endColumn,
      });
      const before = this._content.substring(0, startOffset);
      const after = this._content.substring(endOffset);
      this._content = before + text + after;
    }

    this._versionId++;
    this._isDirty = true;
    this._dirtyListeners.forEach((l) => l(true));

    this._contentListeners.forEach((l) =>
      l({
        changes: edits.map((e) => ({
          range: {
            startLineNumber: e.range.startLineNumber,
            startColumn: e.range.startColumn,
            endLineNumber: e.range.endLineNumber,
            endColumn: e.range.endColumn,
          },
          rangeLength: e.text.length,
          text: e.text,
          rangeOffset: this.getOffsetAt({
            lineNumber: e.range.startLineNumber,
            column: e.range.startColumn,
          }),
        })),
        isUndoing: false,
        isRedoing: false,
        versionId: this._versionId,
      }),
    );

    if (cursorStateComputer) {
      const inverseEdits: TextEditOperation[] = edits.map((e) => ({
        range: {
          startLineNumber: e.range.startLineNumber,
          startColumn: e.range.startColumn,
          endLineNumber: e.range.endLineNumber,
          endColumn: e.range.endColumn,
        },
        text: this.getValueInRange(e.range),
      }));
      return cursorStateComputer(inverseEdits);
    }

    return null;
  }

  setValue(newValue: string): void {
    this._undoStack.push({ content: this._content, cursor: null });
    this._redoStack = [];
    this._content = newValue;
    this._versionId++;
    this._isDirty = true;
    this._dirtyListeners.forEach((l) => l(true));
    this._contentListeners.forEach((l) =>
      l({
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
      }),
    );
  }

  markClean(): void {
    this._isDirty = false;
    this._dirtyListeners.forEach((l) => l(false));
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }
  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  undo(): TextSelection[] | null {
    if (this._undoStack.length === 0) return null;
    this._redoStack.push({ content: this._content, cursor: null });
    const state = this._undoStack.pop()!;
    this._content = state.content;
    this._versionId++;
    this._contentListeners.forEach((l) =>
      l({
        changes: [],
        isUndoing: true,
        isRedoing: false,
        versionId: this._versionId,
      }),
    );
    return state.cursor;
  }

  redo(): TextSelection[] | null {
    if (this._redoStack.length === 0) return null;
    this._undoStack.push({ content: this._content, cursor: null });
    const state = this._redoStack.pop()!;
    this._content = state.content;
    this._versionId++;
    this._contentListeners.forEach((l) =>
      l({
        changes: [],
        isUndoing: false,
        isRedoing: true,
        versionId: this._versionId,
      }),
    );
    return state.cursor;
  }

  dispose(): void {
    this._contentListeners = [];
    this._dirtyListeners = [];
    this._undoStack = [];
    this._redoStack = [];
  }
}
