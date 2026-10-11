/**
 * LineNumbersOverlay — manages line number divs in the editor gutter.
 *
 * Creates and positions line number elements alongside each visible line.
 * Line numbers are absolutely positioned within the gutter and height-synced
 * with the corresponding view line.
 *
 * Structure for each line number:
 *   <div class="line-number-wrapper" style="position:absolute; top:X; height:Y;">   ← spans wrapped height
 *     <div class="line-number" style="height:lineHeight; display:flex; align-items:center; ...">
 *       1
 *     </div>
 *   </div>
 *
 * The inner .line-number element is always exactly lineHeight tall with
 * vertically-centered text. The wrapper spans the full wrapped height so that
 * the line number aligns with the first wrapped segment.
 *
 * Supports two modes:
 *  - Absolute: shows 1, 2, 3, ...
 *  - Relative: shows distance from cursor line (5-, 4-, 3-, 2-, 1-, 0, 1-, ...)
 */

import { createFastDomNode, FastDomNode } from "../view/fast-dom-node";

export type LineNumberMode = "absolute" | "relative";

/**
 * Internal tracked data per model line.
 */
interface LineNumberEntry {
  /** Outer wrapper — spans the full wrapped height. */
  wrapper: FastDomNode;
  /** Inner label — always lineHeight tall, text vertically centered. */
  label: HTMLDivElement;
  /** Decoration classes applied to the label (cleared before reapplying). */
  cellCls?: string[];
  /** Cached geometry so a repaint of an UNCHANGED band writes no styles. */
  lastTop?: number;
  lastHeight?: number;
  lastOverflow?: string;
  /** Cached label text + active flag so scrolling a stable band stays cheap. */
  lastText?: string;
  lastActive?: boolean;
  /** Cached hover flag (mouse-over cell highlight). */
  lastHover?: boolean;
  /** Cached decoration-class key (space-joined tokens). */
  lastCls?: string;
}

/**
 * Configuration for the line numbers overlay.
 */
export interface LineNumbersOverlayConfig {
  /** Width of the gutter in pixels. */
  gutterWidth: number;
  /** Line height in pixels. */
  lineHeight: number;
  /** The line number display mode. */
  mode?: LineNumberMode;
  /** The cursor line number for relative mode. */
  activeLineNumber?: number;
  /** The line whose number cells the pointer is over (mouse-over highlight), or
   * 0/absent when the pointer is elsewhere. */
  hoverLineNumber?: number;
  /** Overrides the label shown for a line: return a string to replace the
   * number ("" blanks it), or null to use the default. Used by inline-diff
   * views where synthetic rows (deleted lines) show no number and context/
   * added rows show their real file number. */
  getLabelOverride?: (lineNumber: number) => string | null;
  /** Decoration class applied to the LINE-NUMBER CELL for a line (e.g. the
   * green AFTER-cell of an added row in an inline diff). Empty/css-clean per
   * call; the previous decoration is cleared first. */
  getLabelDecoration?: (lineNumber: number) => string;
  /** Callback when a line number is clicked. Receives the 1-based line number. */
  onLineClick?: (lineNumber: number) => void;
  /** When true, line numbers adjust for word wrap. */
  wordWrapEnabled?: boolean;
  /** Returns the view line number (1-based) for a model line (word wrap only). */
  getViewLineStart?: (modelLine: number) => number;
  /** Returns the number of view segments for a model line (word wrap only). */
  getViewLineCount?: (modelLine: number) => number;
}

/**
 * Manages line number DOM elements.
 */
export class LineNumbersOverlay {
  private _gutterEl: FastDomNode;
  private _scrollContainer: FastDomNode;
  private _config: LineNumbersOverlayConfig;
  private _entries: Map<number, LineNumberEntry> = new Map();
  private _disposed: boolean = false;

  constructor(gutterElement: HTMLElement, config: LineNumbersOverlayConfig) {
    this._gutterEl = new FastDomNode(gutterElement);
    this._gutterEl.setPosition("relative");
    this._gutterEl.setClassName("fe-gutter");
    this._gutterEl.setWidth(config.gutterWidth);

    // Inner container holding the (band-virtualized) labels. The gutter now
    // lives INSIDE the viewport's scroll container, so vertical scrolling is
    // native (compositor-driven, in lockstep with the text) — there is no CSS
    // transform to follow, which removes the per-frame main-thread work that
    // previously made the numbers lag and stop rendering below the fold.
    this._scrollContainer = createFastDomNode();
    this._scrollContainer.element.style.height = "100%";
    this._scrollContainer.element.style.overflow = "hidden";
    this._scrollContainer.setPosition("absolute");
    this._scrollContainer.setTop(0);
    this._scrollContainer.setLeft(0);
    this._scrollContainer.setWidth(config.gutterWidth);
    this._gutterEl.appendChild(this._scrollContainer);

    this._config = config;
  }

  /**
   * Update the configuration.
   */
  setConfig(config: Partial<LineNumbersOverlayConfig>): void {
    Object.assign(this._config, config);
    this._updateAll();
  }

  /**
   * Set the visible range of lines.
   * Creates/destroys line number elements as needed.
   */
  setVisibleRange(startLine: number, endLine: number, activeLine?: number): void {
    if (this._disposed) return;

    const lineHeight = this._config.lineHeight;
    const mode = this._config.mode ?? "absolute";
    const cursorLine = activeLine ?? this._config.activeLineNumber ?? 0;
    const wrapEnabled = this._config.wordWrapEnabled ?? false;
    const getViewLineStart = this._config.getViewLineStart;
    const getViewLineCount = this._config.getViewLineCount;

    // Pre-compute view positions when word wrap is enabled
    const viewStartMap = new Map<number, number>();
    const viewCountMap = new Map<number, number>();
    if (wrapEnabled && getViewLineStart && getViewLineCount) {
      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const vStart = getViewLineStart(lineNum);
        const vCount = getViewLineCount(lineNum);
        viewStartMap.set(lineNum, vStart);
        viewCountMap.set(lineNum, vCount);
      }
    }

    // Remove elements that are no longer visible
    for (const [lineNum, entry] of this._entries) {
      if (lineNum < startLine || lineNum > endLine) {
        entry.wrapper.element.remove();
        this._entries.delete(lineNum);
      }
    }

    // Create or update elements for visible lines. Geometry (top/height) is
    // SCROLL-INVARIANT — a model line is always at the same document offset —
    // so reused entries are only touched when their text/decoration actually
    // changed. Under fast scrolling this turns a full O(band) repaint into a
    // handful of boundary creates/removes and keeps the main thread out of the
    // way of the compositor (scroll feel stays smooth).
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      // Pre-compute geometry once, then diff against each entry's cache.
      let top: number;
      let height: number;
      let overflow: string;
      if (wrapEnabled) {
        const vStart = viewStartMap.get(lineNum) ?? lineNum;
        const vCount = viewCountMap.get(lineNum) ?? 1;
        top = (vStart - 1) * lineHeight;
        height = vCount * lineHeight;
        overflow = "hidden";
      } else {
        top = (lineNum - 1) * lineHeight;
        height = lineHeight;
        overflow = "visible";
      }

      let entry = this._entries.get(lineNum);

      if (!entry) {
        // New line — create element as before...
        // Outer wrapper — absolutely positioned, spans the visible height
        const wrapper = createFastDomNode();
        wrapper.setPosition("absolute");
        wrapper.setLeft(0);
        wrapper.setWidth(this._config.gutterWidth);
        // The wrapper spans the FULL wrapped height (vCount * lineHeight); the
        // label inside is one row tall. CSS puts the cell BACKGROUND on this
        // wrapper class so a selected/added/removed WRAPPED row tints every
        // segment, not just the first one.
        wrapper.element.classList.add("line-number-wrapper");
        wrapper.element.setAttribute("data-line", String(lineNum));

        // Inner label — exactly lineHeight tall, text vertically centered
        const label = document.createElement("div");
        label.className = "line-number";
        label.setAttribute("data-line", String(lineNum));
        label.style.cursor = "pointer";
        label.style.boxSizing = "border-box";
        label.style.width = "100%";
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.justifyContent = "flex-end";
        label.style.paddingRight = "8px";
        label.style.overflow = "hidden";
        label.style.textOverflow = "clip";
        label.style.whiteSpace = "nowrap";

        // Click on line number selects the entire line
        label.addEventListener("click", (e) => {
          e.stopPropagation();
          this._config.onLineClick?.(lineNum);
        });

        wrapper.element.appendChild(label);
        this._scrollContainer.appendChild(wrapper);
        entry = { wrapper, label, lastTop: top, lastHeight: height, lastOverflow: overflow };
        this._entries.set(lineNum, entry);
        // Fresh element — write its geometry once.
        entry.wrapper.setTop(top);
        entry.wrapper.setHeight(height);
        entry.wrapper.element.style.overflow = overflow;
        // Inner label is always exactly one lineHeight tall.
        entry.label.style.height = lineHeight + "px";
        entry.label.style.lineHeight = lineHeight + "px";
        entry.lastHover = undefined; // force the hover state to paint below
      } else {
        if (entry.lastTop !== top) {
          entry.wrapper.setTop(top);
          entry.lastTop = top;
        }
        if (entry.lastHeight !== height) {
          entry.wrapper.setHeight(height);
          entry.lastHeight = height;
        }
        if (entry.lastOverflow !== overflow) {
          entry.wrapper.element.style.overflow = overflow;
          entry.lastOverflow = overflow;
        }
      }

      // Content — write labels only when their value actually changes.
      if (mode === "relative" && cursorLine > 0) {
        const distance = Math.abs(lineNum - cursorLine);
        const text = distance === 0 ? "" : String(distance);
        if (entry.lastText !== text) {
          entry.label.textContent = text;
          entry.lastText = text;
        }
        const active = distance === 0;
        if (entry.lastActive !== active) {
          entry.label.classList.toggle("active-line-number", active);
          entry.lastActive = active;
        }
      } else {
        const labelOverride = this._config.getLabelOverride?.(lineNum);
        const text =
          labelOverride === undefined || labelOverride === null ? String(lineNum) : labelOverride;
        if (entry.lastText !== text) {
          entry.label.textContent = text;
          entry.lastText = text;
        }
        if (entry.lastActive !== false) {
          entry.label.classList.remove("active-line-number");
          entry.lastActive = false;
        }
        // Decorations on the number cell (e.g. green AFTER-cell of an added
        // row and/or the active-line ring). getLabelDecoration may return
        // several space-separated classes, so apply/clear them token-wise on
        // BOTH the one-row label (matches its text) and the full-height
        // wrapper (so a wrapped row tints all its segments).
        const decoration = this._config.getLabelDecoration?.(lineNum) ?? "";
        if (entry.lastCls !== decoration) {
          const tokens = decoration ? decoration.split(/\s+/) : [];
          if (entry.cellCls) {
            for (const t of entry.cellCls) {
              if (!tokens.includes(t)) {
                entry.label.classList.remove(t);
                entry.wrapper.element.classList.remove(t);
              }
            }
          }
          for (const t of tokens) {
            entry.label.classList.add(t);
            entry.wrapper.element.classList.add(t);
          }
          entry.cellCls = tokens.length > 0 ? tokens : undefined;
          entry.lastCls = decoration;
        }
      }

      // Mouse-over highlight — the cell (and, when wrapping, the full-height
      // wrapper so every segment tints) lights up for the hovered line.
      const hover = this._config.hoverLineNumber === lineNum;
      if (entry.lastHover !== hover) {
        entry.wrapper.element.classList.toggle("line-number-hover", hover);
        entry.label.classList.toggle("line-number-hover", hover);
        entry.lastHover = hover;
      }
    }
  }

  /**
   * Highlight the number cell(s) of a hovered line. Pass null (or 0) to clear.
   */
  setHoverLine(lineNumber: number | null): void {
    if (this._disposed) return;
    const prev = this._config.hoverLineNumber ?? 0;
    this._config.hoverLineNumber = lineNumber ?? 0;
    this._paintHoverCell(prev);
    this._paintHoverCell(this._config.hoverLineNumber);
  }

  private _paintHoverCell(line: number): void {
    if (line <= 0) return;
    const entry = this._entries.get(line);
    if (!entry) return;
    const hover = this._config.hoverLineNumber === line;
    if (entry.lastHover !== hover) {
      entry.wrapper.element.classList.toggle("line-number-hover", hover);
      entry.label.classList.toggle("line-number-hover", hover);
      entry.lastHover = hover;
    }
  }

  /**
   * Change the gutter width at runtime (e.g. an inline diff needs room for its
   * `old new +` labels, or the plain editor sizes the column to the file's
   * line count). The new width propagates to the inner scroll container and
   * every existing label wrapper, so already-painted numbers reflow to the
   * new width instead of staying at the old one until the band is next
   * rebuilt.
   */
  setGutterWidth(width: number): void {
    if (width <= 0 || this._disposed) return;
    this._config.gutterWidth = width;
    this._gutterEl.setWidth(width);
    this._scrollContainer.setWidth(width);
    for (const [, entry] of this._entries) {
      entry.wrapper.setWidth(width);
    }
  }

  /**
   * Update the active line (for relative mode).
   */
  setActiveLine(lineNumber: number, mode?: LineNumberMode): void {
    this._config.activeLineNumber = lineNumber;
    if (mode) {
      this._config.mode = mode;
    }
    this._updateAll();
  }

  /**
   * No-op: line numbers scroll NATIVELY with the content now (the gutter lives
   * inside the viewport's one scroll container, like VSCode's unified scroll),
   * so there is no CSS transform to drive. Kept so stale callers stay safe.
   */
  setScrollOffset(_scrollTop: number): void {}

  /**
   * Set the line height.
   */
  setLineHeight(height: number): void {
    this._config.lineHeight = height;
    for (const [, entry] of this._entries) {
      entry.label.style.height = height + "px";
      entry.label.style.lineHeight = height + "px";
    }
  }

  /**
   * Clear all line number elements.
   */
  clear(): void {
    for (const [, entry] of this._entries) {
      entry.wrapper.element.remove();
    }
    this._entries.clear();
    // Reset scroll transform
    this._scrollContainer.element.style.transform = "";
  }

  /**
   * Dispose the overlay.
   */
  dispose(): void {
    this._disposed = true;
    this.clear();
  }

  private _updateAll(): void {
    const lines = Array.from(this._entries.keys());
    if (lines.length > 0) {
      this.setVisibleRange(lines[0], lines[lines.length - 1]);
    }
  }
}
