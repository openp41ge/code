/**
 * Drag ghost window management.
 *
 * Manages a transparent, frameless BrowserWindow that follows the cursor
 * during drag-and-drop operations, showing a label for what's being dragged.
 */

export interface IDragGhostManager {
  /**
   * Create and show the drag ghost window at the given screen position.
   * @param emoji Optional emoji character to display as an icon next to the label.
   * @param tabWidth Width of the source tab element (used for ghost window size).
   * @param tabHeight Height of the source tab element (used for ghost window size).
   * @param offsetX Horizontal offset from cursor to ghost window origin (cursor - tabLeft).
   * @param offsetY Vertical offset from cursor to ghost window origin (cursor - tabTop).
   * @param isFile Render as an explorer file row (document glyph + name) instead of a tab pill.
   * @param bitmapDataUrl Optional captured PNG of the actual dragged element; when present it is
   *   rendered at the element's size and the window adopts those exact dimensions.
   * @param dragType The drag kind (e.g. "workspace"); a "workspace" drag picks a
   *   spring scale-up ghost instead of a static one.
   */
  show(
    label: string,
    screenX: number,
    screenY: number,
    emoji?: string,
    tabWidth?: number,
    tabHeight?: number,
    offsetX?: number,
    offsetY?: number,
    isFile?: boolean,
    bitmapDataUrl?: string,
    dragType?: string,
  ): void;

  /** Swap the ghost content to a captured bitmap in-place (no window recreate). */
  setBitmap(dataUrl: string, width: number, height: number, inset?: number): void;

  /** Move the drag ghost window to a new screen position. */
  move(screenX: number, screenY: number): void;

  /**
   * Fade the ghost content (0–1). Animates quickly; used to let the drop
   * indicator under the cursor show through while hovering a tab bar.
   */
  setOpacity(opacity: number): void;

  /** Hide and destroy the drag ghost window. */
  hide(): void;

  /** Check if a drag ghost is currently active. */
  isActive(): boolean;
}
