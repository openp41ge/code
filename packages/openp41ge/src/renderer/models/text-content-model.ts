/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * TextContentModel — the core abstraction for editable text content.
 *
 * This is a shared platform resource owned by the openp41ge package.
 * The file-editor package loads a model but doesn't create it.
 * Other packages (git diff, chat agent) also use models for the same file.
 */

import type {
  ITextPosition,
  ITextRange,
  ITextSelection,
  TextPosition,
  TextRange,
  TextSelection,
} from "./text-model";
import type { TextEditOperation } from "./text-edit";
import type { TextContentChangeEvent } from "./text-model-events";
import type { ITextDecorationProvider } from "./text-decoration-provider";

/**
 * Event listener type used by TextContentModel.
 */
export type EventListener<T> = (event: T) => void;

/**
 * Unsubscribe function returned by `onDidChangeContent`.
 */
export type Disposable = { dispose(): void };

/**
 * The state machine result of a cursor state computer.
 */
export type CursorStateComputer = (inverseEditOperations: TextEditOperation[]) => TextSelection[];

/**
 * TextContentModel — represents a text document that can be edited.
 *
 * Multiple views (tabs) can share the same model instance.
 * All edits go through `pushEditOperations()` which validates,
 * applies to the piece tree, records undo deltas, and emits events.
 */
export interface TextContentModel {
  /** Unique URI/path for this model (typically the file path). */
  readonly uri: string;

  /** The line ending sequence used by this model. */
  readonly eol: "\n" | "\r\n";

  /** Total number of lines (1-based, so empty document has 1 line). */
  readonly lineCount: number;

  /** Total character count (including line endings stored as single \n internally). */
  readonly length: number;

  /** Whether the content has been modified since the last save. */
  readonly isDirty: boolean;

  /** The current version ID (increments on every edit). */
  readonly versionId: number;

  /** The version ID used by the undo stack's top element. */
  readonly alternativeVersionId: number;

  // ── Reading ──

  /** Get the full text content of a single line (excluding the line ending). */
  getLineContent(lineNumber: number): string;

  /** Get the text content of a range. */
  getValueInRange(range: ITextRange): string;

  /** Get the full text content. */
  getValue(): string;

  /** Convert a line/column position to a character offset (0-based). */
  getOffsetAt(position: ITextPosition): number;

  /** Convert a character offset to a line/column position. */
  getPositionAt(offset: number): TextPosition;

  /** Get the minimum valid column for a line. Always 1. */
  getLineMinColumn(lineNumber: number): number;

  /** Get the maximum valid column for a line (length + 1). */
  getLineMaxColumn(lineNumber: number): number;

  // ── Writing ──

  /**
   * Apply edit operations to the model.
   *
   * @param edits The edits to apply (validated internally).
   * @param cursorStateComputer Optional function that receives the inverse
   *   edits (for undo) and returns the new cursor state.
   * @returns The new selections computed by cursorStateComputer, or null.
   */
  pushEditOperations(
    edits: TextEditOperation[],
    cursorStateComputer?: CursorStateComputer | null,
  ): TextSelection[] | null;

  /**
   * Replace the entire document content.
   */
  setValue(newValue: string): void;

  /**
   * Mark the model as clean (saved).
   */
  markClean(): void;

  // ── Undo / Redo ──

  canUndo(): boolean;
  canRedo(): boolean;
  undo(): TextSelection[] | null;
  redo(): TextSelection[] | null;

  // ── Events ──

  /** Fired when content changes. */
  onDidChangeContent(listener: EventListener<TextContentChangeEvent>): Disposable;

  /** Fired when dirty state changes. */
  onDidChangeDirty(listener: EventListener<boolean>): Disposable;

  // ── Decorations ──

  readonly decorationProvider: ITextDecorationProvider;

  // ── Lifecycle ──

  dispose(): void;
}
