/**
 * SelectionRenderer — renders selection highlight spans in the viewport.
 *
 * Matches VS Code/Monaco rendering approach:
 * - Each line's selection span gets corner classes based on FLAT/INTERN/EXTERN
 *   corner types, determined by comparing adjacent lines' left/right edges.
 * - FLAT corners (edges align with adjacent line) → border-radius CSS.
 * - INTERN corners (inside bend) → extra background-colored mask pieces
 *   that create the rounded notch effect.
 * - Per-line right edge (stops at line content + newline slot).
 * - Empty lines show a ~1-char-wide indicator.
 *
 * Supports rendering multiple selections (secondary cursors).
 * Primary cursor's selection is rendered with z-index 10, secondary with z-index 9
 * and slightly lower opacity for visual distinction.
 */

import { createFastDomNode, FastDomNode } from "../view/fast-dom-node";
import type { CursorController } from "../cursor/cursor-controller";
import type { TextSelection } from "../model";
import { isSelectionNonEmpty, selectionRange } from "../cursor/cursor-utils";

/** Corner style for a selection segment edge. Matches Monaco's approach. */
const enum CornerStyle {
  /** Corner is on the exterior of the selection block — round it with border-radius. */
  EXTERN = 0,
  /** Corner is an inside bend — needs extra mask pieces. */
  INTERN = 1,
  /** Corner is flat (adjacent lines have the same edge position) — no rounding needed. */
  FLAT = 2,
}

/** Width of the corner pieces used for INTERN corner masking. Small enough not to overlap adjacent characters. */
const ROUNDED_PIECE_WIDTH = 3;

/**
 * Corner styles for the four corners of a selection segment.
 */
interface SegmentCorners {
  topLeft: CornerStyle;
  topRight: CornerStyle;
  bottomLeft: CornerStyle;
  bottomRight: CornerStyle;
}

/**
 * A single selection highlight segment on a line.
 */
interface SelectionSegment {
  lineNumber: number;
  startPixel: number;
  endPixel: number;
  top: number;
  height: number;
  corners: SegmentCorners;
}

/**
 * Info about a line's selection span within the visible range.
 */
interface LineSpan {
  line: number;
  left: number;
  right: number;
}

/**
 * Renders selection highlights as absolutely-positioned divs,
 * matching VS Code/Monaco corner handling.
 */
export class SelectionRenderer {
  private _parent: FastDomNode;
  private _cursorController: CursorController;
  private _segments: FastDomNode[] = [];
  private _disposed: boolean = false;

  constructor(parentElement: HTMLElement, cursorController: CursorController) {
    this._parent = new FastDomNode(parentElement);
    this._cursorController = cursorController;
  }

  /**
   * Update the rendered selection highlights for all visible lines.
   * Supports an optional array of selections (for multi-cursor).
   */
  renderSelection(
    visibleStartLine: number,
    visibleEndLine: number,
    lineHeight: number,
    getColumnPixel: (lineNumber: number, column: number) => { x: number; width: number },
    getLineLength: (lineNumber: number) => number,
    editorBgColor?: string,
    selections?: TextSelection[],
  ): void {
    if (this._disposed) return;

    this._clearSegments();

    // Use provided selections or compute from primary cursor
    const allSelections = selections ?? this._getPrimarySelection();
    if (!allSelections || allSelections.length === 0) return;

    // ── Phase 1: collect raw per-line spans from ALL selections ──
    //
    // Instead of rendering each selection independently (which produces
    // overlapping highlights when multiple cursors select the same or
    // overlapping ranges), we gather all per-line spans first, merge
    // overlapping spans on each line, then render a single set of
    // combined highlights.
    //
    // Each span tracks: line, left edge (px), right edge (px), and
    // whether it came from the primary cursor.

    interface RawSpan {
      line: number;
      left: number;
      right: number;
      fromPrimary: boolean;
    }

    const rawSpans: RawSpan[] = [];

    for (let si = 0; si < allSelections.length; si++) {
      const selection = allSelections[si];
      if (!isSelectionNonEmpty(selection)) continue;

      const isPrimary = si === 0;
      const segments = this._computeSegments(
        selection,
        visibleStartLine,
        visibleEndLine,
        lineHeight,
        getColumnPixel,
        getLineLength,
      );

      for (const seg of segments) {
        rawSpans.push({
          line: seg.lineNumber,
          left: seg.startPixel,
          right: seg.endPixel,
          fromPrimary: isPrimary,
        });
      }
    }

    if (rawSpans.length === 0) return;

    // ── Phase 2: group by line and merge overlapping spans ──
    //
    // Sort by line, then left. For each line, merge overlapping or
    // adjacent spans by taking the union (leftmost left, rightmost right).

    rawSpans.sort((a, b) => a.line - b.line || a.left - b.left);

    const merged: Array<{ line: number; left: number; right: number }> = [];
    let current: { line: number; left: number; right: number } | null = null;

    for (const span of rawSpans) {
      if (current === null || span.line !== current.line) {
        // Start a new line's merge
        if (current !== null) merged.push(current);
        current = { line: span.line, left: span.left, right: span.right };
      } else if (span.left <= current.right) {
        // Overlap or adjacent — merge by extending right edge
        if (span.right > current.right) {
          current.right = span.right;
        }
      } else {
        // Disjoint span on same line — push current and start new
        merged.push(current);
        current = { line: span.line, left: span.left, right: span.right };
      }
    }
    if (current !== null) merged.push(current);

    if (merged.length === 0) return;

    // ── Phase 3: determine corners ──
    //
    // Build LineSpan-like objects from merged spans and compute
    // FLAT/INTERN/EXTERN corners by comparing adjacent lines.

    const mergedSpans: LineSpan[] = merged.map((m) => ({
      line: m.line,
      left: m.left,
      right: m.right,
    }));

    const zIndex = 10; // Single combined highlight, always primary z-index

    for (let i = 0; i < mergedSpans.length; i++) {
      const span = mergedSpans[i];
      const prev = i > 0 ? mergedSpans[i - 1] : null;
      const next = i + 1 < mergedSpans.length ? mergedSpans[i + 1] : null;

      const corners: SegmentCorners = {
        topLeft: CornerStyle.EXTERN,
        topRight: CornerStyle.EXTERN,
        bottomLeft: CornerStyle.EXTERN,
        bottomRight: CornerStyle.EXTERN,
      };

      // --- LEFT edge corners ---
      if (prev && prev.line === span.line - 1) {
        if (Math.abs(span.left - prev.left) < 1) {
          corners.topLeft = CornerStyle.FLAT;
        } else if (prev.left < span.left && span.left < prev.right) {
          corners.topLeft = CornerStyle.INTERN;
        }
      }
      if (next && next.line === span.line + 1) {
        if (Math.abs(span.left - next.left) < 1) {
          corners.bottomLeft = CornerStyle.FLAT;
        } else if (next.left < span.left && span.left < next.right) {
          corners.bottomLeft = CornerStyle.INTERN;
        }
      }

      // --- RIGHT edge corners ---
      if (prev && prev.line === span.line - 1) {
        if (Math.abs(span.right - prev.right) < 1) {
          corners.topRight = CornerStyle.FLAT;
        } else if (span.right < prev.right) {
          corners.topRight = CornerStyle.INTERN;
        }
      }
      if (next && next.line === span.line + 1) {
        if (Math.abs(span.right - next.right) < 1) {
          corners.bottomRight = CornerStyle.FLAT;
        } else if (span.right < next.right) {
          corners.bottomRight = CornerStyle.INTERN;
        }
      }

      // ── Phase 4: render merged segment ──

      const top = (span.line - 1) * lineHeight;
      const seg: SelectionSegment = {
        lineNumber: span.line,
        startPixel: span.left,
        endPixel: span.right,
        top,
        height: lineHeight,
        corners,
      };

      const el = createFastDomNode();
      el.setPosition("absolute");
      el.setLeft(seg.startPixel);
      el.setTop(seg.top);
      el.setWidth(seg.endPixel - seg.startPixel);
      el.setHeight(seg.height);
      el.setZIndex(zIndex);

      let cls = "selection-highlight";
      if (seg.corners.topLeft === CornerStyle.EXTERN) cls += " top-left-radius";
      if (seg.corners.topRight === CornerStyle.EXTERN) cls += " top-right-radius";
      if (seg.corners.bottomLeft === CornerStyle.EXTERN) cls += " bottom-left-radius";
      if (seg.corners.bottomRight === CornerStyle.EXTERN) cls += " bottom-right-radius";

      el.setClassName(cls);
      this._parent.appendChild(el.element);
      this._segments.push(el);

      // Handle INTERN corners
      this._renderInternCorner(seg, zIndex, editorBgColor, "left", "top");
      this._renderInternCorner(seg, zIndex, editorBgColor, "left", "bottom");
      this._renderInternCorner(seg, zIndex, editorBgColor, "right", "top");
      this._renderInternCorner(seg, zIndex, editorBgColor, "right", "bottom");
    }
  }

  clearSelection(): void {
    this._clearSegments();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._clearSegments();
  }

  /**
   * Render a single INTERN corner as two stacked 3x3 squares.
   *
   * Bottom square: highlight-colored, fills the corner gap.
   * Top square: background-colored with one rounded corner to create the notch.
   *
   * The bottom square uses an inline style referencing the same CSS variable
   * as the main selection span (--fe-selection-bg), ensuring perfect color
   * match regardless of theme. The top square sits on top with one rounded
   * corner, creating the visual notch.
   *
   * Both squares are positioned OUTSIDE the selection span at the corner edge:
   *   left side → extends 3px to the left of seg.startPixel
   *   right side → extends 3px to the right of seg.endPixel
   *
   * Only renders when the corner at the given side/edge is INTERN.
   *
   * @param seg - The selection segment.
   * @param zIndex - Base z-index for the selection layer.
   * @param editorBgColor - Editor background color for the notch piece.
   * @param side - "left" or "right" edge of the segment.
   * @param edge - "top" or "bottom" corner on that side.
   */
  private _renderInternCorner(
    seg: SelectionSegment,
    zIndex: number,
    editorBgColor: string | undefined,
    side: "left" | "right",
    edge: "top" | "bottom",
  ): void {
    // Determine which corner style to check (SegmentCorners uses camelCase)
    const cornerKey = ((edge === "top" ? "top" : "bottom") +
      (side === "left" ? "Left" : "Right")) as keyof SegmentCorners;
    const style = seg.corners[cornerKey];
    if (style !== CornerStyle.INTERN) return;

    // Position extends OUTWARD from the selection edge:
    //   left side: 3px to the left of seg.startPixel
    //   right side: 3px to the right of seg.endPixel
    const x = side === "left" ? seg.startPixel - ROUNDED_PIECE_WIDTH : seg.endPixel;
    const y = edge === "top" ? seg.top : seg.top + seg.height - ROUNDED_PIECE_WIDTH;

    // Determine the rounded corner class for the notch square.
    // The notch sits on the outer side of the selection edge and rounds
    // the corner that FACES INWARD (toward the center of the selection):
    //   left side → round the RIGHT edge (top-right or bottom-right)
    //   right side → round the LEFT edge (top-left or bottom-left)
    const roundedClass =
      side === "left"
        ? edge === "top"
          ? " top-right-radius"
          : " bottom-right-radius"
        : edge === "top"
          ? " top-left-radius"
          : " bottom-left-radius";

    // Bottom square: highlight-colored, fills the corner area.
    // Uses inline CSS variable to guarantee same color as the main selection.
    const highlightEl = createFastDomNode();
    highlightEl.setPosition("absolute");
    highlightEl.setLeft(x);
    highlightEl.setTop(y);
    highlightEl.setWidth(ROUNDED_PIECE_WIDTH);
    highlightEl.setHeight(ROUNDED_PIECE_WIDTH);
    highlightEl.setZIndex(zIndex);
    highlightEl.setClassName("selection-corner-piece");
    highlightEl.element.style.background = "var(--fe-selection-bg, rgba(87, 145, 217, 0.3))";
    this._parent.appendChild(highlightEl.element);
    this._segments.push(highlightEl);

    // Top square: background-colored with one rounded corner to create the notch.
    if (editorBgColor) {
      const notchEl = createFastDomNode();
      notchEl.setPosition("absolute");
      notchEl.setLeft(x);
      notchEl.setTop(y);
      notchEl.setWidth(ROUNDED_PIECE_WIDTH);
      notchEl.setHeight(ROUNDED_PIECE_WIDTH);
      notchEl.setZIndex(zIndex + 1);
      notchEl.setClassName("selection-intern-mask" + roundedClass);
      notchEl.element.style.backgroundColor = editorBgColor;
      this._parent.appendChild(notchEl.element);
      this._segments.push(notchEl);
    }
  }

  /**
   * Get the primary cursor's selection as an array (if non-empty).
   */
  private _getPrimarySelection(): TextSelection[] | null {
    const selection = this._cursorController.selection;
    return isSelectionNonEmpty(selection) ? [selection] : null;
  }

  /**
   * Compute selection segments with per-line right edges and
   * Monaco-style FLAT/INTERN/EXTERN corner determination.
   */
  private _computeSegments(
    selection: TextSelection,
    visibleStartLine: number,
    visibleEndLine: number,
    lineHeight: number,
    getColumnPixel: (lineNumber: number, column: number) => { x: number; width: number },
    getLineLength: (lineNumber: number) => number,
  ): SelectionSegment[] {
    const range = selectionRange(selection);
    const segStart = Math.max(range.startLineNumber, visibleStartLine);
    const segEnd = Math.min(range.endLineNumber, visibleEndLine);

    if (segStart > segEnd) return [];

    // Left edge: the pixel of column 1 on the start line
    const leftEdge = getColumnPixel(range.startLineNumber, 1).x;

    // Build line spans for the visible range
    const spans: LineSpan[] = [];
    for (let line = segStart; line <= segEnd; line++) {
      const isFirstLine = line === range.startLineNumber;
      const isLastLine = line === range.endLineNumber;

      const spanLeft = isFirstLine ? getColumnPixel(line, range.startColumn).x : leftEdge;

      let spanRight: number;
      if (isLastLine) {
        const endPx = this._computeEndPixel(line, range.endColumn, getColumnPixel, getLineLength);
        spanRight = endPx.x;
      } else {
        const lineLen = getLineLength(line);
        const endCol = lineLen + 1;
        const endPx = this._computeEndPixel(line, endCol, getColumnPixel, getLineLength);
        spanRight = endPx.x;
      }

      if (spanRight <= spanLeft) continue; // Zero-width
      spans.push({ line, left: spanLeft, right: spanRight });
    }

    // Determine corners by comparing adjacent lines
    const segments: SelectionSegment[] = [];
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const prev = i > 0 ? spans[i - 1] : null;
      const next = i + 1 < spans.length ? spans[i + 1] : null;

      const corners: SegmentCorners = {
        topLeft: CornerStyle.EXTERN,
        topRight: CornerStyle.EXTERN,
        bottomLeft: CornerStyle.EXTERN,
        bottomRight: CornerStyle.EXTERN,
      };

      // --- LEFT edge corners ---
      if (prev) {
        // Compare left edge with previous line
        if (Math.abs(span.left - prev.left) < 1) {
          corners.topLeft = CornerStyle.FLAT;
        } else if (prev.left < span.left && span.left < prev.right) {
          corners.topLeft = CornerStyle.INTERN;
        }
      }
      if (next) {
        if (Math.abs(span.left - next.left) < 1) {
          corners.bottomLeft = CornerStyle.FLAT;
        } else if (next.left < span.left && span.left < next.right) {
          corners.bottomLeft = CornerStyle.INTERN;
        }
      }

      // --- RIGHT edge corners ---
      if (prev) {
        if (Math.abs(span.right - prev.right) < 1) {
          corners.topRight = CornerStyle.FLAT;
        } else if (span.right < prev.right) {
          corners.topRight = CornerStyle.INTERN;
        }
      }
      if (next) {
        if (Math.abs(span.right - next.right) < 1) {
          corners.bottomRight = CornerStyle.FLAT;
        } else if (span.right < next.right) {
          corners.bottomRight = CornerStyle.INTERN;
        }
      }

      segments.push({
        lineNumber: span.line,
        startPixel: span.left,
        endPixel: span.right,
        top: (span.line - 1) * lineHeight,
        height: lineHeight,
        corners,
      });
    }

    return segments;
  }

  /**
   * Compute the end pixel for a selection column.
   * For empty lines, returns a ~1-char-wide width so the selection is visible.
   */
  private _computeEndPixel(
    line: number,
    column: number,
    getColumnPixel: (lineNumber: number, column: number) => { x: number; width: number },
    getLineLength: (lineNumber: number) => number,
  ): { x: number } {
    const endPx = getColumnPixel(line, column);
    const lineLen = getLineLength(line);

    if (lineLen === 0) {
      // For empty lines, compute from column 1 (not the given column)
      // to avoid double-counting when the cursor is past column 1.
      const cw = getColumnPixel(line, 2).x - getColumnPixel(line, 1).x;
      return { x: getColumnPixel(line, 1).x + (cw > 0 ? cw : 8) };
    }

    if (column > lineLen + 1) {
      return { x: getColumnPixel(line, lineLen + 1).x };
    }

    return endPx;
  }

  private _clearSegments(): void {
    for (const seg of this._segments) {
      seg.element.remove();
    }
    this._segments = [];
  }
}
