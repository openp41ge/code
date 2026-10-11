/**
 * FindMatchRenderer — paints search-result highlight spans in the viewport.
 *
 * Dumb paint layer fed by whoever owns the matches (built-in find bar or an
 * external highlight source). Mirrors SelectionRenderer's approach: absolutely
 * positioned spans inside the scrolling viewport, Y = (line-1)*lineHeight so the
 * parent's scrollTop reveals the visible band.
 *
 * Matching policy lives in FindInEditor; converting model matches into wrapped
 * view spans is the pure `toFindViewSpans` function below (unit-testable without
 * a DOM). The renderer only turns view spans into positioned divs.
 */

import { createFastDomNode, FastDomNode } from "../view/fast-dom-node";
import type { FindMatch } from "../input/find-in-editor";

/** Minimal model→view surface needed to split matches across wrapped lines
 * (CoordinatesConverter satisfies this). */
export interface IFindViewConverter {
  convertModelToViewPosition(
    modelLineNumber: number,
    modelColumn: number,
  ): { lineNumber: number; column: number };
  getWrapSegments(
    modelLineNumber: number,
  ): readonly { startColumn: number; endColumn: number }[] | null;
  getViewLineFromModelLine(modelLineNumber: number): number;
}

/** A single highlight span in view space (one wrapped view line). */
export interface FindViewSpan {
  readonly line: number;
  /** 1-based view column where the span starts. */
  readonly startColumn: number;
  /** 1-based view column, exclusive — the span covers [startColumn, endColumn). */
  readonly endColumn: number;
  /** True for the navigated ("current") match. */
  readonly isActive: boolean;
}

/**
 * Convert model-space matches into per-view-line spans.
 *
 * Without a converter each match maps to one span (no word wrap). With word wrap
 * a match that crosses a wrap boundary is split across the affected view lines.
 * `activeIndex` marks one match (usually the current match while navigating).
 */
export function toFindViewSpans(
  matches: readonly FindMatch[],
  converter?: IFindViewConverter | null,
  activeIndex?: number,
): FindViewSpan[] {
  const spans: FindViewSpan[] = [];
  matches.forEach((match, index) => {
    const isActive = index === activeIndex;
    if (!converter) {
      spans.push({
        line: match.lineNumber,
        startColumn: match.column,
        endColumn: match.column + match.length,
        isActive,
      });
      return;
    }

    const segments = converter.getWrapSegments(match.lineNumber);
    if (!segments || segments.length <= 1) {
      // No wrap on this model line — a single span at the converted position.
      const start = converter.convertModelToViewPosition(match.lineNumber, match.column);
      spans.push({
        line: start.lineNumber,
        startColumn: start.column,
        endColumn: start.column + match.length,
        isActive,
      });
      return;
    }

    // Wrapped: clip [match.column, match.column + length) against each segment.
    const base = converter.getViewLineFromModelLine(match.lineNumber);
    const matchEnd = match.column + match.length;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const clipStart = Math.max(match.column, seg.startColumn);
      const clipEnd = Math.min(matchEnd, seg.endColumn);
      if (clipStart >= clipEnd) continue;
      spans.push({
        line: base + i,
        startColumn: clipStart - seg.startColumn + 1,
        endColumn: clipEnd - seg.startColumn + 1,
        isActive,
      });
    }
  });
  return spans;
}

/**
 * Renders search-match highlight spans as absolutely positioned divs.
 * Search matches sit above the text but below the selection (z-index 5);
 * the active/current match renders stronger (z-index 11).
 */
export class FindMatchRenderer {
  private _parent: FastDomNode;
  private _spans: FastDomNode[] = [];
  private _disposed: boolean = false;

  constructor(parentElement: HTMLElement) {
    this._parent = new FastDomNode(parentElement);
  }

  /**
   * (Re)render the visible match spans.
   * @param spans View-space spans (from `toFindViewSpans`).
   * @param visibleStartLine First visible view line.
   * @param visibleEndLine Last visible view line.
   * @param lineHeight Row height in px.
   * @param getColumnPixel View (line, column) → pixel x/width (wrap-aware when word wrap is on).
   */
  renderFind(args: {
    spans: readonly FindViewSpan[];
    visibleStartLine: number;
    visibleEndLine: number;
    lineHeight: number;
    getColumnPixel: (lineNumber: number, column: number) => { x: number; width: number };
  }): void {
    if (this._disposed) return;
    this._clear();

    const { spans, visibleStartLine, visibleEndLine, lineHeight, getColumnPixel } = args;
    for (const span of spans) {
      if (span.line < visibleStartLine || span.line > visibleEndLine) continue;
      const x = getColumnPixel(span.line, span.startColumn).x;
      const xEnd = getColumnPixel(span.line, span.endColumn).x;
      const width = Math.max(2, xEnd - x);

      const el = createFastDomNode();
      el.setPosition("absolute");
      el.setLeft(x);
      el.setTop((span.line - 1) * lineHeight);
      el.setWidth(width);
      el.setHeight(lineHeight);
      el.setZIndex(span.isActive ? 11 : 5);
      // Active spans keep the plain class too, so selectors (and tests) can
      // match ALL matches and still isolate the navigated one.
      el.setClassName(span.isActive ? "find-match find-match-active" : "find-match");
      this._parent.appendChild(el.element);
      this._spans.push(el);
    }
  }

  /** Remove all rendered spans. */
  clear(): void {
    this._clear();
  }

  private _clear(): void {
    for (const span of this._spans) {
      span.element.remove();
    }
    this._spans = [];
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._clear();
  }
}
