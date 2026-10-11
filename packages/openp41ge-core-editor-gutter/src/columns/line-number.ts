import type { GutterCellCtx, GutterColumn, GutterRow } from "../gutter";

/** Per-row editor data read by `lineNumberColumn`. */
export interface LineNumberData {
  /** Mark the row's number as a syntax-error line (red tint). */
  error?: boolean;
}

export interface LineNumberColumnOptions {
  /** Column width in px, or a getter (e.g. computed from the digit count). */
  width: number | (() => number);
  /** Optional class toggled when `data.error` is set (default "eg-cell--err"). */
  errorClass?: string;
}

/**
 * The classic line-number column. The number is derived from `row.key + 1`
 * (so folded/visible renumbering is the editor's concern via the key it
 * supplies). Every cell is "highlightable", so it participates in the unified
 * hover box and click/drag line selection.
 */
export function lineNumberColumn(opts: LineNumberColumnOptions): GutterColumn {
  const width = resolveWidth(opts.width);
  const errorClass = opts.errorClass ?? "eg-cell--err";
  return {
    id: "line-numbers",
    width,
    highlightable: () => true,
    create() {
      const cell = document.createElement("div");
      cell.className = "eg-cell";
      return cell;
    },
    update(cell: HTMLElement, row: GutterRow, ctx: GutterCellCtx): void {
      const label = String(row.key + 1);
      if (cell.textContent !== label) cell.textContent = label;
      const err = !!(ctx.data as LineNumberData | undefined)?.error;
      cell.classList.toggle(errorClass, err);
    },
  };
}

function resolveWidth(width: number | (() => number)): () => number {
  return typeof width === "function" ? width : () => width;
}
