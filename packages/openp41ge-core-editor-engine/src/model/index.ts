/**
 * Model barrel export for openp41ge-file-editor.
 */

export { PieceTreeTextContentModel } from "./piece-tree-text-content-model";
export type {
  TextPosition,
  TextRange,
  TextSelection,
  TextEditOperation,
  TextContentChange,
  TextContentChangeEvent,
  TextDecorationOptions,
  TextDecoration,
  ITextDecorationProvider,
  CursorStateComputer,
  ModelOptions,
  EOL,
} from "./piece-tree-text-content-model";

export { EditStack } from "./edit-stack";
export type { EditorTextSelection, EditStackElement } from "./edit-stack";

export { TextChange, compressConsecutiveTextChanges } from "./text-change";

export { Emitter } from "./event-emitter";
export type { EventListener, Disposable } from "./event-emitter";

export { ViewModel } from "./view-model";
export type { ViewModelEvent, ViewModelOptions } from "./view-model";

export { CoordinatesConverter } from "./coordinates-converter";
