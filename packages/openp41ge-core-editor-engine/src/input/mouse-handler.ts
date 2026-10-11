/**
 * MouseHandler — handles mouse interactions in the file editor viewport.
 *
 * Currently handles:
 * - Double-click word selection
 *
 * On dblclick, maps the pixel coordinate to a text position using the
 * ViewLine's characterMapping, expands to word boundaries, and sets
 * the selection via CursorController.
 */

import type { CursorController } from "../cursor/cursor-controller";

/**
 * Configuration for MouseHandler.
 */
export interface MouseHandlerConfig {
  /** The viewport DOM element. */
  viewportEl: HTMLElement;
  /** The cursor controller. */
  cursorController: CursorController;
  /** Line height in pixels. */
  lineHeight: number;
  /** Character width in pixels (monospace). */
  charWidth: number;
  /** Whether word wrap is enabled. */
  wordWrapEnabled: boolean;
  /**
   * Callback to get the character mapping for a given view line number.
   * Returns the Uint32Array mapping output character positions to input
   * text offsets, or null if the line is not currently rendered.
   */
  getCharacterMapping: (viewLineNumber: number) => Uint32Array | null;
  /**
   * Callback to convert a view position to a model position (for word wrap).
   * If not provided, a 1:1 identity mapping is used.
   */
  convertViewToModelPosition?:
    ((viewLineNumber: number, viewColumn: number) => { lineNumber: number; column: number }) | null;
}

/**
 * MouseHandler — manages mouse-based interactions in the file editor.
 */
export class MouseHandler {
  private _config: MouseHandlerConfig;
  private _boundDblClick: (e: MouseEvent) => void;
  private _disposed: boolean = false;

  constructor(config: MouseHandlerConfig) {
    this._config = config;
    this._boundDblClick = this._onDblClick.bind(this);
    config.viewportEl.addEventListener("dblclick", this._boundDblClick);
  }

  private _onDblClick(e: MouseEvent): void {
    if (this._disposed) return;
    const { viewportEl, cursorController, lineHeight, charWidth, wordWrapEnabled } = this._config;

    if (!cursorController) return;

    // Get click position relative to viewport
    const rect = viewportEl.getBoundingClientRect();
    const zoom = this._getZoomFactor();
    const clickX = (e.clientX - rect.left) / zoom;
    const clickY = (e.clientY - rect.top) / zoom;

    // Compute view line and column from pixel coordinates
    const scrollTop = viewportEl.scrollTop;
    const viewLine = Math.floor((clickY + scrollTop) / lineHeight) + 1;

    const leftOffset = 8;
    const cw = charWidth > 0 ? charWidth : 8;
    const relativeX = clickX - leftOffset + viewportEl.scrollLeft;

    // Use characterMapping for accurate column calculation (handles tabs)
    const mapping = this._config.getCharacterMapping(viewLine);
    let viewCol: number;
    if (mapping && mapping.length > 0) {
      // Compute which visible character was clicked, clamped to mapping length
      const visibleIndex = Math.max(0, Math.round(relativeX / cw));
      const clampedIndex = Math.min(visibleIndex, mapping.length - 1);
      // mapping gives 0-based input offset; add 1 for 1-based column
      viewCol = mapping[clampedIndex] + 1;
    } else {
      // Fallback: simple character-based position
      viewCol = Math.max(0, Math.round(relativeX / cw)) + 1;
    }

    // Convert view position to model position (for word wrap)
    let modelLine: number;
    let modelCol: number;

    if (wordWrapEnabled && this._config.convertViewToModelPosition) {
      const modelPos = this._config.convertViewToModelPosition(viewLine, viewCol);
      modelLine = modelPos.lineNumber;
      modelCol = modelPos.column;
    } else {
      // Without word wrap: model line = view line (1:1)
      const lineCount = cursorController.model.lineCount;
      modelLine = Math.max(1, Math.min(viewLine, lineCount));
      const lineContent = cursorController.model.getLineContent(modelLine);
      modelCol = Math.min(viewCol, lineContent.length + 1);
    }

    // Remove secondary cursors and select the word at the model position
    cursorController.removeSecondaryCursors();
    cursorController.selectWordAt({ lineNumber: modelLine, column: modelCol });
  }

  /**
   * Compute the zoom factor from the viewport element.
   */
  private _getZoomFactor(): number {
    const w = this._config.viewportEl.clientWidth;
    if (w === 0) return 1;
    const rect = this._config.viewportEl.getBoundingClientRect();
    return rect.width / w;
  }

  /**
   * Update character width (e.g., after font size change).
   */
  setCharWidth(charWidth: number): void {
    this._config.charWidth = charWidth;
  }

  /**
   * Update line height (e.g., after editor settings change).
   */
  setLineHeight(lineHeight: number): void {
    this._config.lineHeight = lineHeight;
  }

  /**
   * Dispose the handler — removes event listeners.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._config.viewportEl.removeEventListener("dblclick", this._boundDblClick);
  }
}
