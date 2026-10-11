/**
 * <openp41ge-tooltip> — simple single-line tooltip panel.
 */
import { html } from "lit";
import { property } from "lit/decorators.js";
import { BaseTooltip, TOOLTIP_STYLES } from "./base-tooltip";

export class Openp41geTooltip extends BaseTooltip {
  @property({ type: String })
  text = "";

  render() {
    return html`
      ${TOOLTIP_STYLES}
      <div
        class="tt-panel"
        style="background:var(--bg-dropdown,#1e1e1e);border:1px solid var(--border-color,#3a3a3a);color:var(--text-primary,#ddd);padding:3px 8px;border-radius:4px;font-size:12px;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:none;font-family:var(--font-ui,inherit);"
      >
        <span
          class="tt-label"
          style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;"
          >${this.text}</span
        >
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-tooltip")) {
  customElements.define("openp41ge-tooltip", Openp41geTooltip);
}
