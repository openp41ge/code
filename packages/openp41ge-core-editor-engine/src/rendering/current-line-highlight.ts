/**
 * CurrentLineHighlight — renders a background highlight on the line
 * containing the cursor.
 */

import type { FastDomNode } from "../view/fast-dom-node";
import { createFastDomNode } from "../view/fast-dom-node";

/**
 * Renders the current line highlight behind the text content.
 */
export class CurrentLineHighlight {
  private _el: FastDomNode;
  private _lineHeight: number = 20;
  private _visible: boolean = true;
  private _disposed: boolean = false;

  constructor(parentElement: HTMLElement) {
    this._el = createFastDomNode();
    this._el.setPosition("absolute");
    this._el.setLeft(0);
    this._el.element.style.right = "0";
    this._el.setHeight(this._lineHeight);
    this._el.setClassName("current-line-highlight");
    this._el.setZIndex(1);
    this._el.setVisibility(false);

    parentElement.appendChild(this._el.element);
  }

  /**
   * Position the highlight on a line.
   */
  setLine(lineNumber: number): void {
    if (this._disposed) return;
    const top = (lineNumber - 1) * this._lineHeight;
    this._el.setTop(top);
    this._el.setVisibility(this._visible);
  }

  /**
   * Set the line height.
   */
  setLineHeight(height: number): void {
    this._lineHeight = height;
    this._el.setHeight(height);
  }

  /**
   * Show or hide the highlight.
   */
  setVisible(visible: boolean): void {
    this._visible = visible;
    this._el.setVisibility(visible);
  }

  /**
   * Dispose the highlight.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._el.element.remove();
  }
}
