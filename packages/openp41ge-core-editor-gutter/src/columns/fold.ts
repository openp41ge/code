import type { GutterCellCtx, GutterColumn, GutterRow } from "../gutter";

/** Per-row editor data read by `foldColumn`. */
export interface FoldData {
  /** Whether this row is a fold header (renders a chevron button). */
  hasChevron?: boolean;
  /** Whether the fold is currently collapsed (chevron points right). */
  folded?: boolean;
}

export interface FoldColumnOptions {
  /** Column width in px, or a getter. */
  width: number | (() => number);
  /** Fired when the user clicks a row's chevron. */
  onToggle?: (line: number) => void;
}

/**
 * The fold/collapse column. Fold-header rows render a square chevron button
 * (expand/collapse); every other row is an empty, "highlightable" cell that
 * behaves like the line-number column (unified hover box + click/drag line
 * selection) so the fold column is not dead space.
 */
export function foldColumn(opts: FoldColumnOptions): GutterColumn {
  const width = resolveWidth(opts.width);
  return {
    id: "fold",
    width,
    highlightable(row: GutterRow, data: unknown): boolean {
      return !(data as FoldData | undefined)?.hasChevron;
    },
    create() {
      const cell = document.createElement("div");
      cell.className = "eg-cell";
      return cell;
    },
    update(cell: HTMLElement, row: GutterRow, ctx: GutterCellCtx): void {
      const data = ctx.data as FoldData | undefined;
      const hasChevron = !!data?.hasChevron;
      cell.classList.toggle("eg-cell--fold", hasChevron);
      if (!hasChevron) {
        // Empty fold cell: remove any chevron button, keep it selectable.
        const button = cell.querySelector("button.eg-fold-chevron");
        if (button) button.remove();
        return;
      }
      let button = cell.querySelector<HTMLButtonElement>("button.eg-fold-chevron");
      if (!button) {
        button = document.createElement("button");
        button.className = "eg-fold-chevron";
        button.addEventListener("click", () => opts.onToggle?.(row.key));
        cell.appendChild(button);
      }
      const folded = !!data?.folded;
      const points = folded ? "6,4 10,8 6,12" : "4,6 8,10 12,6";
      button.title = folded ? "Expand" : "Collapse";
      const svg = button.querySelector("svg.eg-chevron");
      if (svg) {
        const polyline = svg.querySelector("polyline");
        if (polyline && polyline.getAttribute("points") !== points) {
          polyline.setAttribute("points", points);
        }
      } else {
        // Replace inner content with the currentColor chevron (matches the
        // Explorer sidebar icon).
        button.replaceChildren();
        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgEl.setAttribute("class", "eg-chevron");
        svgEl.setAttribute("viewBox", "0 0 16 16");
        svgEl.setAttribute("width", "12");
        svgEl.setAttribute("height", "12");
        svgEl.setAttribute("fill", "none");
        svgEl.setAttribute("stroke", "currentColor");
        svgEl.setAttribute("stroke-width", "1.5");
        svgEl.setAttribute("stroke-linecap", "round");
        svgEl.setAttribute("stroke-linejoin", "round");
        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        polyline.setAttribute("points", points);
        svgEl.appendChild(polyline);
        button.appendChild(svgEl);
      }
    },
  };
}

function resolveWidth(width: number | (() => number)): () => number {
  return typeof width === "function" ? width : () => width;
}
