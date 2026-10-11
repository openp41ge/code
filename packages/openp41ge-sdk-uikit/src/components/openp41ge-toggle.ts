/**
 * <openp41ge-toggle> — reusable switch/toggle control for settings surfaces.
 *
 * Renders a hidden checkbox + track/thumb switch with a state label. Extracted
 * from the Editor settings tab so other settings (e.g. the Logs debug-logging
 * card) can reuse it. Example:
 *
 * ```html
 * <openp41ge-toggle .checked=${on} .onLabel="Yes" .offLabel="No"
 *   @change=${(e) => console.log(e.detail.checked)}></openp41ge-toggle>
 * ```
 *
 * Properties:
 *  - `checked`  (Boolean, reflected) — current on/off state.
 *  - `onLabel`  (String, default "On") — label shown when on.
 *  - `offLabel` (String, default "Off") — label shown when off.
 *  - `label`    (String) — accessible name (aria-label) for the control.
 *
 * Events (bubbling, composed):
 *  - `change` — fired when the user toggles. `detail.checked` is the new state.
 */

import { LitElement, html, css } from "lit";
import { property } from "lit/decorators.js";

export class Openp41geToggle extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .toggle input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .track {
      width: 34px;
      height: 18px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.18);
      position: relative;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .toggle input:checked + .track {
      background: var(--accent, #007acc);
    }
    .track::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #e0e0e0;
      transition: transform 0.15s;
    }
    .toggle input:checked + .track::after {
      transform: translateX(16px);
    }
    .label {
      min-width: 28px;
      color: var(--text-primary, #e0e0e0);
    }
  `;

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: String }) onLabel = "On";
  @property({ type: String }) offLabel = "Off";
  @property({ type: String }) label = "";

  private _onChange(e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    this.checked = checked;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { checked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render(): ReturnType<typeof html> {
    return html`
      <label class="toggle">
        <input
          type="checkbox"
          .checked=${this.checked}
          aria-label=${this.label || "toggle"}
          @change=${this._onChange}
        />
        <span class="track"></span>
        <span class="label">${this.checked ? this.onLabel : this.offLabel}</span>
      </label>
    `;
  }
}

if (!customElements.get("openp41ge-toggle")) {
  customElements.define("openp41ge-toggle", Openp41geToggle);
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-toggle": Openp41geToggle;
  }
}
