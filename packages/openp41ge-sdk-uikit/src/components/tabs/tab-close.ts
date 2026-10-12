/**
 * <tab-close> — the close button of a tab handle. Every tab bar uses it (the
 * grid's tab bars, the workspace sidebars, the manager window's tab bar and
 * the Logs window's sidebar), so they all look the same.
 *
 * A full-height, square button (34px, the tab's height) with the ✕ drawn in
 * the UI font: an inherited font (e.g. the Logs window's monospace) would
 * change its size and stroke weight, and an italic title (a preview tab)
 * would slant it. The glyph sits low in its line box, so it is lifted 1px.
 * It greys on hover, brighter on the active tab (`active`).
 *
 * The host takes the tab bar's own class and attributes (e.g. `tab-close`,
 * `data-close-tab-id`), which its click handling and styles select on.
 */

import { LitElement, css, html } from "lit";

export class TabClose extends LitElement {
  static override properties = {
    active: { type: Boolean, reflect: true },
  };

  /** The button's tab is the active one (a brighter hover). */
  declare active: boolean;

  constructor() {
    super();
    this.active = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    if (!this.hasAttribute("aria-label")) this.setAttribute("aria-label", "Close tab");
  }

  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      border-radius: 0;
      color: #666;
      cursor: pointer;
      transition:
        background 0.15s,
        color 0.15s;
    }
    :host(:hover) {
      background: var(--border-divider, #2d2d2d);
      color: #fff;
    }
    :host([active]:hover) {
      background: var(--bg-hover-strong, #444);
      color: #fff;
    }
    .x {
      display: block;
      font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 13px;
      font-style: normal;
      line-height: 1;
      transform: translateY(-1px);
    }
  `;

  override render() {
    return html`<span class="x" aria-hidden="true">✕</span>`;
  }
}

if (!customElements.get("tab-close")) customElements.define("tab-close", TabClose);

declare global {
  interface HTMLElementTagNameMap {
    "tab-close": TabClose;
  }
}
