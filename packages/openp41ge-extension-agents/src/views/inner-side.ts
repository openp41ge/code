/**
 * inner-side.ts — which edge of a sidebar faces the grid (its bottom bar's
 * buttons sit there): a sidebar in the right half of the window faces left.
 */

/** The part of a DOMRect it reads. */
export interface HorizontalBox {
  readonly left: number;
  readonly right: number;
}

export function innerSide(sidebar: HorizontalBox, viewportWidth: number): "left" | "right" {
  return (sidebar.left + sidebar.right) / 2 > viewportWidth / 2 ? "left" : "right";
}
