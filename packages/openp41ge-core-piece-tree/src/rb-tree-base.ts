/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Red-Black Tree — generic balanced binary search tree.
 *
 * Used by PieceTreeBase to store pieces ordered by document offset.
 * Ported and simplified from VS Code's rbTreeBase.ts.
 */

import type { Piece } from "./piece";

const enum NodeColor {
  Red = 0,
  Black = 1,
}

/**
 * TreeNode — a node in the red-black tree.
 */
export class TreeNode {
  parent: TreeNode;
  left: TreeNode;
  right: TreeNode;
  color: NodeColor = NodeColor.Red;

  /** Cached: size of left subtree (number of characters / line feeds). */
  size_left: number = 0;
  /** Cached: size of right subtree. */
  size_right: number = 0;
  /** Cached: total line feed count in this node's piece. */
  lf_left: number = 0;

  constructor(
    /** The piece data stored at this node. */
    public piece: Piece,
  ) {
    // These are set to SENTINEL by initTreeNode();
    // The constructor initializes them to null to avoid referencing
    // SENTINEL (which is defined after this class).
    this.parent = null as unknown as TreeNode;
    this.left = null as unknown as TreeNode;
    this.right = null as unknown as TreeNode;
  }
}

/**
 * Sentinal node — represents null in the red-black tree.
 * Always black, both children point to itself.
 */

export const SENTINEL = (() => {
  const s = new TreeNode(null as unknown as Piece);
  s.parent = s;
  s.left = s;
  s.right = s;
  s.color = NodeColor.Black;
  (s as any).piece = null;
  (s as any).size_left = 0;
  (s as any).size_right = 0;
  (s as any).lf_left = 0;
  return s;
})();

/**
 * Initialize a TreeNode's parent/left/right to SENTINEL.
 * Must be called after construction since SENTINEL is defined after TreeNode.
 */
export function initTreeNode(node: TreeNode): void {
  node.parent = SENTINEL;
  node.left = SENTINEL;
  node.right = SENTINEL;
}

export { NodeColor as TreeNodeColor };

/**
 * Get the leftmost descendant of a node.
 */
export function leftest(node: TreeNode): TreeNode {
  while (node.left !== SENTINEL) {
    node = node.left;
  }
  return node;
}

/**
 * Get the rightmost descendant of a node.
 */
export function rightest(node: TreeNode): TreeNode {
  while (node.right !== SENTINEL) {
    node = node.right;
  }
  return node;
}

/**
 * Get the next node in an in-order traversal.
 */
export function next(node: TreeNode): TreeNode {
  if (node.right !== SENTINEL) {
    return leftest(node.right);
  }
  while (node.parent !== SENTINEL && node === node.parent.right) {
    node = node.parent;
  }
  return node.parent;
}

/**
 * Get the previous node in an in-order traversal.
 */
export function prev(node: TreeNode): TreeNode {
  if (node.left !== SENTINEL) {
    return rightest(node.left);
  }
  while (node.parent !== SENTINEL && node === node.parent.left) {
    node = node.parent;
  }
  return node.parent;
}

/**
 * Update the cached metadata for a node from its children.
 */
export function updateTreeMetadata(node: TreeNode): void {
  const left = node.left;
  const right = node.right;

  node.size_left = left === SENTINEL ? 0 : left.size_left + left.piece!.length + left.size_right;
  node.lf_left = left === SENTINEL ? 0 : left.lf_left + left.piece!.lineFeedCnt;

  node.size_right =
    right === SENTINEL ? 0 : right.size_left + right.piece!.length + right.size_right;
}

// ─── Rotations ──────────────────────────────────────────────────────────────

function rotateLeft(tree: { root: TreeNode }, x: TreeNode): void {
  const y = x.right;
  x.right = y.left;
  if (y.left !== SENTINEL) {
    y.left.parent = x;
  }
  y.parent = x.parent;
  if (x.parent === SENTINEL) {
    tree.root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.left = x;
  x.parent = y;
  updateTreeMetadata(x);
  updateTreeMetadata(y);
}

function rotateRight(tree: { root: TreeNode }, x: TreeNode): void {
  const y = x.left;
  x.left = y.right;
  if (y.right !== SENTINEL) {
    y.right.parent = x;
  }
  y.parent = x.parent;
  if (x.parent === SENTINEL) {
    tree.root = y;
  } else if (x === x.parent.right) {
    x.parent.right = y;
  } else {
    x.parent.left = y;
  }
  y.right = x;
  x.parent = y;
  updateTreeMetadata(x);
  updateTreeMetadata(y);
}

// ─── Insert ─────────────────────────────────────────────────────────────────

/**
 * Fix the red-black tree properties after an insertion.
 */
export function fixInsert(tree: { root: TreeNode }, x: TreeNode): void {
  x.color = NodeColor.Red;

  while (x !== tree.root && x.parent.color === NodeColor.Red) {
    if (x.parent === x.parent.parent.left) {
      const y = x.parent.parent.right;
      if (y.color === NodeColor.Red) {
        x.parent.color = NodeColor.Black;
        y.color = NodeColor.Black;
        x.parent.parent.color = NodeColor.Red;
        x = x.parent.parent;
      } else {
        if (x === x.parent.right) {
          x = x.parent;
          rotateLeft(tree, x);
        }
        x.parent.color = NodeColor.Black;
        x.parent.parent.color = NodeColor.Red;
        rotateRight(tree, x.parent.parent);
      }
    } else {
      const y = x.parent.parent.left;
      if (y.color === NodeColor.Red) {
        x.parent.color = NodeColor.Black;
        y.color = NodeColor.Black;
        x.parent.parent.color = NodeColor.Red;
        x = x.parent.parent;
      } else {
        if (x === x.parent.left) {
          x = x.parent;
          rotateRight(tree, x);
        }
        x.parent.color = NodeColor.Black;
        x.parent.parent.color = NodeColor.Red;
        rotateLeft(tree, x.parent.parent);
      }
    }
  }

  tree.root.color = NodeColor.Black;
}

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * Transplant a node in the tree — replaces the subtree rooted at `u`
 * with the subtree rooted at `v`.
 */
function transplant(tree: { root: TreeNode }, u: TreeNode, v: TreeNode): void {
  if (u.parent === SENTINEL) {
    tree.root = v;
  } else if (u === u.parent.left) {
    u.parent.left = v;
  } else {
    u.parent.right = v;
  }
  v.parent = u.parent;
}

/**
 * Delete a node from the red-black tree.
 */
export function rbDelete(tree: { root: TreeNode }, z: TreeNode): void {
  let x: TreeNode;
  let y = z;
  let yOriginalColor = y.color;

  if (z.left === SENTINEL) {
    x = z.right;
    transplant(tree, z, z.right);
  } else if (z.right === SENTINEL) {
    x = z.left;
    transplant(tree, z, z.left);
  } else {
    y = leftest(z.right);
    yOriginalColor = y.color;
    x = y.right;
    if (y.parent === z) {
      x.parent = y;
    } else {
      transplant(tree, y, y.right);
      y.right = z.right;
      y.right.parent = y;
    }
    transplant(tree, z, y);
    y.left = z.left;
    y.left.parent = y;
    y.color = z.color;
    updateTreeMetadata(y);
  }

  // Walk up the tree updating metadata
  let n = x;
  while (n !== SENTINEL) {
    updateTreeMetadata(n);
    n = n.parent;
  }

  if (yOriginalColor === NodeColor.Black) {
    fixDelete(tree, x);
  }
}

/**
 * Fix red-black tree properties after a deletion.
 */
function fixDelete(tree: { root: TreeNode }, x: TreeNode): void {
  while (x !== tree.root && x.color === NodeColor.Black) {
    if (x === x.parent.left) {
      let w = x.parent.right;
      if (w.color === NodeColor.Red) {
        w.color = NodeColor.Black;
        x.parent.color = NodeColor.Red;
        rotateLeft(tree, x.parent);
        w = x.parent.right;
      }
      if (w.left.color === NodeColor.Black && w.right.color === NodeColor.Black) {
        w.color = NodeColor.Red;
        x = x.parent;
      } else {
        if (w.right.color === NodeColor.Black) {
          w.left.color = NodeColor.Black;
          w.color = NodeColor.Red;
          rotateRight(tree, w);
          w = x.parent.right;
        }
        w.color = x.parent.color;
        x.parent.color = NodeColor.Black;
        w.right.color = NodeColor.Black;
        rotateLeft(tree, x.parent);
        x = tree.root;
      }
    } else {
      let w = x.parent.left;
      if (w.color === NodeColor.Red) {
        w.color = NodeColor.Black;
        x.parent.color = NodeColor.Red;
        rotateRight(tree, x.parent);
        w = x.parent.left;
      }
      if (w.right.color === NodeColor.Black && w.left.color === NodeColor.Black) {
        w.color = NodeColor.Red;
        x = x.parent;
      } else {
        if (w.left.color === NodeColor.Black) {
          w.right.color = NodeColor.Black;
          w.color = NodeColor.Red;
          rotateLeft(tree, w);
          w = x.parent.left;
        }
        w.color = x.parent.color;
        x.parent.color = NodeColor.Black;
        w.left.color = NodeColor.Black;
        rotateRight(tree, x.parent);
        x = tree.root;
      }
    }
  }
  x.color = NodeColor.Black;
}

/**
 * Find a node by offset in the tree.
 * Returns the node containing the offset, plus the remainder within that node.
 */
export function findAtOffset(
  node: TreeNode,
  offset: number,
): { node: TreeNode; remainder: number; nodeStartOffset: number } {
  let remainder = offset;
  let nodeStartOffset = 0;

  while (node !== SENTINEL) {
    const leftSize = node.size_left;

    if (remainder < leftSize) {
      node = node.left;
    } else {
      remainder -= leftSize;
      nodeStartOffset += leftSize;

      if (remainder < node.piece.length) {
        return { node, remainder, nodeStartOffset };
      }

      remainder -= node.piece.length;
      nodeStartOffset += node.piece.length;
      node = node.right;
    }
  }

  // Should not reach here for valid offsets
  return { node: SENTINEL, remainder: 0, nodeStartOffset: 0 };
}

/**
 * Find a node by line number (1-based).
 * Returns the node containing the line, plus offset info.
 */
export function findAtLineNumber(
  node: TreeNode,
  lineNumber: number,
): { node: TreeNode; lineRemainder: number; nodeStartLine: number } {
  let lineRemainder = lineNumber;
  let nodeStartLine = 1;

  while (node !== SENTINEL) {
    const leftLf = node.lf_left;

    if (lineRemainder <= leftLf) {
      node = node.left;
    } else {
      lineRemainder -= leftLf;
      nodeStartLine += leftLf;

      if (lineRemainder <= node.piece.lineFeedCnt + 1) {
        return { node, lineRemainder, nodeStartLine };
      }

      lineRemainder -= node.piece.lineFeedCnt + 1;
      nodeStartLine += node.piece.lineFeedCnt + 1;
      node = node.right;
    }
  }

  return { node: SENTINEL, lineRemainder: 1, nodeStartLine: 1 };
}
