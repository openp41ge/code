/**
 * <openp41ge-select> — a dropdown drawn by the toolkit instead of the native
 * <select>, so its list matches the app: a trigger showing the chosen
 * option's label, and a list as wide as the element. Example:
 *
 * ```html
 * <openp41ge-select .options=${[{ value: "a", label: "Alpha" }]} .value=${"a"}
 *   @change=${(e) => console.log(e.detail.value)}></openp41ge-select>
 * ```
 *
 * Properties:
 *  - `options`     ({ value: string; label: string }[]) — the choices, in order.
 *  - `value`       (String) — the chosen option's value.
 *  - `placeholder` (String) — shown when no option has `value`.
 *  - `label`       (String) — accessible name (aria-label) for the control.
 *  - `disabled`    (Boolean, reflected) — shown but not changeable.
 *  - `noTab`       (Boolean, reflected as `no-tab`) — out of the tab order
 *                  (still clickable), with no focus ring.
 *  - `alignTo`     (String) — a selector: the list lines up with (is as wide
 *                  as) the closest ancestor matching it, else with the element.
 *
 * Click, or ArrowDown / Enter / Space, opens the list; the arrows move,
 * Enter chooses, Escape, Tab, a press outside or a scroll closes it.
 *
 * The trigger is the `trigger` part (`::part(trigger)`).
 *
 * Events (bubbling, composed):
 *  - `change` — fired when the user chooses an option. `detail.value` is its value.
 */

import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** The list's tallest height before it scrolls (px). */
const LIST_MAX_HEIGHT = 240;

const CHEVRON = html`<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
  <path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z" />
</svg>`;

export class Openp41geSelect extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    .trigger {
      box-sizing: border-box;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: var(--select-padding, 5px 8px);
      border: none;
      border-radius: 4px;
      background: var(--select-bg, transparent);
      color: var(--text-primary, #ddd);
      font: inherit;
      font-size: inherit;
      text-align: left;
      cursor: pointer;
    }
    .trigger:focus {
      outline: none;
    }
    .trigger:focus-visible {
      box-shadow: inset 0 0 0 1px var(--accent, #569cd6);
    }
    :host([no-tab]) .trigger:focus-visible {
      box-shadow: none;
    }
    :host([disabled]) .trigger {
      cursor: default;
      opacity: 0.6;
    }
    .text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .placeholder {
      color: var(--text-secondary, #999);
    }
    .chevron {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      color: var(--text-secondary, #999);
    }
    .list {
      position: fixed;
      z-index: 10000;
      box-sizing: border-box;
      max-height: ${LIST_MAX_HEIGHT}px;
      overflow-y: auto;
      margin: 0;
      padding: 4px 0;
      border: 1px solid var(--border-color, #3a3a3a);
      border-radius: 8px;
      background: var(--bg-tertiary, #2a2a2a);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      list-style: none;
    }
    .option {
      padding: 6px 7px;
      color: var(--text-primary, #ddd);
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .option.active {
      background: color-mix(in srgb, var(--text-primary, #ddd) 10%, transparent);
    }
    .option[aria-selected="true"] {
      color: var(--accent, #569cd6);
    }
  `;

  @property({ attribute: false }) options: readonly SelectOption[] = [];
  @property({ type: String }) value = "";
  @property({ type: String }) placeholder = "";
  @property({ type: String }) label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true, attribute: "no-tab" }) noTab = false;
  @property({ type: String, attribute: "align-to" }) alignTo = "";

  @state() private _open = false;
  /** The highlighted option's index while open. */
  @state() private _active = -1;
  /** The list's fixed position, from the element's box when it opened. */
  private _place: Record<string, string> = {};

  private readonly _onOutside = (e: Event): void => {
    if (!e.composedPath().includes(this)) this._close();
  };
  private readonly _onScroll = (e: Event): void => {
    // The list's own scrolling keeps it open; anything else moves the element.
    if (!e.composedPath().includes(this)) this._close();
  };
  private readonly _onResize = (): void => this._close();

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unlisten();
  }

  private get _chosen(): number {
    return this.options.findIndex((o) => o.value === this.value);
  }

  private _openList(): void {
    if (this.disabled || this._open || this.options.length === 0) return;
    const box = ((this.alignTo && this.closest(this.alignTo)) || this).getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    const above = box.top > below && below < LIST_MAX_HEIGHT;
    this._place = {
      left: `${box.left}px`,
      width: `${box.width}px`,
      ...(above
        ? { bottom: `${window.innerHeight - box.top + 2}px` }
        : { top: `${box.bottom + 2}px` }),
    };
    this._active = Math.max(0, this._chosen);
    this._open = true;
    document.addEventListener("pointerdown", this._onOutside, true);
    window.addEventListener("scroll", this._onScroll, true);
    window.addEventListener("resize", this._onResize);
  }

  private _close(): void {
    if (!this._open) return;
    this._open = false;
    this._unlisten();
  }

  private _unlisten(): void {
    document.removeEventListener("pointerdown", this._onOutside, true);
    window.removeEventListener("scroll", this._onScroll, true);
    window.removeEventListener("resize", this._onResize);
  }

  private _choose(i: number): void {
    const option = this.options[i];
    this._close();
    if (!option) return;
    this.value = option.value;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: option.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onKeydown(e: KeyboardEvent): void {
    if (this.disabled) return;
    if (!this._open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        this._openList();
      }
      return;
    }
    const last = this.options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this._active = Math.min(last, this._active + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        this._active = Math.max(0, this._active - 1);
        break;
      case "Home":
        e.preventDefault();
        this._active = 0;
        break;
      case "End":
        e.preventDefault();
        this._active = last;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        this._choose(this._active);
        break;
      case "Escape":
        e.preventDefault();
        this._close();
        break;
      case "Tab":
        this._close();
        break;
    }
  }

  protected updated(): void {
    if (!this._open) return;
    const active = this.renderRoot.querySelector<HTMLElement>(".option.active");
    active?.scrollIntoView?.({ block: "nearest" });
  }

  render(): TemplateResult {
    const chosen = this.options[this._chosen];
    return html`
      <button
        type="button"
        class="trigger"
        part="trigger"
        tabindex=${this.noTab ? "-1" : nothing}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded=${this._open ? "true" : "false"}
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
        @click=${() => (this._open ? this._close() : this._openList())}
        @keydown=${this._onKeydown}
      >
        ${
          chosen
            ? html`<span class="text">${chosen.label}</span>`
            : html`<span class="text placeholder">${this.placeholder}</span>`
        }
        <span class="chevron">${CHEVRON}</span>
      </button>
      ${
        this._open
          ? html`<ul
              class="list"
              role="listbox"
              aria-label=${this.label || nothing}
              style=${Object.entries(this._place)
                .map(([k, v]) => `${k}:${v}`)
                .join(";")}
            >
              ${this.options.map(
                (o, i) =>
                  html`<li
                    class="option ${i === this._active ? "active" : ""}"
                    role="option"
                    aria-selected=${o.value === this.value ? "true" : "false"}
                    @pointerenter=${() => (this._active = i)}
                    @click=${() => this._choose(i)}
                  >
                    ${o.label}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
    `;
  }
}

if (!customElements.get("openp41ge-select")) {
  customElements.define("openp41ge-select", Openp41geSelect);
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-select": Openp41geSelect;
  }
}
