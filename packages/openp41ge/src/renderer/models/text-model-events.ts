/**
 * Events emitted by TextContentModel when content changes.
 */

import type { ITextRange } from "./text-model";

/**
 * Describes a single contiguous region of text that changed.
 */
export interface TextContentChange {
  /** The range in the original document that was replaced. */
  readonly range: ITextRange;
  /** The length (in characters) of the original text that was replaced. */
  readonly rangeLength: number;
  /** The text that was inserted (may be empty for deletions). */
  readonly text: string;
  /** The character offset of the start of the range. */
  readonly rangeOffset: number;
}

/**
 * Event payload emitted when the model's content changes.
 */
export interface TextContentChangeEvent {
  /** The individual changes that make up this edit. */
  readonly changes: TextContentChange[];
  /** Whether this change is the result of an undo operation. */
  readonly isUndoing: boolean;
  /** Whether this change is the result of a redo operation. */
  readonly isRedoing: boolean;
  /** The new version ID after applying the changes. */
  readonly versionId: number;
}

/**
 * Event payload emitted when the model's EOL sequence changes.
 */
export interface TextEOLChangeEvent {
  readonly eol: "\n" | "\r\n";
}

/**
 * Event payload emitted when the model's decorations change.
 */
export interface TextDecorationChangeEvent {
  readonly decorationIds: string[];
}
