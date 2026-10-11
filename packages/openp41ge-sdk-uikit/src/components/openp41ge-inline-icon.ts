/**
 * <openp41ge-inline-icon> — icon button in a rounded square with hover background.
 *
 * Renders an <openp41ge-icon> inside a transparent square that lights up on
 * hover. The bounding box is always a perfect square (icon size + 4px padding).
 *
 * Usage:
 *   <openp41ge-inline-icon name="plus" size="12" hover-color="accent"></openp41ge-inline-icon>
 *   <openp41ge-inline-icon name="file-deleted" size="12" hover-color="danger"></openp41ge-inline-icon>
 *   <openp41ge-inline-icon name="chevron-right" size="12" no-hover></openp41ge-inline-icon>
 *   <openp41ge-inline-icon name="check-circle" size="12" icon-color="#007acc" no-hover></openp41ge-inline-icon>
 *
 * Attributes:
 *   name         — icon name from the registry
 *   size         — icon size in px (default 12). Total box = size + 4.
 *   hover-color  — 'accent' (blue) | 'danger' (red) | 'muted' (grey, default)
 *   no-hover     — when present, disables the hover background effect
 *   icon-color   — CSS colour for the icon (default: inherit / currentColor)
 *   bg           — static background colour (overrides hover; square always shows this colour)
 */

import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import type { IconName } from "./openp41ge-icon";
import "./openp41ge-icon";

type HoverColor = "accent" | "danger" | "muted";

const HOVER_BG: Record<HoverColor, string> = {
  accent: "rgba(0,122,204,0.15)",
  danger: "rgba(229,62,62,0.15)",
  muted: "rgba(128,128,128,0.15)",
};

export class Openp41geInlineIcon extends LitElement {
  createRenderRoot() {
    return this.attachShadow({ mode: "open" });
  }

  @property({ type: String })
  name: IconName = "plus";

  @property({ type: Number })
  size: number = 12;

  @property({ attribute: "hover-color", type: String })
  hoverColor: HoverColor = "muted";

  @property({ attribute: "no-hover", type: Boolean })
  noHover: boolean = false;

  @property({ attribute: "icon-color", type: String })
  iconColor: string = "";

  @property({ attribute: "bg", type: String })
  bg: string = "";

  private _hoverBg = "transparent";

  private get _box(): number {
    return this.size + 4;
  }

  private get _bg(): string {
    if (this.bg) return this.bg;
    return this._hoverBg;
  }

  private _onEnter(): void {
    if (this.noHover || this.bg) return;
    this._hoverBg = HOVER_BG[this.hoverColor];
    this.requestUpdate();
  }

  private _onLeave(): void {
    if (this.noHover || this.bg) return;
    this._hoverBg = "transparent";
    this.requestUpdate();
  }

  render() {
    const box = this._box;
    const iconStyle = this.iconColor ? `color:${this.iconColor};` : "";
    return html`
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: ${box}px;
          height: ${box}px;
          border-radius: 3px;
          cursor: pointer;
          transition: background 0.1s;
          background: ${this._bg};
          box-sizing: border-box;
          ${iconStyle}
        }
        ::slotted(*) {
          display: none;
        }
      </style>
      <openp41ge-icon
        @mouseenter=${this._onEnter}
        @mouseleave=${this._onLeave}
        name=${this.name}
        size=${this.size}
      ></openp41ge-icon>
    `;
  }
}

if (!customElements.get("openp41ge-inline-icon")) {
  customElements.define("openp41ge-inline-icon", Openp41geInlineIcon);
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-inline-icon": Openp41geInlineIcon;
  }
}
