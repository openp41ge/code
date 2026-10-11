import type { IZoomService } from "../interfaces/zoom-service";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "zoom-service");

/**
 * Zoom service — manages application zoom level.
 *
 * Applies zoom via CSS zoom property on the #root element.
 * Clamped to [0.5, 2.0] range.
 */
export class ZoomService implements IZoomService {
  private _zoom = 1;
  private readonly _listeners = new Set<(zoom: number) => void>();

  getZoom(): number {
    return this._zoom;
  }

  setZoom(zoom: number): void {
    this._zoom = Math.max(0.5, Math.min(2, +zoom.toFixed(1)));
    this._applyZoom();
    for (const fn of this._listeners) {
      try {
        fn(this._zoom);
      } catch (err) {
        log.error("listener error:", err, { skipToast: true });
      }
    }
  }

  zoomIn(): void {
    this.setZoom(this._zoom + 0.1);
  }

  zoomOut(): void {
    this.setZoom(this._zoom - 0.1);
  }

  zoomReset(): void {
    this.setZoom(1);
  }

  subscribe(callback: (zoom: number) => void): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  private _applyZoom(): void {
    const root = document.getElementById("root");
    if (root) {
      root.style.zoom = String(this._zoom);
    }
    const preview = document.querySelector(".openp41ge-file-preview");
    if (preview instanceof HTMLElement) {
      preview.style.zoom = String(this._zoom);
    }
  }
}
