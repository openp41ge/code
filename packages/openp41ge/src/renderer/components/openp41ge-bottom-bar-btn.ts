/**
 * <openp41ge-bottom-bar-btn> — reusable button for the bottom bar.
 *
 * Renders a simple clickable button with consistent padding and hover color.
 * Accepts arbitrary children (SVG, text, etc.) via a slot.
 * No gaps between adjacent buttons in a flex container.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";

class Openp41geBottomBarBtn extends LitElement {
  @property({ type: String })
  title: string = "";

  render(): TemplateResult {
    return html`
      <style>
        :host {
          display: flex;
          align-items: center;
          height: 100%;
          flex-shrink: 0;
        }
        .bb-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-secondary, #999);
          padding: 2px 3px;
          height: 100%;
          box-sizing: border-box;
        }
        .bb-btn:hover {
          color: var(--text-primary, #ccc);
        }
      </style>
      <div class="bb-btn" title=${this.title}>
        <slot></slot>
      </div>
    `;
  }
}

customElements.define("openp41ge-bottom-bar-btn", Openp41geBottomBarBtn);
