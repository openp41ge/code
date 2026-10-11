/**
 * GUTTER_DEFAULT_CSS — the default structural + behavioural styles for a
 * `Gutter` host and its columns, shipped by the shared package so editors do
 * NOT re-author the identical rules per editor.
 *
 * Why a default stylesheet (vs. per-editor CSS):
 *   - The `Gutter` host itself is deliberately style-agnostic: it only lays
 *     columns out and toggles state classes (`eg-cell`, `eg-cell--active`,
 *     `eg-hoverbox`, `eg-fold-chevron`, ...). Visuals (colors, alignment,
 *     backgrounds) were previously authored in each editor.
 *   - The genuinely *shared, identical* rules (fold chevron structure,
 *     fold-header cell, unified hover box) live here once.
 *   - Each editor still owns what is editor-specific: line-number alignment,
 *     column backgrounds, active/current-line fill, error tints, and the exact
 *     color palette. They express those via the colour tokens below (or by
 *     adding scoped rules on top).
 *
 * Colour tokens (set on `.eg-gutter` or a scoped ancestor to theme):
 *   --eg-fold-color         chevron colour
 *   --eg-fold-hover-bg      chevron hover background
 *   --eg-fold-hover-color   chevron hover foreground
 *   --eg-hover-fill         unified hover-box fill
 *   --eg-hover-ring         unified hover-box inner ring
 */

export const GUTTER_DEFAULT_CSS = /* css */ `
  .eg-col {
    box-sizing: border-box;
    flex: 0 0 auto;
  }
  .eg-cell {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    overflow: hidden;
    white-space: nowrap;
  }
  /* Fold-header rows: the chevron button fills the cell and owns its hover. */
  .eg-cell--fold {
    justify-content: center;
    padding: 0;
    cursor: default;
  }
  .eg-fold-chevron {
    border: none;
    background: transparent;
    color: var(--eg-fold-color, #79c0ff);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
    padding: 0;
    box-sizing: border-box;
  }
  .eg-chevron {
    display: block;
  }
  .eg-fold-chevron:hover {
    background: var(--eg-fold-hover-bg, rgba(121, 192, 255, 0.18));
    color: var(--eg-fold-hover-color, #a5d6ff);
    /* Inset ring on hover so the collapse icon reads as a highlighted box
     * (like the unified hover box). */
    box-shadow: inset 0 0 0 1px var(--eg-hover-ring, rgba(255, 255, 255, 0.16));
  }
  /* Unified hover box: spans the highlightable columns on non-foldable rows,
     but stays on the line-number cell only when the row has a chevron (the
     chevron button owns its own hover). Painted by the gutter host; lets
     pointer events pass through. */
  .eg-hoverbox {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 3;
    background: var(--eg-hover-fill, rgba(255, 255, 255, 0.09));
    box-sizing: border-box;
    box-shadow: inset 0 0 0 1px var(--eg-hover-ring, rgba(255, 255, 255, 0.16));
    pointer-events: none;
  }
`;
