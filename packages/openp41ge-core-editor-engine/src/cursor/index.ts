/**
 * Cursor barrel export.
 */

export { CursorController } from "./cursor-controller";
export type { CursorState, CursorEvent, CursorEventHandler } from "./cursor-controller";

export { isSelectionNonEmpty, selectionRange, findWordBounds } from "./cursor-utils";
export type { WordBounds } from "./cursor-utils";

export {
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  moveToLineStart,
  moveToLineEnd,
  moveWordLeft,
  moveWordRight,
  movePageUp,
  movePageDown,
} from "./cursor-move-operations";

export { insertChar, insertNewLine, insertTab } from "./cursor-type-operations";

export { deleteLeft, deleteRight } from "./cursor-delete-operations";
