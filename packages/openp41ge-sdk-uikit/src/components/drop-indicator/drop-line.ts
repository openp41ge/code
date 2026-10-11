/**
 * <drop-line> — the solid blue insertion marker for dropping tabs / panes.
 *
 * A bright blue vertical (or horizontal) line with a soft glow, shown where a
 * dragged item will be released (tab reordering, dropping onto a closed
 * sidebar edge). It is the "drop" sibling of <drag-line> (the semi-transparent
 * hover affordance) and shares the same blue through <drop-box>.
 *
 * The host is `position: absolute`; position it with inline `left/right/top/
 * bottom`(e.g. `top: 4px; bottom: 4px`) and set `z-index` as needed. The 3px
 * thickness / radius / glow / color are CSS custom-property hooks:
 *   `--drop-color`, `--drop-width`, `--drop-radius`, `--drop-glow`.
 */

import { LitElement, css, html, unsafeCSS } from "lit";
import { property } from "lit/decorators.js";
import { DROP_INDICATOR_COLOR, DROP_LINE_GLOW } from "./color";

export class DropLine extends LitElement {
  /** Which way the line runs. Defaults to `vertical`. */
  @property({ reflect: true }) orientation: "vertical" | "horizontal" = "vertical";

  static styles = css`
    :host {
      position: absolute;
      display: block;
      pointer-events: none;
      box-sizing: border-box;
      --drop-color: ${unsafeCSS(DROP_INDICATOR_COLOR)};
      --drop-glow: ${unsafeCSS(DROP_LINE_GLOW)};
      --drop-width: 3px;
      --drop-radius: 2px;
      top: 0;
      bottom: 0;
      left: 0;
      background: var(--drop-color);
      box-shadow: var(--drop-glow);
      border-radius: var(--drop-radius);
    }
    :host([orientation="horizontal"]) {
      width: 100%;
      height: var(--drop-width);
    }
    :host([orientation="vertical"]) {
      width: var(--drop-width);
      height: 100%;
    }
  `;

  render() {
    return html``;
  }
}

if (!customElements.get("drop-line")) {
  customElements.define("drop-line", DropLine);
}

declare global {
  interface HTMLElementTagNameMap {
    "drop-line": DropLine;
  }
}
