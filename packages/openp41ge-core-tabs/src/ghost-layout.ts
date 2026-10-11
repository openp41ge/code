/**
 * Ghost layout — pure computation of column flex values for ghost overlays.
 *
 * Given a grid configuration and a drop zone, computes how the columns
 * should be rendered (flex values, highlighting, split indications).
 * No DOM access — fully testable in any environment.
 */

export interface GhostColumn {
  flex: number;
  highlighted: boolean;
  splitPair: boolean;
  active: boolean;
}

export type DropZone =
  { type: "cell-center"; col: number } | { type: "split"; splitCol: number; splitLeft: boolean };

/**
 * Compute ghost overlay column layout for a grid.
 *
 * For a cell-center drop, the column count is unchanged and the target
 * column is marked as "active".
 *
 * For a split drop, the column count increases by 1. The split column
 * is divided in half; one half gets the new tab (highlighted), the
 * other half becomes the split-pair (subtle).
 */
export function computeGhostLayout(
  cols: number,
  flexValues: number[],
  dropZone: DropZone,
): GhostColumn[] {
  if (dropZone.type === "cell-center") {
    return flexValues.map((f, i) => ({
      flex: f,
      highlighted: false,
      splitPair: false,
      active: i === dropZone.col,
    }));
  }

  // Split drop
  const { splitCol, splitLeft } = dropZone;
  const halfFlex = flexValues[splitCol] / 2;

  const result: GhostColumn[] = [];

  for (let i = 0; i < cols; i++) {
    if (i === splitCol) {
      if (splitLeft) {
        // New tab on the left side of the split column
        result.push({ flex: halfFlex, highlighted: true, splitPair: false, active: false });
        result.push({ flex: halfFlex, highlighted: false, splitPair: true, active: false });
      } else {
        // New tab on the right side
        result.push({ flex: halfFlex, highlighted: false, splitPair: true, active: false });
        result.push({ flex: halfFlex, highlighted: true, splitPair: false, active: false });
      }
    } else {
      result.push({ flex: flexValues[i], highlighted: false, splitPair: false, active: false });
    }
  }

  return result;
}
