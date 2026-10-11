/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * ViewLine — a single rendered line in the viewport.
 *
 * Each ViewLine represents one visible line of text. It owns a DOM element
 * that is positioned absolutely within the viewport. When its content changes,
 * it re-renders via renderViewLine() and updates innerHTML.
 */

import type { FastDomNode } from "../view/fast-dom-node";
import { createFastDomNode } from "../view/fast-dom-node";
import { renderViewLine, type RenderLineOutput } from "./view-line-renderer";
import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";

/**
 * A single rendered view line.
 */
export class ViewLine {
  private _domNode: FastDomNode;
  private _lineNumber: number;
  private _content: string = "";
  private _tokens: IToken[] | null = null;
  private _tabSize: number = 4;
  private _bracketDepths: ReadonlyMap<string, number> | null = null;
  private _characterMapping: Uint32Array = new Uint32Array(0);
  private _visibleColumns: number = 0;
  private _isWrapped: boolean = false;
  private _wrappedPartIndex: number = 0;

  constructor(lineNumber: number, top: number, lineHeight: number) {
    this._lineNumber = lineNumber;
    this._domNode = createFastDomNode();
    this._domNode.setPosition("absolute");
    this._domNode.setTop(top);
    this._domNode.setHeight(lineHeight);
    this._domNode.element.style.lineHeight = lineHeight + "px";
    this._domNode.setClassName("view-line");
    this._domNode.element.style.whiteSpace = "pre";
    this._domNode.element.style.left = "8px";
    // Span the full content width so clicks in the empty region to the right
    // of the line text still land on the line element, preventing selection
    // issues and ensuring proper cursor behavior
    this._domNode.element.style.right = "0";
  }

  /**
   * The DOM node for this line.
   */
  get domNode(): FastDomNode {
    return this._domNode;
  }

  /**
   * The line number this view line represents.
   */
  get lineNumber(): number {
    return this._lineNumber;
  }

  /**
   * Update the line number (e.g., after content insertion above).
   */
  setLineNumber(lineNumber: number): void {
    this._lineNumber = lineNumber;
  }

  /**
   * Set the content and tokens for this line and re-render.
   *
   * @param bracketDepths - Optional bracket depth map for bracket pair colorization.
   *   Keys are "${lineNumber}:${startIndex}" format, values are depth levels.
   */
  setContent(
    content: string,
    tokens: IToken[] | null,
    tabSize?: number,
    bracketDepths?: ReadonlyMap<string, number> | null,
  ): void {
    if (
      this._content === content &&
      this._tokens === tokens &&
      (tabSize === undefined || tabSize === this._tabSize) &&
      this._bracketDepths === bracketDepths
    ) {
      return; // No change
    }

    this._content = content;
    this._tokens = tokens;
    this._bracketDepths = bracketDepths ?? null;
    if (tabSize !== undefined) {
      this._tabSize = tabSize;
    }

    const output = renderViewLine(
      content,
      tokens,
      this._tabSize,
      bracketDepths ?? undefined,
      this._lineNumber,
    );
    this._characterMapping = output.characterMapping;
    this._visibleColumns = output.visibleColumnCount;
    this._domNode.setInnerHTML(output.html);
  }

  /**
   * Set the line height.
   */
  setLineHeight(height: number): void {
    this._domNode.setHeight(height);
    this._domNode.element.style.lineHeight = height + "px";
  }

  /**
   * Set the top position.
   */
  setTop(top: number): void {
    this._domNode.setTop(top);
  }

  /**
   * Adjust the top position by delta (for scroll sync).
   */
  deltaTop(delta: number): void {
    const currentTop = this._domNode.element.offsetTop;
    this._domNode.setTop(currentTop + delta);
  }

  /**
   * Get the CharacterMapping for this line.
   * Maps output character indices to input text offsets.
   */
  get characterMapping(): Uint32Array {
    return this._characterMapping;
  }

  /**
   * Get the visible column count (after tab expansion).
   */
  get visibleColumns(): number {
    return this._visibleColumns;
  }

  /**
   * Whether this line is a wrapped continuation.
   */
  get isWrapped(): boolean {
    return this._isWrapped;
  }

  setWrapped(wrapped: boolean, partIndex: number): void {
    this._isWrapped = wrapped;
    this._wrappedPartIndex = partIndex;
  }

  /**
   * Get the inner text content of this line from the DOM.
   * Used for clipboard copy or accessibility.
   */
  getTextContent(): string {
    return this._content;
  }

  /**
   * Dispose the line and remove its DOM node.
   */
  dispose(): void {
    this._domNode.element.remove();
  }
}
