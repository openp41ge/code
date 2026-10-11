/**
 * IndentationGuides — renders vertical lines at indentation levels.
 *
 * Creates absolutely-positioned vertical divs that align with
 * each indentation level (tab or multiple of spaces) on each line.
 * Only lines in the visible range are rendered.
 */

import type { FastDomNode } from "../view/fast-dom-node";
import { createFastDomNode } from "../view/fast-dom-node";

/**
 * Configuration for indentation guides.
 */
export interface IndentationGuidesConfig {
  /** Tab size (spaces per indentation level). */
  tabSize: number;
  /** Character width in pixels. */
  charWidth: number;
  /** Whether to render guides. */
  enabled: boolean;
  /** The viewport element (for scroll sync). */
  viewportEl?: HTMLElement;
}

/**
 * Renders indentation guide lines.
 */
export class IndentationGuides {
  private _config: IndentationGuidesConfig;
  private _guides: Map<number, FastDomNode> = new Map();
  private _disposed: boolean = false;

  constructor(config: IndentationGuidesConfig) {
    this._config = config;
  }

  /**
   * Update the configuration.
   */
  setConfig(config: Partial<IndentationGuidesConfig>): void {
    Object.assign(this._config, config);
    this._clear();
  }

  /**
   * Render guides for a range of lines.
   * Creates a vertical line at each indentation level for each line.
   *
   * @param startLine - First visible line (1-based).
   * @param endLine - Last visible line (1-based).
   * @param getIndentLevel - Function that returns the indent level for a line.
   * @param lineHeight - Height of each line in pixels.
   * @param parentEl - The parent element to append guides to.
   */
  renderGuides(
    startLine: number,
    endLine: number,
    getIndentLevel: (lineNumber: number) => number,
    lineHeight: number,
    parentEl: HTMLElement,
  ): void {
    if (this._disposed || !this._config.enabled) {
      this._clear();
      return;
    }

    this._clear();

    const tabSize = this._config.tabSize;
    const charWidth = this._config.charWidth;

    // Collect indentation levels that appear on multiple consecutive lines
    // (a guide line is drawn only for levels that have content on adjacent lines)
    const levelLines = new Map<number, number[]>(); // level → [lineNumbers]
    for (let line = startLine; line <= endLine; line++) {
      const level = getIndentLevel(line);
      for (let i = tabSize; i <= level; i += tabSize) {
        if (!levelLines.has(i)) levelLines.set(i, []);
        levelLines.get(i)!.push(line);
      }
    }

    // Create guide elements
    for (const [level, lines] of levelLines) {
      // Only draw guide if this level has content on at least one line
      // (skip levels that appear only for indentation continuation)
      if (lines.length === 0) continue;

      const x = (level / tabSize) * tabSize * charWidth;

      const guide = createFastDomNode();
      guide.setPosition("absolute");
      guide.setLeft(x - 1); // Slightly left of the indent position
      guide.setWidth(1); // 1px vertical line
      guide.setTop((startLine - 1) * lineHeight);
      guide.setHeight((endLine - startLine + 1) * lineHeight);
      guide.setClassName("indentation-guide");
      guide.setZIndex(2);

      parentEl.appendChild(guide.element);
      this._guides.set(level, guide);
    }
  }

  /**
   * Clear all guide lines.
   */
  clear(): void {
    this._clear();
  }

  /**
   * Dispose.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._clear();
  }

  private _clear(): void {
    for (const [, guide] of this._guides) {
      guide.element.remove();
    }
    this._guides.clear();
  }
}
