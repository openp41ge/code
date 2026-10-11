/**
 * Decoration types for TextContentModel.
 *
 * Decorations are visual markers attached to ranges of text — they
 * survive edits based on their stickiness and are used for syntax
 * highlighting, find results, selection rendering, etc.
 */

import type { TextRange } from "./text-model";

export type TrackedRangeStickiness =
  /** The range grows and shrinks as typing occurs at its edges. */
  | "alwaysGrowsWhenTypingAtEdges"
  /** The range never grows when typing at its edges. */
  | "neverGrowsWhenTypingAtEdges"
  /** The range grows only when typing before its start. */
  | "growsOnlyWhenTypingBefore"
  /** The range grows only when typing after its end. */
  | "growsOnlyWhenTypingAfter";

export interface TextDecorationOptions {
  /** CSS class name applied to the decorated text inline. */
  inlineClassName?: string;
  /** Whether the inline class affects character spacing (e.g., font-weight). */
  inlineClassNameAffectsCharacterSpacing?: boolean;
  /** CSS class applied to the entire line. */
  lineClassName?: string;
  /** If true, the decoration covers the entire line, not just the range. */
  isWholeLine?: boolean;
  /** How the decoration behaves when text is inserted at its edges. */
  stickiness?: TrackedRangeStickiness;
  /** Z-index for layering multiple decorations. */
  zIndex?: number;
}

export interface TextDecoration {
  readonly id: string;
  readonly range: TextRange;
  readonly options: TextDecorationOptions;
}

/**
 * Provides and manages decorations for a TextContentModel.
 */
export interface ITextDecorationProvider {
  /** Add a decoration and return its unique id. */
  addDecoration(range: TextRange, options: TextDecorationOptions): string;
  /** Remove a decoration by id. */
  removeDecoration(id: string): void;
  /** Replace all decorations with a new set. */
  setDecorations(decorationId: string, range: TextRange, options: TextDecorationOptions): void;
  /** Get all decorations that intersect the given range. */
  getDecorationsInRange(range: TextRange): TextDecoration[];
  /** Get a specific decoration by id. */
  getDecoration(id: string): TextDecoration | null;
  /** Remove all decorations. */
  removeAllDecorations(): void;
}
