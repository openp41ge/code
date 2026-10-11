/**
 * openp41ge-core-piece-tree — Red-black tree-based piece table for efficient text editing.
 *
 * A pure data structure that stores document text as a tree of "pieces",
 * where each piece references a sub-range of a string buffer. This enables
 * O(log n) insert and delete operations rather than O(n) string rebuilding.
 *
 * Based on the architecture of VS Code's PieceTreeBase.
 */

export { PieceTreeBase } from "./piece-tree-base";
export type { EOL, FindMatch } from "./piece-tree-base";

export { Piece } from "./piece";
export {
  TreeNode,
  SENTINEL,
  leftest,
  rightest,
  next,
  prev,
  findAtOffset,
  findAtLineNumber,
  fixInsert,
  rbDelete,
  initTreeNode,
  updateTreeMetadata,
} from "./rb-tree-base";
export type { TreeNodeColor } from "./rb-tree-base";

export { StringBuffer, createLineStartsFast } from "./text-buffer";
export { CharCode } from "./char-code";
