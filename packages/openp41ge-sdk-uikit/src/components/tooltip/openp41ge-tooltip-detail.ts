/**
 * <openp41ge-tooltip-detail> — title + subtitle tooltip panel.
 */
import { html } from "lit";
import { property } from "lit/decorators.js";
import { BaseTooltip, TOOLTIP_STYLES } from "./base-tooltip";

export class Openp41geTooltipDetail extends BaseTooltip {
  @property({ type: String })
  title = "";

  @property({ type: String })
  subtitle = "";

  render() {
    return html`
      ${TOOLTIP_STYLES}
      <div
        class="tt-panel"
        style="background:var(--bg-dropdown,#1e1e1e);border:1px solid var(--border-color,#3a3a3a);border-radius:4px;padding:6px 10px;box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:none;font-family:var(--font-ui,inherit);max-width:280px;"
      >
        <div
          style="font-size:12px;font-weight:600;color:var(--text-primary,#ddd);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
        >
          ${this.title}
        </div>
        <div
          style="font-size:11px;color:var(--text-secondary,#aaa);line-height:1.35;white-space:normal;word-break:break-word;"
        >
          ${this.subtitle}
        </div>
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-tooltip-detail")) {
  customElements.define("openp41ge-tooltip-detail", Openp41geTooltipDetail);
}
