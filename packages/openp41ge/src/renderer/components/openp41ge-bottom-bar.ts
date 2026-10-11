/**
 * <openp41ge-bottom-bar> — unified bottom bar for file viewer tabs (Lit).
 *
 * Left section: position ("Line 1"), mode ("Preview" / "Edit").
 * Right section: action buttons (format, custom), file size.
 *
 * Lit conversion of the vanilla HTMLElement version.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";

export interface BottomBarButton {
  id: string;
  icon: string;
  title?: string;
  onClick: () => void;
  visible?: () => boolean;
}

class Openp41geBottomBar extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  @state() private _positionText = "Line 1";
  @state() private _modeText = "";
  @state() private _modeColor = "#888";
  @state() private _sizeText = "";
  @state() private _hasFormatter = false;
  @state() private _emptyMessage: string | null = null;
  @state() private _buttons: BottomBarButton[] = [];
  private _formatterHandler: (() => void) | null = null;

  // ═══ Public API ──────────────────────────────────────────────────────

  setPosition(text: string): void {
    this._positionText = text;
  }

  setMode(text: string, color?: string): void {
    this._modeText = text;
    this._modeColor = color ?? "#888";
  }

  setSize(text: string): void {
    this._sizeText = text;
  }

  setFormatter(handler: () => void): void {
    this._formatterHandler = handler;
    this._hasFormatter = handler !== null;
  }

  clearFormatter(): void {
    this._formatterHandler = null;
    this._hasFormatter = false;
  }

  showEmpty(message: string): void {
    this._emptyMessage = message;
  }

  restore(): void {
    this._emptyMessage = null;
  }

  addButton(btn: BottomBarButton): void {
    if (this._buttons.some((b) => b.id === btn.id)) return;
    this._buttons = [...this._buttons, btn];
  }

  removeButton(id: string): void {
    this._buttons = this._buttons.filter((b) => b.id !== id);
  }

  destroy(): void {
    this._buttons = [];
    this._formatterHandler = null;
    this._hasFormatter = false;
  }

  private _isVisible(btn: BottomBarButton): boolean {
    return !btn.visible || btn.visible();
  }

  // ═══ Template ────────────────────────────────────────────────────────

  render(): TemplateResult {
    return html`
      <div
        class="flex shrink-0 items-center bg-bg-secondary border-t border-divider px-2 gap-2 text-xs text-secondary"
        style="height:34px;box-sizing:border-box"
      >
        ${
          this._emptyMessage !== null
            ? html`<span class="text-muted text-xs">${this._emptyMessage}</span>`
            : html`
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="sbb-position text-secondary text-xs not-italic"
                    >${this._positionText}</span
                  >
                  <span class="sbb-mode text-xs not-italic" style="color:${this._modeColor};"
                    >${this._modeText}</span
                  >
                </div>
                <div class="flex items-stretch gap-2 h-6">
                  ${
                    this._hasFormatter
                      ? html`
                          <div
                            class="sbb-format-btn shrink-0 min-w-7 h-6 grid place-items-center px-2 bg-transparent text-muted opacity-50 border-none box-border select-none transition-[background,color,opacity] duration-100"
                            style="-webkit-app-region:no-drag"
                            title="Format document"
                            @click=${() => this._formatterHandler?.()}
                            @mouseenter=${(e: MouseEvent) => {
                              const el = e.currentTarget as HTMLElement;
                              el.classList.add("bg-hover", "text-primary", "opacity-100");
                            }}
                            @mouseleave=${(e: MouseEvent) => {
                              const el = e.currentTarget as HTMLElement;
                              el.classList.remove("bg-hover", "text-primary", "opacity-100");
                            }}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.3"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              class="block w-4 h-4"
                            >
                              <path d="M5 4L3 8l2 4"></path>
                              <path d="M11 4l2 4-2 4"></path>
                              <path d="M9 3l-2 10"></path>
                            </svg>
                          </div>
                        `
                      : ""
                  }
                  ${this._buttons.map(
                    (btn) => html`
                      <div
                        class="sbb-custom-btn shrink-0 min-w-7 h-6 place-items-center px-2 bg-transparent text-muted opacity-50 border-none box-border select-none transition-[background,color,opacity] duration-100"
                        style="-webkit-app-region:no-drag;display:${this._isVisible(btn) ? "grid" : "none"};"
                        title=${btn.title ?? ""}
                        @click=${() => btn.onClick()}
                        @mouseenter=${(e: MouseEvent) => {
                          const el = e.currentTarget as HTMLElement;
                          el.classList.add("bg-hover", "text-primary", "opacity-100");
                        }}
                        @mouseleave=${(e: MouseEvent) => {
                          const el = e.currentTarget as HTMLElement;
                          el.classList.remove("bg-hover", "text-primary", "opacity-100");
                        }}
                      >
                        ${btn.icon}
                      </div>
                    `,
                  )}
                  <span class="sbb-size text-muted text-xs flex items-center h-full not-italic"
                    >${this._sizeText}</span
                  >
                </div>
              `
        }
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-bottom-bar")) {
  customElements.define("openp41ge-bottom-bar", Openp41geBottomBar);
}

export { Openp41geBottomBar };
