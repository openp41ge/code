import { css } from "lit";

/**
 * Tree CSS — uses CSS custom properties that map to the app's theme
 * variables (defined in packages/openp41ge/src/styles/themes.css).
 *
 * Consumers can override --tree-* vars or rely on the global theme.
 */

export const treeStyles = css`
  :host {
    display: block;
    font-family: var(--tree-font, inherit);
    font-size: var(--tree-font-size, 13px);
    color: var(--tree-fg, var(--text-primary, #d4d4d4));
    background: var(--tree-bg, transparent);
    user-select: none;
    outline: none;
    overflow-y: auto;
    overflow-x: hidden;

    /* Content-match row colours — the host may override these via inline
     * custom properties to match the active syntax theme. */
    --cm-kw: #569cd6;
    --cm-str: #ce9178;
    --cm-cmt: #6a9955;
    --cm-num: #b5cea8;
    --cm-type: #4ec9b0;
    --cm-var: #9cdcfe;
    --cm-fun: #dcdcaa;
    --cm-op: #d4d4d4;
    --cm-pun: #d4d4d4;
    --cm-ent: #4ec9b0;
    --cm-sup: #9cdcfe;
    --cm-lbl: #c586c0;
    --cm-te: #ce9178;
    --cm-scl: #4ec9b0;
    --cm-tag: #569cd6;
    --cm-atr: #9cdcfe;
    --cm-rgx: #d16969;
    --cm-gutter-bg: #1a1a1a;
    --cm-gutter-fg: #858585;
    --cm-gutter-border: #2d2d2d;
    --cm-term-bg: rgba(234, 140, 0, 0.32);
    --cm-term-fg: #fff;
  }

  .tree-root {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .tree-empty {
    padding: 8px 12px;
    color: var(--tree-muted, var(--text-muted, #666));
    font-style: italic;
    font-size: 11px;
  }

  /* ─── Node Row ──────────────────────────────────────────── */

  .tree-node {
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--tree-row-height, 26px);
    cursor: pointer;
    white-space: nowrap;
    border-radius: 0;
    transition: background 0.05s ease;
    outline: none;
    box-sizing: border-box;
  }

  .tree-node:hover {
    background: var(--tree-hover-bg, var(--bg-hover, rgba(255, 255, 255, 0.06)));
  }

  .tree-node.selected {
    background: var(--tree-selected-bg, rgba(74, 158, 255, 0.12));
    color: var(--tree-selected-fg, var(--text-primary, #d4d4d4));
  }

  .tree-node.is-section {
    height: var(--tree-section-height, 30px);
    font-weight: 600;
    border-bottom: 1px solid var(--tree-divider, var(--border-divider, #2d2d2d));
  }

  .tree-node.is-section:hover {
    background: var(--tree-hover-bg, var(--bg-hover, rgba(255, 255, 255, 0.06)));
  }

  .tree-node:focus-visible {
    box-shadow: inset 0 0 0 1px var(--tree-focus, var(--border-focus, #4a9eff));
  }

  .tree-node.draggable {
    cursor: grab;
  }

  .tree-node.draggable:active {
    cursor: grabbing;
  }

  /* ─── Chevron Cell ──────────────────────────────────────── */

  .tree-chevron-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--chevron-width, 16px);
    height: 100%;
    flex-shrink: 0;
    cursor: pointer;
  }

  .tree-chevron-cell.empty {
    visibility: hidden;
    pointer-events: none;
  }

  .tree-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--tree-chevron, var(--text-muted, #666));
    line-height: 1;
  }

  /* ─── Icon Cell ─────────────────────────────────────────── */

  .tree-icon-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-width, 16px);
    height: 100%;
    flex-shrink: 0;
    color: var(--tree-icon-fg, var(--text-secondary, #999));
  }

  .tree-icon-spacer {
    display: inline-block;
    width: var(--icon-width, 16px);
    flex-shrink: 0;
  }

  /* ─── Label ─────────────────────────────────────────────── */

  .tree-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 4px;
    line-height: inherit;
    color: var(--tree-label-fg, var(--text-primary, #d4d4d4));
    font-size: inherit;
  }

  .tree-node.is-section .tree-label {
    color: var(--tree-section-fg, var(--text-primary, #d4d4d4));
    font-weight: 600;
    font-size: var(--tree-section-font-size, 13px);
  }

  /* Muted create rows (“+ add file” / “+ add folder”) dim the label text to
     the secondary grey so they read like the sidebar's add-worktree rows. */
  .tree-node--muted .tree-label {
    color: var(--tree-muted, var(--text-muted, #666));
  }
  /* Muted create rows also dim the action icon (+ glyph) and the description
     icon (folder/file) to the same colour as the row text, so every icon and
     the label on the add rows share one colour. */
  .tree-node--muted .tree-icon-cell,
  .tree-node--muted .tree-chevron-cell {
    color: var(--tree-muted, var(--text-muted, #666));
  }
  /* Create rows (“+ new file” / “+ new folder”) have no bottom border — they
     are flat rows like the rest of the file list, not separated action rows. */

  /* ─── Actions (hover) ───────────────────────────────────── */

  .tree-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .tree-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 3px;
    cursor: pointer;
    color: var(--tree-action-fg, var(--text-muted, #666));
    transition:
      color 0.1s ease,
      background 0.1s ease;
  }

  .tree-action-btn:hover {
    color: var(--tree-action-hover-fg, var(--text-secondary, #999));
    background: var(--tree-action-hover-bg, var(--bg-hover, rgba(255, 255, 255, 0.1)));
  }

  /* ─── Loading Spinner ──────────────────────────────────── */

  .tree-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--tree-spinner-track, rgba(255, 255, 255, 0.15));
    border-top-color: var(--tree-spinner-color, #4a9eff);
    border-radius: 50%;
    animation: tree-spin 0.6s linear infinite;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  @keyframes tree-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tree-node.is-loading .tree-chevron-cell {
    cursor: default;
  }

  /* ─── Badge ────────────────────────────────────────────── */

  .tree-badge {
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
    padding: 0 5px;
    font-size: 10px;
    line-height: 1.5;
    color: var(--tree-badge-fg, var(--text-muted, #999));
    background: var(--tree-badge-bg, rgba(128, 128, 128, 0.14));
    border-radius: 8px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* ─── Content-match rows (line gutter + highlighted code) ──── */

  /* A node with a rich renderLabel (e.g. a content-match row) spans the full
     row height so its gutter background/border can form a continuous block
     across consecutive rows. The default label padding / ellipsis is removed
     because the match code crops around the match itself. */
  .tree-node--cm {
    align-items: stretch;
    /* Anchor the row highlight and let the line-number gutter hang left into
       the indentation groove. Establish a stacking context so the
       selection/focus indicator (::after) paints OVER the gutter rail but
       BELOW the row text. */
    position: relative;
    isolation: isolate;
  }
  .tree-node--cm .tree-label {
    display: flex;
    align-items: stretch;
    padding: 0;
    /* Visible so the gutter can overhang left to align under the file text. */
    overflow: visible;
  }
  /* Hover highlight stays a background BEHIND the content (never covers text);
     the gutter blends with it (below). */
  .tree-node--cm:hover {
    background: var(--tree-hover-bg, var(--bg-hover, rgba(255, 255, 255, 0.06)));
  }
  /* The keyboard/focus selection indicator (blue, moved with arrows) is drawn
     on an ::after layer that sits ABOVE the gutter rail but BELOW the row text,
     so it is visible across the whole row instead of being hidden behind the
     line numbers. The selected row's own background is left transparent here
     because the ::after layer carries the selection fill. */
  .tree-node--cm.selected {
    background: transparent;
  }
  .tree-node--cm.selected::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: var(--tree-selected-bg, rgba(74, 158, 255, 0.12));
  }

  /* ─── Inline create-row input ("+ new file" / "+ new folder") ──── */
  .tree-new-entry-row {
    display: flex;
    align-items: stretch;
    gap: 0;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    /* Slide the confirm/cancel buttons clear of the panel's overlay scrollbar
       when it appears, mirroring the sidebar's --wt-sb-offset. */
    padding-right: var(--wt-sb-offset, 0px);
    transition: padding-right 150ms ease;
  }
  .tree-new-entry-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: var(--tree-row-height, 26px);
    background: transparent;
    border: none;
    color: var(--tree-label-fg, var(--text-primary, #d4d4d4));
    font: inherit;
    font-size: var(--tree-font-size, 13px);
    padding: 0 4px;
    outline: none;
  }
  /* Confirm/Cancel buttons. Matches the full-height, square, bordered look of
     the p41ge-icon-btn class used by the "add worktree" / "add repository" rows. */
  .tree-new-entry-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    height: 100%;
    aspect-ratio: 1 / 1;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--tree-muted, var(--text-secondary, #999));
    cursor: pointer;
    transition:
      color 80ms,
      background 80ms;
  }
  .tree-new-entry-btn + .tree-new-entry-btn {
    /* No separator between the confirm/cancel buttons. */
  }
  /* No leading cap separator on the confirm button either. */
  .tree-new-entry-confirm {
    /* border-left removed */
  }
  .tree-new-entry-btn:hover {
    color: var(--tree-label-fg, var(--text-primary, #fff));
    background: var(--tree-hover-bg, var(--bg-hover, rgba(255, 255, 255, 0.06)));
  }
  .tree-new-entry-input::placeholder {
    color: var(--tree-placeholder, var(--text-secondary, #999));
  }
  /* A create name that already exists in the directory keeps its normal text
     color — the invalid state is flagged by the row's + icon rotating into a
     red cross. The confirm button is dimmed/disabled so it can't be pressed. */
  .tree-new-entry-row.duplicate .tree-new-entry-confirm {
    color: var(--tree-muted, var(--text-secondary, #999));
    opacity: 0.4;
    pointer-events: none;
  }
  .tree-node--cm:focus-visible {
    box-shadow: none;
  }
  .tree-node--cm:focus-visible::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px var(--tree-focus, var(--border-focus, #4a9eff));
  }
  /* While a create row is being edited, suppress the selection/focus overlay
     so the inline input is never dimmed by a background or ring. */
  .tree-node--cm:has(.tree-new-entry-input) {
    box-shadow: none;
  }
  .tree-node--cm:has(.tree-new-entry-input)::after {
    content: none;
    display: none;
  }
  .tree-node--cm:has(.tree-new-entry-input).selected {
    background: transparent;
  }
  .tree-node--cm:has(.tree-new-entry-input):hover,
  .tree-node--cm:has(.tree-new-entry-input).selected:hover {
    background: transparent;
  }

  /* ─── Virtualized tree — flat scroll container ─────────────── */
  .tree-root--virtual {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
    min-height: 0;
    contain: strict;
  }
  /* Virtualized inside someone else's scroll container: no scrollbar, no
     height clamp — the spacers give the block its full scroll height. */
  .tree-root--virtual-external {
    display: flex;
    flex-direction: column;
  }
  .tree-virtual-spacer {
    flex-shrink: 0;
    pointer-events: none;
  }

  .cm-match-row {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    line-height: inherit;
    font-family: var(--fe-font, ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace);
    font-size: var(--tree-font-size, 12px);
  }
  .cm-match-gutter {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    box-sizing: border-box;
    padding: 0 8px 0 6px;
    flex-shrink: 0;
    user-select: none;
    font-variant-numeric: tabular-nums;
    position: relative;
    /* Width is set inline to the file's max line-number digit count so all
       rows in a file share the same gutter box → place-value alignment. */
  }
  /* The opaque rail sits behind the gutter text. It lives on ::before (z:-1) so
     the row's selection/focus ::after (z:2) paints OVER it while the line
     number (z:3) stays on top — the rail no longer hides the blue indicator. */
  .cm-match-gutter::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--cm-gutter-bg, var(--bg-gutter, #161616));
    border-right: 1px solid var(--cm-gutter-border, var(--border-divider, #2d2d2d));
  }
  .cm-match-gutter-num {
    position: relative;
    z-index: 3;
    color: var(--cm-gutter-fg, var(--tree-muted, var(--text-muted, #666)));
  }
  /* Hover blend — the gutter keeps a hint of the rail but shows the hover
     highlight across it (no longer a solid opaque cut-off). At rest the
     element background is transparent so the ::before rail shows. */
  .tree-node--cm:hover .cm-match-gutter {
    background: color-mix(
      in srgb,
      var(--cm-gutter-bg, var(--bg-gutter, #161616)) 35%,
      var(--tree-hover-bg, var(--bg-hover, #2a2d2e))
    );
  }
  .cm-match-code {
    display: inline-block;
    flex: 1;
    min-width: 0;
    white-space: pre;
    position: relative;
    z-index: 3;
    padding: 0 10px 0 8px;
    /* Vertically centre the matched text in the row. */
    line-height: var(--tree-row-height, 26px);
    color: var(--text-primary, #d4d4d4);
    overflow: hidden;
    text-overflow: clip;
  }
  .cm-match-term {
    background: var(--cm-term-bg, var(--fe-find-match-bg, rgba(234, 140, 0, 0.32)));
    color: var(--cm-term-fg, var(--fe-find-match-fg, #fff));
    border-radius: 1px;
  }
  .cm-match-code .s-kw {
    color: var(--cm-kw);
  }
  .cm-match-code .s-str {
    color: var(--cm-str);
  }
  .cm-match-code .s-cmt {
    color: var(--cm-cmt);
    font-style: italic;
  }
  .cm-match-code .s-num {
    color: var(--cm-num);
  }
  .cm-match-code .s-type {
    color: var(--cm-type);
  }
  .cm-match-code .s-var {
    color: var(--cm-var);
  }
  .cm-match-code .s-fun {
    color: var(--cm-fun);
  }
  .cm-match-code .s-op {
    color: var(--cm-op);
  }
  .cm-match-code .s-pun {
    color: var(--cm-pun);
  }
  .cm-match-code .s-ent {
    color: var(--cm-ent);
  }
  .cm-match-code .s-sup {
    color: var(--cm-sup);
  }
  .cm-match-code .s-lbl {
    color: var(--cm-lbl);
  }
  .cm-match-code .s-te {
    color: var(--cm-te);
  }
  .cm-match-code .s-scl {
    color: var(--cm-scl);
  }
  .cm-match-code .s-tag {
    color: var(--cm-tag);
  }
  .cm-match-code .s-atr {
    color: var(--cm-atr);
  }
  .cm-match-code .s-rgx {
    color: var(--cm-rgx);
  }

  /* ─── Status variants ──────────────────────────────────── */

  .tree-node--status-untracked {
    opacity: var(--tree-status-untracked-opacity, 0.6);
  }

  .tree-node--status-pending {
    opacity: var(--tree-status-pending-opacity, 0.7);
  }

  .tree-node--status-warning {
    color: var(--tree-status-warning-fg, #d4a84b);
  }

  .tree-node--status-error {
    color: var(--tree-status-error-fg, #e06c75);
  }

  .tree-node--status-success {
    color: var(--tree-status-success-fg, #7ecb8e);
  }
`;
