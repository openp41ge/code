/**
 * CursorRenderer — renders the blinking cursor caret and secondary carets in the viewport.
 *
 * All carets blink in sync using a single requestAnimationFrame loop.
 * show()/hide() control visibility (for editor focus), blink controls opacity.
 */

import type { FastDomNode } from "../view/fast-dom-node";
import { createFastDomNode } from "../view/fast-dom-node";
import type { CursorController } from "../cursor/cursor-controller";

/**
 * Renders and positions text cursors.
 *
 * Blinking is handled via a shared RAF loop so all cursors blink in perfect sync.
 */
export class CursorRenderer {
  private _primaryEl: FastDomNode;
  private _secondaryEls: FastDomNode[] = [];
  private _cursorController: CursorController;
  private _disposed: boolean = false;

  /** RAF-based blink state. */
  private _rafId: number | null = null;
  private _cursorVisible: boolean = true;

  constructor(parentElement: HTMLElement, cursorController: CursorController) {
    this._cursorController = cursorController;

    this._primaryEl = createFastDomNode();
    this._primaryEl.setPosition("absolute");
    this._primaryEl.setWidth(2);
    this._primaryEl.setClassName("cursor-blink");
    this._primaryEl.element.style.pointerEvents = "none";
    this._primaryEl.setZIndex(100);
    this._primaryEl.setVisibility(false);
    this._primaryEl.element.style.opacity = "1";

    parentElement.appendChild(this._primaryEl.element);

    this._startBlinkLoop();
  }

  /**
   * Position a cursor caret. cursorIndex 0 = primary, 1+ = secondary.
   */
  positionAt(x: number, y: number, height: number, cursorIndex: number = 0): void {
    if (cursorIndex === 0) {
      this._primaryEl.setLeft(x);
      this._primaryEl.setTop(y);
      this._primaryEl.setHeight(height);
    } else {
      // Ensure enough secondary elements exist
      while (this._secondaryEls.length < cursorIndex) {
        const el = this._createCursorEl();
        this._secondaryEls.push(el);
      }
      const el = this._secondaryEls[cursorIndex - 1];
      el.setLeft(x);
      el.setTop(y);
      el.setHeight(height);
    }
  }

  /**
   * Sync the number of DOM cursor elements with the number of cursors.
   * Called before positioning to ensure enough elements exist.
   */
  syncCursorCount(count: number): void {
    while (this._secondaryEls.length < count - 1) {
      this._secondaryEls.push(this._createCursorEl());
    }
    while (this._secondaryEls.length > count - 1) {
      const el = this._secondaryEls.pop()!;
      el.element.remove();
    }
  }

  show(): void {
    this._primaryEl.setVisibility(true);
    for (const el of this._secondaryEls) {
      el.setVisibility(true);
    }
  }

  hide(): void {
    this._primaryEl.setVisibility(false);
    for (const el of this._secondaryEls) {
      el.setVisibility(false);
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._stopBlinkLoop();
    this._primaryEl.element.remove();
    for (const el of this._secondaryEls) {
      el.element.remove();
    }
    this._secondaryEls = [];
  }

  /** Shared RAF loop — all cursors blink in perfect sync. */
  private _startBlinkLoop(): void {
    const blink = () => {
      if (this._disposed) return;
      const now = performance.now();
      const phase = now % 1000; // 0–999ms
      const visible = phase < 500; // 500ms visible, 500ms hidden
      if (visible !== this._cursorVisible) {
        this._cursorVisible = visible;
        const op = visible ? "1" : "0";
        this._primaryEl.element.style.opacity = op;
        for (const el of this._secondaryEls) {
          el.element.style.opacity = op;
        }
      }
      this._rafId = requestAnimationFrame(blink);
    };
    // Reset all to visible on start
    this._cursorVisible = true;
    this._primaryEl.element.style.opacity = "1";
    for (const el of this._secondaryEls) {
      el.element.style.opacity = "1";
    }
    this._rafId = requestAnimationFrame(blink);
  }

  private _stopBlinkLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    // Leave cursor visible
    this._primaryEl.element.style.opacity = "1";
    for (const el of this._secondaryEls) {
      el.element.style.opacity = "1";
    }
    this._cursorVisible = true;
  }

  /**
   * Create a secondary cursor element (same styling as primary).
   */
  private _createCursorEl(): FastDomNode {
    const el = createFastDomNode();
    el.setPosition("absolute");
    el.setWidth(2);
    el.element.style.background = "var(--fe-cursor-color, #d4d4d4)";
    el.element.style.pointerEvents = "none";
    el.setZIndex(100);
    el.setVisibility(false);
    el.element.style.opacity = this._cursorVisible ? "1" : "0";
    const parent = this._primaryEl.element.parentElement;
    if (parent) {
      parent.appendChild(el.element);
    }
    return el;
  }
}
