/**
 * Input barrel export.
 */

export { TextAreaInput } from "./text-area-input";
export type {
  TextAreaInputConfig,
  OnTypeCallback,
  OnNewLineCallback,
  OnDeleteLeftCallback,
  OnDeleteRightCallback,
  OnReplaceSelectionCallback,
  OnCompositionCallback,
  OnPasteCallback,
  OnCutCallback,
  OnKeyCallback,
} from "./text-area-input";

export { TextAreaState } from "./text-area-state";

export { KeyboardHandler } from "./keyboard-handler";

export { ClipboardHandler } from "./clipboard-handler";
export type { ClipboardHandlerConfig } from "./clipboard-handler";

export { CompositionHandler } from "./composition-handler";
export type { CompositionState } from "./composition-handler";

export { checkAutoClose, shouldSkipClose } from "./auto-closing-pairs";
export type { AutoClosingPair, AutoCloseResult } from "./auto-closing-pairs";

export { FindInEditor } from "./find-in-editor";
export type { FindMatch, FindOptions } from "./find-in-editor";

export { DragDropHandler } from "./drag-drop-handler";

export { MouseHandler } from "./mouse-handler";
export type { MouseHandlerConfig } from "./mouse-handler";
