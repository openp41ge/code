/**
 * Zoom service — manages application zoom level.
 */
export interface IZoomService {
  /** Get the current zoom level. */
  getZoom(): number;

  /** Set the zoom level. Clamped to [0.5, 2.0]. */
  setZoom(zoom: number): void;

  /** Increase zoom by 0.1. */
  zoomIn(): void;

  /** Decrease zoom by 0.1. */
  zoomOut(): void;

  /** Reset zoom to 1.0. */
  zoomReset(): void;

  /** Subscribe to zoom changes. Returns unsubscribe function. */
  subscribe(callback: (zoom: number) => void): () => void;
}
