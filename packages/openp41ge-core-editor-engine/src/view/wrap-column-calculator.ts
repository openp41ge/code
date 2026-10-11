/**
 * Wrap column calculator — computes the word wrap column from viewport dimensions.
 *
 * When word wrap is enabled, the editor should wrap lines at the viewport edge
 * rather than a fixed 80-character column. This module provides the strategy
 * interface and the production implementation that measures the viewport.
 *
 * Also provides an interface for viewport resize notification so the editor
 * can re-flow wrapped lines when the pane is resized.
 */

/**
 * Interface for computing the wrap column from viewport dimensions.
 * Follows Interface Segregation — single-method contract.
 *
 * Precondition: implementations MUST return at least 10, even on
 * very narrow viewports, to prevent the word wrap algorithm from
 * entering an infinite loop with segments shorter than 1 character.
 */
export interface IWrapColumnCalculator {
  /**
   * Compute the wrap column (max characters per wrapped line).
   *
   * @param viewportWidth - The pixel width of the viewport.
   * @param gutterWidth - The pixel width of the line number gutter (usually 0 since gutter is separate).
   * @param scrollbarGap - Pixel gap to reserve for the scrollbar (typically 0 or ~16).
   * @param charWidth - The pixel width of one monospace character.
   * @returns The maximum number of characters per line (≥ 10).
   */
  compute(
    viewportWidth: number,
    gutterWidth: number,
    scrollbarGap: number,
    charWidth: number,
  ): number;
}

/**
 * Production implementation that computes wrap column from the viewport width.
 *
 * Returns Math.max(10, floor((viewportWidth - gutterWidth - scrollbarGap) / charWidth)).
 * Falls back to 80 if charWidth is not yet measured (≤ 0).
 */
export class ViewportWrapColumnCalculator implements IWrapColumnCalculator {
  compute(
    viewportWidth: number,
    gutterWidth: number = 0,
    scrollbarGap: number = 0,
    charWidth: number,
  ): number {
    if (charWidth <= 0) return 80; // fallback if char width not yet measured
    const availableWidth = viewportWidth - gutterWidth - scrollbarGap;
    if (availableWidth <= 0) return 10; // minimum guarantee
    return Math.max(10, Math.floor(availableWidth / charWidth));
  }
}

/**
 * Interface for notifying the editor when the viewport is resized.
 */
export interface IViewportResizeNotifier {
  /**
   * Register a callback that fires when the viewport width changes.
   * Returns an unsubscribe function.
   */
  onResize(callback: (width: number) => void): () => void;
  /** Disconnect the observer and release resources. */
  disconnect(): void;
}

/**
 * Production implementation using ResizeObserver.
 */
export { ResizeObserverNotifier } from "./resize-observer-notifier";
