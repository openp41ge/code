/**
 * fe-gutter-columns — the file editor's two gutter columns, built on the shared
 * `GutterColumn` interface from `openp41ge-core-editor-gutter`.
 *
 * The file editor has two line-number columns:
 *
 *   ┌──────────────┬───────────────┬──────────────────┐
 *   │ BEFORE (old) │ AFTER (new)   │ code             │
 *   │  620  (red)  │   (gap)       │  deleted line    │
 *   │  (gap)       │  574  (green) │  added line      │
 *   │  621         │  621          │  unchanged line  │
 *   └──────────────┴───────────────┴──────────────────┘
 *
 * - `makeFeNumberColumn` renders the AFTER (normal) line-number column; it is
 *   always visible.
 * - `makeFeDiffBeforeColumn` renders the BEFORE (old) column only when an
 *   inline diff is attached (it reports `visible() === false` otherwise).
 *
 * Both columns reuse the file editor's existing CSS classes
 * (`.line-number-wrapper`, `.line-number`, `.fe-inline-left`, `.fe-inline-left-*`)
 * so the theme stylesheet keeps styling them unchanged. Cells hold a small
 * per-cell cache so repainting an unchanged band (e.g. a plain scroll) writes
 * no DOM, matching the original LineNumbersOverlay performance model.
 *
 * The editor supplies a `dataFor` function returning a `FeGutterRowData` per
 * model line; both columns render purely from that (+ the shared hover/active
 * flags).
 */

import type { GutterColumn } from "openp41ge-core-editor-gutter";

/** Per-row data shared by the file editor's two gutter columns. */
export interface FeGutterRowData {
  /** AFTER (line-number) cell label text. */
  afterLabel: string;
  /** AFTER cell decoration classes (space-joined; "" = none). */
  afterCls: string;
  /** BEFORE (diff) cell label text ("" = a gap). */
  beforeLabel: string;
  /** BEFORE cell decoration classes (space-joined; "" = none). */
  beforeCls: string;
}

/** Last-applied state of one band cell, kept on the element so repainting an
 * unchanged band writes nothing. */
interface FeCell extends HTMLElement {
  __st?: {
    text?: string;
    cls?: Set<string>;
    hover?: boolean;
    dotTop?: number;
    lineHeight?: number;
  };
}

const FONT_STACK = "'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace";

/** Diff a class set against the last-applied tokens and apply the delta to the
 * cell (and its inner label, when present). `hoverCls` is added while the row
 * is hovered so both columns light up in lockstep. */
function applyClasses(
  cell: HTMLElement,
  label: HTMLElement | null,
  decoration: string,
  hovered: boolean,
  hoverCls: string,
  st: FeCell["__st"],
): void {
  const want = new Set<string>();
  for (const t of decoration.split(/\s+/)) if (t) want.add(t);
  if (hovered) want.add(hoverCls);
  const prev = st!.cls ?? new Set<string>();
  for (const t of prev) {
    if (!want.has(t)) {
      cell.classList.remove(t);
      label?.classList.remove(t);
    }
  }
  for (const t of want) {
    if (!prev.has(t)) {
      cell.classList.add(t);
      label?.classList.add(t);
    }
  }
  st!.cls = want;
}

/** The file editor's AFTER (normal) line-number gutter column. */
export function makeFeNumberColumn(opts: {
  /** Current column width (the editor keeps this up to date and reflows). */
  width: () => number;
  /** Current line height (re-read on each update so a rebuild stays in sync). */
  lineHeight: () => number;
}): GutterColumn {
  const { lineHeight } = opts;
  return {
    id: "fe-number",
    width: () => opts.width(),
    background: () => "var(--fe-bg, #161616)",
    className: () => "fe-inline-after",
    highlightable: () => true,
    create() {
      const cell = document.createElement("div") as FeCell;
      cell.className = "line-number-wrapper";
      cell.style.cssText = `user-select:none;font-family:${FONT_STACK};`;
      // Inner label — always exactly one lineHeight tall, text vertically and
      // horizontally right-aligned (place values line up).
      const label = document.createElement("div");
      label.className = "line-number";
      label.style.cssText =
        "cursor:pointer;box-sizing:border-box;width:100%;display:flex;align-items:center;" +
        "justify-content:flex-end;padding-right:8px;overflow:hidden;text-overflow:clip;" +
        "white-space:nowrap;";
      cell.appendChild(label);
      cell.__st = {};
      return cell;
    },
    update(cell, row, ctx) {
      const st = (cell as FeCell).__st!;
      const label = cell.firstElementChild as HTMLElement;
      if (label.dataset.line !== String(row.key)) label.dataset.line = String(row.key);
      const lh = lineHeight();
      if (st.lineHeight !== lh) {
        label.style.height = lh + "px";
        label.style.lineHeight = lh + "px";
        st.lineHeight = lh;
      }
      const data = ctx.data as FeGutterRowData | undefined;
      const text = data?.afterLabel ?? String(row.key);
      if (st.text !== text) {
        label.textContent = text;
        st.text = text;
      }
      applyClasses(cell, label, data?.afterCls ?? "", ctx.hovered, "line-number-hover", st);
    },
  };
}

/** The file editor's BEFORE (old-number) inline-diff gutter column. Hidden
 * (`visible() === false`) unless an inline diff is attached. */
export function makeFeDiffBeforeColumn(opts: {
  /** Current column width (shared with the AFTER column in a diff view). */
  width: () => number;
  /** Current line height (re-read on each update so the dot stays centered). */
  lineHeight: () => number;
  /** Whether an inline diff is active (shows the column). */
  visible: () => boolean;
}): GutterColumn {
  const { lineHeight } = opts;
  return {
    id: "fe-before",
    width: () => opts.width(),
    background: () => "var(--fe-bg, #161616)",
    className: () => "fe-inline-left",
    visible: () => opts.visible(),
    highlightable: () => true,
    create() {
      const cell = document.createElement("div") as FeCell;
      cell.className = "fe-inline-left-label";
      // overflow:visible (overriding the gutter's `.eg-cell` clip) so the
      // separator dot can straddle the column's right edge and sit on the
      // shared border; the inner text span clips its own nowrap text instead.
      cell.style.cssText =
        "position:absolute;left:0;right:0;box-sizing:border-box;cursor:pointer;overflow:visible;" +
        "display:flex;align-items:flex-start;justify-content:flex-end;padding-right:8px;" +
        `user-select:none;font-family:${FONT_STACK};`;
      const textSpan = document.createElement("div");
      textSpan.className = "fe-inline-left-text";
      textSpan.style.cssText =
        "overflow:hidden;text-overflow:clip;white-space:nowrap;max-width:100%;";
      const dot = document.createElement("div");
      dot.className = "fe-inline-left-dot";
      dot.style.cssText =
        "position:absolute;width:4px;height:4px;border-radius:50%;" +
        "background:var(--fe-secondary-color,#888);pointer-events:none;z-index:2;";
      cell.appendChild(textSpan);
      cell.appendChild(dot);
      cell.__st = {};
      return cell;
    },
    update(cell, row, ctx) {
      const st = (cell as FeCell).__st!;
      const textSpan = cell.firstElementChild as HTMLElement;
      const dot = cell.lastElementChild as HTMLElement;
      if (cell.dataset.line !== String(row.key)) cell.dataset.line = String(row.key);
      const data = ctx.data as FeGutterRowData | undefined;
      const text = data?.beforeLabel ?? "";
      if (st.text !== text) {
        textSpan.textContent = text;
        st.text = text;
      }
      applyClasses(cell, textSpan, data?.beforeCls ?? "", ctx.hovered, "fe-inline-left-hover", st);
      // Separator dot: centered on the shared border, vertically centered on
      // the row's first segment (where both numbers sit).
      const dotTop = lineHeight() / 2 - 2;
      if (st.dotTop !== dotTop) {
        dot.style.top = `${dotTop}px`;
        st.dotTop = dotTop;
      }
      dot.style.left = "100%";
      dot.style.transform = "translateX(-50%)";
    },
  };
}
