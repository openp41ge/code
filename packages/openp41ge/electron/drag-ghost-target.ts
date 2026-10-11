/**
 * Pure helper for deciding which windows should paint a cross-window drop
 * indicator during a drag. Kept free of Electron imports so it can be unit
 * tested without mocking the runtime.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function containsPoint(rect: Rect, pos: { x: number; y: number }): boolean {
  return (
    pos.x >= rect.x &&
    pos.x <= rect.x + rect.width &&
    pos.y >= rect.y &&
    pos.y <= rect.y + rect.height
  );
}

/**
 * Decide which windows should show a cross-window drop indicator for a cursor
 * at `pos`.
 *
 * While the cursor is still over the SOURCE window — the window that initiated
 * the drag — no other window may paint an indicator: an overlaid window's grid
 * bounds can overlap the cursor even though the source is the window actually
 * under the pointer (e.g. dragging a workspace skeleton over the Workspace
 * Manager while it covers a workspace window). Only once the cursor leaves the
 * source do we allow the windows actually under it to show an indicator.
 */
export function computeGhostShowWindows(
  sourceBounds: Rect | null,
  windows: { id: string; bounds: Rect }[],
  pos: { x: number; y: number },
): Set<string> {
  if (sourceBounds && containsPoint(sourceBounds, pos)) {
    return new Set();
  }
  const show = new Set<string>();
  for (const win of windows) {
    if (containsPoint(win.bounds, pos)) show.add(win.id);
  }
  return show;
}
