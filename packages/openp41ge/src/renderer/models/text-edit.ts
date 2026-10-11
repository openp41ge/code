/**
 * Edit operation types for TextContentModel.
 */

import type { ITextRange } from "./text-model";

/**
 * A single edit operation — replace the content in `range` with `text`.
 */
export interface TextEditOperation {
  /** The range of text to replace. If empty, this is an insertion. */
  range: ITextRange;
  /** The text to insert. If empty, this is a deletion. */
  text: string;
  /**
   * If true, markers (decorations) at the edges of this range will be
   * forced to move even if their stickiness would normally keep them in place.
   */
  forceMoveMarkers?: boolean;
  /**
   * If true, this edit is auto-generated whitespace (e.g., auto-indent)
   * and can be trimmed on subsequent edits.
   */
  isAutoWhitespaceEdit?: boolean;
}

/**
 * An edit operation with a unique identifier for tracking.
 */
export interface IIdentifiedSingleEditOperation extends TextEditOperation {
  identifier?: string | null;
}

/**
 * A validated edit operation with pre-computed offsets.
 */
export interface IValidatedEditOperation {
  sortIndex: number;
  identifier: string | null;
  range: ITextRange;
  rangeOffset: number;
  rangeLength: number;
  text: string;
  eolCount: number;
  firstLineLength: number;
  lastLineLength: number;
  forceMoveMarkers: boolean;
  isAutoWhitespaceEdit: boolean;
}
