/**
 * InlineDiffHighlightsRenderer — full-width red/green row backgrounds for the
 * file editor's inline commit-diff view.
 *
 * Painted INSIDE the scrolling viewport (same parent as ViewLines, the cursor
 * and find-match highlights) so the bands scroll with the content. One
 * absolutely-positioned div per added/removed buffer line in the visible range,
 * at top = (lineNumber - 1) * lineHeight — matching how the editor's own line
 * rows are laid out. z-index sits behind the text rows so syntax-highlighted
 * content stays legible above the tint.
 */

export type InlineDiffRowKind = "context" | "added" | "removed";

/** One decorated buffer row of an inline commit diff. */
export interface InlineDiffRow {
  readonly kind: InlineDiffRowKind;
  /** Old-file line number this row pairs with (null when absent). */
  readonly oldLine: number | null;
  /** New-file line number this row pairs with (null when absent). */
  readonly newLine: number | null;
}

export class InlineDiffHighlightsRenderer {
  private _parent: HTMLElement;
  private _els: HTMLElement[] = [];
  private _disposed = false;

  constructor(parentElement: HTMLElement) {
    this._parent = parentElement;
  }

  /**
   * (Re)paint the full-width backgrounds for added/removed rows in the visible
   * window [visibleStartLine, visibleEndLine] (1-based buffer line numbers).
   * Bands span the FULL CONTENT width (not just the viewport) so the red/green
   * reaches into the empty scrollable space after a single very long line.
   */
  render(
    rows: readonly InlineDiffRow[] | null,
    visibleStartLine: number,
    visibleEndLine: number,
    lineHeight: number,
    contentWidth?: number,
    viewLineStart?: (modelLine: number) => number,
    viewLineCount?: (modelLine: number) => number,
  ): void {
    if (this._disposed) return;
    this.clear();

    const start = Math.max(1, visibleStartLine);
    const end = Math.max(start, visibleEndLine);
    const width = contentWidth && contentWidth > 0 ? `${Math.round(contentWidth)}px` : "100%";
    for (let i = start; i <= end; i++) {
      const row = rows?.[i - 1];
      if (!row) continue;
      if (row.kind !== "added" && row.kind !== "removed") continue;

      // Word-wrap aware: a wrapped model line spans vCount view segments, so
      // anchor the band at its FIRST view line and cover the full wrapped
      // height — exactly like the number columns, so the tint lines up with the
      // text on every segment. Identity when wrapping is off.
      const vStart = viewLineStart ? (viewLineStart(i) ?? i) : i;
      const vCount = viewLineCount ? (viewLineCount(i) ?? 1) : 1;

      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.width = width;
      el.style.top = `${(vStart - 1) * lineHeight}px`;
      el.style.height = `${vCount * lineHeight}px`;
      el.style.zIndex = "1";
      el.style.pointerEvents = "none";
      el.className = row.kind === "added" ? "fe-inline-diff-added" : "fe-inline-diff-removed";
      this._parent.appendChild(el);
      this._els.push(el);
    }
  }

  clear(): void {
    for (const el of this._els) {
      el.remove();
    }
    this._els = [];
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.clear();
  }
}
