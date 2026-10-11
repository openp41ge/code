/**
 * <openp41ge-icon> — renders an SVG icon by name.
 *
 * Usage:
 *   <openp41ge-icon name="git" size="20"></openp41ge-icon>
 *   <openp41ge-icon name="chevron-right" size="10"></openp41ge-icon>
 *
 * The icon SVG is resolved from the iconRegistry at runtime.
 * Colours inherit from `color` / `currentColor`.
 */

import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { iconRegistry, type IconName } from "../icons/registry";

export { IconName };

export class Openp41geIcon extends LitElement {
  createRenderRoot() {
    return this.attachShadow({ mode: "open" });
  }

  @property({ type: String })
  name: IconName = "file";

  @property({ type: Number })
  size: number = 16;

  render() {
    const renderFn = iconRegistry[this.name];
    const svg = renderFn ? renderFn(this.size) : "";
    return html`
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        svg {
          display: block;
        }
      </style>
      ${unsafeHTML(svg)}
    `;
  }
}

if (!customElements.get("openp41ge-icon")) {
  customElements.define("openp41ge-icon", Openp41geIcon);
}
