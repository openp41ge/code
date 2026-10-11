/**
 * ScrollManager — handles scroll events and viewport state.
 *
 * Tracks scroll position, viewport dimensions, and coordinates
 * between the rendering layer (which manages visible lines as DOM
 * elements) and the native scroll container.
 *
 * Emits scroll events so the rendering layer can update visible lines.
 */

import type { ViewLines } from "./view-lines";

/**
 * Scroll state.
 */
export interface ScrollState {
  /** Scroll top in pixels. */
  readonly scrollTop: number;
  /** Scroll left in pixels. */
  readonly scrollLeft: number;
  /** Viewport height in pixels. */
  readonly viewportHeight: number;
  /** Viewport width in pixels. */
  readonly viewportWidth: number;
  /** Total scrollable height. */
  readonly scrollHeight: number;
  /** Total scrollable width. */
  readonly scrollWidth: number;
}

/**
 * Callback for scroll events.
 */
export type ScrollEventHandler = (state: ScrollState) => void;

/**
 * Manages scroll state and events for the editor viewport.
 */
export class ScrollManager {
  private _scrollEl: HTMLElement;
  private _viewLines: ViewLines;
  private _handlers: Set<ScrollEventHandler> = new Set();
  private _scrollTop: number = 0;
  private _scrollLeft: number = 0;
  private _viewportHeight: number = 0;
  private _viewportWidth: number = 0;
  private _scrollHeight: number = 0;
  private _scrollWidth: number = 0;
  private _disposed: boolean = false;
  private _animationFramePending: boolean = false;

  constructor(scrollElement: HTMLElement, viewLines: ViewLines) {
    this._scrollEl = scrollElement;
    this._viewLines = viewLines;

    // Bind the scroll listener
    this._scrollEl.addEventListener("scroll", this._onScroll, { passive: true });

    // Read initial dimensions
    this._updateDimensions();
  }

  /**
   * Get the current scroll state.
   */
  get state(): ScrollState {
    return {
      scrollTop: this._scrollTop,
      scrollLeft: this._scrollLeft,
      viewportHeight: this._viewportHeight,
      viewportWidth: this._viewportWidth,
      scrollHeight: this._scrollHeight,
      scrollWidth: this._scrollWidth,
    };
  }

  /**
   * Get the current scroll top.
   */
  get scrollTop(): number {
    return this._scrollTop;
  }

  /**
   * Set the scroll top position (programmatic scroll).
   */
  set scrollTop(value: number) {
    this._scrollEl.scrollTop = value;
  }

  /**
   * Add a scroll event handler.
   */
  addHandler(handler: ScrollEventHandler): void {
    this._handlers.add(handler);
  }

  /**
   * Remove a scroll event handler.
   */
  removeHandler(handler: ScrollEventHandler): void {
    this._handlers.delete(handler);
  }

  /**
   * Update dimensions (e.g., after viewport resize).
   */
  updateDimensions(): void {
    this._updateDimensions();
    this._emitScroll();
  }

  /**
   * Sync the scroll height with the total document height.
   */
  syncScrollHeight(totalLineCount: number, lineHeight: number): void {
    const expectedHeight = totalLineCount * lineHeight;
    if (this._scrollHeight !== expectedHeight) {
      // Scroll height is determined by the content wrapper's height,
      // which ViewLines manages. We just notify.
      this._updateDimensions();
    }
  }

  /**
   * Dispose the scroll manager.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._scrollEl.removeEventListener("scroll", this._onScroll);
    this._handlers.clear();
  }

  private _onScroll = (): void => {
    if (this._disposed) return;

    this._scrollTop = this._scrollEl.scrollTop;
    this._scrollLeft = this._scrollEl.scrollLeft;

    // Throttle via requestAnimationFrame
    if (!this._animationFramePending) {
      this._animationFramePending = true;
      requestAnimationFrame(() => {
        this._animationFramePending = false;
        this._emitScroll();
      });
    }
  };

  private _emitScroll(): void {
    const state = this.state;

    // Notify ViewLines
    this._viewLines.onScroll(state.scrollTop, state.viewportHeight);

    // Notify external handlers
    for (const handler of this._handlers) {
      handler(state);
    }
  }

  private _updateDimensions(): void {
    this._viewportHeight = this._scrollEl.clientHeight;
    this._viewportWidth = this._scrollEl.clientWidth;
    this._scrollHeight = this._scrollEl.scrollHeight;
    this._scrollWidth = this._scrollEl.scrollWidth;
  }
}
