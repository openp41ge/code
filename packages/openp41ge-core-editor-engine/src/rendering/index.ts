/**
 * Rendering barrel export.
 */

export { renderViewLine } from "./view-line-renderer";
export type { RenderLineOutput } from "./view-line-renderer";

export { ViewLine } from "./view-line";

export { LineNumbersOverlay } from "./line-numbers-overlay";
export type { LineNumbersOverlayConfig, LineNumberMode } from "./line-numbers-overlay";

export { CursorRenderer } from "./cursor-renderer";

export { SelectionRenderer } from "./selection-renderer";

export { FindMatchRenderer, toFindViewSpans } from "./find-match-renderer";
export type { FindViewSpan, IFindViewConverter } from "./find-match-renderer";

export { CurrentLineHighlight } from "./current-line-highlight";

export { IndentationGuides } from "./indentation-guides";
export type { IndentationGuidesConfig } from "./indentation-guides";

export { findMatchingBracket } from "./bracket-matching";
export type { BracketMatch } from "./bracket-matching";

export { BracketPairService } from "./bracket-pair-service";
export { DefaultBracketDetector } from "./bracket-detector";
export { StringCommentScopeFilter } from "./scope-filter";
export { BracketDepthComputer } from "./bracket-depth-computer";
export type { IBracketDetector, BracketPairDef } from "./bracket-detector";
export type { IScopeFilter } from "./scope-filter";
export type { BracketLineInput } from "./bracket-depth-computer";
