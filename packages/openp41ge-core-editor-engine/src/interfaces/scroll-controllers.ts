/**
 * Scroll controller interfaces for the Openp41ge file editor.
 *
 * These interfaces define abstractions for scroll management, enabling
 * SOLID-compliant dependency injection and testability without real DOM.
 */

/**
 * Controls auto-scrolling behaviour (e.g., click-and-hold scroll-to-bottom).
 *
 * Single Responsibility: Manages only the start/stop lifecycle of a
 * repeated scroll action. The strategy (interval-based, animation-frame,
 * smooth) is an implementation detail hidden behind this interface.
 */
export interface IAutoScrollController {
  /**
   * Begin auto-scrolling the target element downward.
   * If already scrolling, the previous scroll is stopped first.
   */
  start(config: {
    /** The element to scroll. */
    target: HTMLElement;
    /** Pixels to add per tick. Default: 20. */
    speed?: number;
    /** Milliseconds between ticks. Default: 30. */
    interval?: number;
  }): void;

  /** Stop any ongoing auto-scroll. Safe to call when not scrolling. */
  stop(): void;

  /** Whether auto-scroll is currently active. */
  readonly isScrolling: boolean;
}

/**
 * Controls viewport scroll behaviour abstracted from a specific DOM element.
 *
 * Dependency Inversion: High-level code (e.g., bottom-bar scroll-to-bottom)
 * depends on this interface, not on a specific HTMLElement. The production
 * implementation wraps the viewport DOM element; tests can inject a mock.
 */
export interface IScrollController {
  /** Scroll to an absolute pixel position (top). */
  scrollTo(y: number): void;

  /** Scroll by a relative delta (positive = down, negative = up). */
  scrollBy(delta: number): void;

  /** Scroll to the very bottom of the content. */
  scrollToBottom(): void;

  /** True when the viewport is at or near the bottom (within a threshold). */
  readonly isAtBottom: boolean;

  /**
   * Register a callback that fires on every user-initiated scroll event.
   * Programmatic scrolls triggered by this controller should NOT fire it.
   */
  onUserScroll(callback: () => void): void;
}
