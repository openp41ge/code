/**
 * ResizeObserverNotifier — notifies callbacks when the viewport is resized.
 *
 * Uses ResizeObserver to detect viewport width changes and fires registered
 * callbacks. Implements IViewportResizeNotifier from wrap-column-calculator.
 *
 * Pre-condition: element must be an HTMLElement attached to the DOM.
 * The constructor is safe to call before attachment (ResizeObserver is a no-op
 * until the element is connected).
 */

import type { IViewportResizeNotifier } from "./wrap-column-calculator";

/**
 * Production implementation of IViewportResizeNotifier using ResizeObserver.
 */
export class ResizeObserverNotifier implements IViewportResizeNotifier {
  private _observer: ResizeObserver | null = null;
  private _callbacks: Set<(width: number) => void> = new Set();
  private _lastWidth: number = 0;

  constructor(element: HTMLElement) {
    if (typeof ResizeObserver === "undefined") return; // jsdom guard

    this._observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width !== this._lastWidth) {
          this._lastWidth = width;
          for (const cb of this._callbacks) {
            cb(width);
          }
        }
      }
    });
    this._observer.observe(element);
  }

  onResize(callback: (width: number) => void): () => void {
    this._callbacks.add(callback);
    return () => {
      this._callbacks.delete(callback);
    };
  }

  disconnect(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._callbacks.clear();
  }
}
