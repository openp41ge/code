/**
 * Saves and restores cursor position as a character offset
 * relative to the start of the contenteditable root.
 */
export interface ICursorTracker {
  /**
   * Walk the DOM under root and compute the cursor's character offset.
   * Returns null if no valid selection exists.
   */
  save(root: HTMLElement): number | null;

  /**
   * Walk the DOM under root and place the collapsed selection
   * at the given character offset.  No-op if the offset is out of bounds.
   */
  restore(root: HTMLElement, offset: number): void;
}
