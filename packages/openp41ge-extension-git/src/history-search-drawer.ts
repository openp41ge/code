/**
 * history-search-drawer.ts — where the Git History Search options drawer goes: beside
 * the sidebar's inner edge (into the grid), as tall as the sidebar; its mask
 * covers the grid and the other sidebar (as tall as
 * this sidebar — not the app bar — and not this sidebar, whose results
 * stay in view).
 */

/** The part of a DOMRect the placement reads. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface DrawerPlacement {
  /** Which way the drawer extends from the sidebar. */
  readonly side: "left" | "right";
  /** The sidebar's inner edge (x) the drawer starts at. */
  readonly edge: number;
  /** The mask's box (fixed): the sidebar's height, beside it. `top` is a y;
   *  `bottom`, `left` and `right` are insets from the viewport's edges. */
  readonly mask: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

export function drawerPlacement(
  sidebar: Box,
  viewportWidth: number,
  viewportHeight: number,
): DrawerPlacement {
  const bottom = viewportHeight - sidebar.bottom;
  const centre = (sidebar.left + sidebar.right) / 2;
  const isRight = centre > viewportWidth / 2;
  return {
    side: isRight ? "left" : "right",
    edge: isRight ? sidebar.left : sidebar.right,
    mask: isRight
      ? { top: sidebar.top, bottom, left: 0, right: viewportWidth - sidebar.left }
      : { top: sidebar.top, bottom, left: sidebar.right, right: 0 },
  };
}
