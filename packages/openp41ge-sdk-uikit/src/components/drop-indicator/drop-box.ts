/**
 * <drop-box> — a blue-bordered, transparent-backed drop zone indicator.
 *
 * Used where a dragged item will land as a region (e.g. the settings drawer's
 * "snap to full grid width" anchor). It shares the <drop-line> blue border but
 * reads as a box rather than a line: a transparent fill with a blue border,
 * an optional soft blue wash, and an optional directional `fade` that fades the
 * box (border and wash together) toward the drag target, so it melts into the
 * drawer it is guiding.
 *
 * The border is drawn as an INSET box-shadow ring rather than a `border`:
 * the app's global reset (`*, ::before, ::after { border-width: 0;
 * border-color: currentcolor }`) overrides a shadow-root `:host` border, so a
 * real border would always compute to 0. An inset ring is unaffected by that
 * reset, follows `border-radius`, is `var()`-driven, and — like everything on
 * the host — is faded by the directional `fade` mask.
 *
 * `fade` gives the "faded box" variant: a box whose border line and wash both
 * fade out toward the drag target (the mask fades the host's painted content,
 * including the inset border ring). `fade="none"` is the solid drop-zone box.
 *
 * `frame="false"` (i.e. removing the `frame` attribute) is the "wash-only"
 * variant: the box keeps its soft blue wash but drops the border ring and its
 * glow. Used when the cursor hovers a tab bar while a drop box marks the
 * landing cell — the wash makes it clear the drop still lands in that cell
 * while the border accents step aside so the tab bar's insert line
 * stays readable.
 *
 * The host is `position: absolute`; place it with inline `left/right/top/
 * bottom` and `z-index`. Style hooks: `--drop-color`, `--drop-border`,
 * `--drop-radius`, `--drop-wash`.
 */

import { LitElement, css, html, unsafeCSS } from "lit";
import { property } from "lit/decorators.js";
import { DROP_INDICATOR_COLOR } from "./color";

export type DropFadeDirection = "none" | "left" | "right";

export class DropBox extends LitElement {
  /** Which way to fade the box out (toward the drag target). `none` = solid. */
  @property({ reflect: true }) fade: DropFadeDirection = "none";
  /** Render the soft blue wash behind the border (off = fully transparent). */
  @property({ type: Boolean, reflect: true }) wash = true;
  /** Render the border ring + glow. Set `frame="false"` for a wash-only box
   *  (keeps the wash, drops the border so the tab bar's insert line reads). */
  @property({ type: Boolean, reflect: true }) frame = true;

  static styles = css`
    :host {
      position: absolute;
      display: block;
      pointer-events: none;
      box-sizing: border-box;
      --drop-color: ${unsafeCSS(DROP_INDICATOR_COLOR)};
      --drop-border: 3px;
      --drop-radius: 0px;
      --drop-wash: rgba(74, 158, 255, 0.2);
      border-radius: var(--drop-radius);
      background: transparent;
      /* Inset-ring border (see the header comment): a real border would be
         zeroed by the global border reset, but an inset box-shadow is not. */
      box-shadow:
        inset 0 0 0 var(--drop-border) var(--drop-color),
        0 0 10px rgba(74, 158, 255, 0.6);
    }
    :host([wash]) {
      background: var(--drop-wash);
    }
    /* Wash-only: no border ring, no glow — just the tint, so the box marks
       the landing region without occluding the tab bar's insert line. */
    :host(:not([frame])) {
      box-shadow: none;
    }
    :host([fade="right"]) {
      -webkit-mask-image: linear-gradient(to right, #000, transparent);
      mask-image: linear-gradient(to right, #000, transparent);
    }
    :host([fade="left"]) {
      -webkit-mask-image: linear-gradient(to left, #000, transparent);
      mask-image: linear-gradient(to left, #000, transparent);
    }
  `;

  render() {
    return html``;
  }
}

if (!customElements.get("drop-box")) {
  customElements.define("drop-box", DropBox);
}

declare global {
  interface HTMLElementTagNameMap {
    "drop-box": DropBox;
  }
}
