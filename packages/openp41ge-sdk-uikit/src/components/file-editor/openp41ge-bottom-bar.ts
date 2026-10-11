/**
 * <fe-status-bar> — unified bottom bar for file editor tabs (Lit).
 *
 * Left section: dirty state / file size.
 * Right section: format button, custom buttons, word wrap toggle.
 *
 * Dirty state: when the file has unsaved changes, the file size shows
 * "Modified" in yellow. After save it reverts to showing the file size.
 * The dirty indicator circle (●) is shown on the tab handle instead.
 *
 * This is a LitElement with light DOM for backward compatibility.
 * Public API methods (setSize, setDirty, etc.) are facades that
 * update internal @state properties, triggering targeted re-renders.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { tooltipContent } from "../tooltip";

// Compact inline glyphs for the find toggles — kept as text so they read
// clearly at 11px (same intent as the Git sidebar's regex/match-case icons).
// The find-entry search icon is the same Material magnifier+list glyph used by
// the Explorer sidebar's `searchIcon` (kept inline so the uikit package stays
// independent of the renderer).
const ICON_FIND =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="20" height="20" fill="currentColor"><path d="M80-200v-80h400v80H80Zm0-200v-80h200v80H80Zm0-200v-80h200v80H80Zm744 400L670-354q-24 17-52.5 25.5T560-320q-83 0-141.5-58.5T360-520q0-83 58.5-141.5T560-720q83 0 141.5 58.5T760-520q0 29-8.5 57.5T726-410l154 154-56 56ZM560-400q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z"/></svg>';
const ICON_REGEX =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><text x="0.5" y="11" font-size="11" font-family="Consolas,monospace" font-weight="600">.*</text></svg>';
const ICON_CASE =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><text x="0.5" y="10.5" font-size="10.5" font-family="sans-serif" font-weight="700">Aa</text></svg>';
const ICON_WORD =
  '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><rect x="1" y="2" width="11" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1"/><text x="6.5" y="10" text-anchor="middle" font-size="7.5" font-family="sans-serif" font-weight="700">ab</text></svg>';

export interface BottomBarButton {
  id: string;
  icon: string;
  title?: string;
  onClick: () => void;
  visible?: () => boolean;
}

class FeStatusBar extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  /**
   * Skip rendering when the element is disconnected from the DOM.
   * Prevents "ChildPart has no parentNode" errors when pending
   * @state updates fire after the element has been removed during
   * grid re-renders (e.g., tab switching).
   */
  protected update(changedProperties: Map<string | number | symbol, unknown>): void {
    if (!this.isConnected) return;
    super.update(changedProperties);
  }

  // Reactive internal state — updated by public API methods
  @state() private _sizeText = "";
  @state() private _isDirty = false;
  @state() private _infoText = "";
  @state() private _hasFormatter = false;
  @state() private _wordWrapOn = false;
  @state() private _emptyMessage: string | null = null;
  @state() private _buttons: BottomBarButton[] = [];
  private _formatterHandler: (() => void) | null = null;
  private _wordWrapHandler: ((enabled: boolean) => void) | null = null;

  // ═══ Public API ─────────────────────────────────────────────────────

  setSize(text: string): void {
    this._sizeText = text;
  }

  /** Right-aligned info label (e.g. the short commit ID in the commit-file
   * diff). Sits immediately LEFT of the bottom-bar icons. Pass ""/null to
   * remove it. */
  setInfo(text: string | null): void {
    this._infoText = text ?? "";
  }

  setDirty(isDirty: boolean): void {
    this._isDirty = isDirty;
  }

  setWordWrap(enabled: boolean, handler: (enabled: boolean) => void): void {
    this._wordWrapOn = enabled;
    this._wordWrapHandler = handler;
  }

  updateWordWrapState(enabled: boolean): void {
    this._wordWrapOn = enabled;
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
    // Append at the end (before the size element, which is always last)
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

  // ═══ Find strip (in-editor search, Cmd/Ctrl+F) ─────────────────────────

  @state() private _findOpen = false;
  @state() private _findValue = "";
  @state() private _findCount = "";
  @state() private _findRegex = false;
  @state() private _findCase = false;
  @state() private _findWholeWord = false;

  /** User clicked the (closed-state) find entry icon. */
  onFindOpen: (() => void) | null = null;
  onFindInput: ((value: string) => void) | null = null;
  onFindNext: (() => void) | null = null;
  onFindPrev: (() => void) | null = null;
  onFindClose: (() => void) | null = null;
  onFindRegex: ((on: boolean) => void) | null = null;
  onFindCase: ((on: boolean) => void) | null = null;
  onFindWholeWord: ((on: boolean) => void) | null = null;

  openFind(): void {
    this._findOpen = true;
  }

  closeFind(): void {
    this._findOpen = false;
  }

  focusFind(): void {
    const input = this.querySelector<HTMLInputElement>("[data-testid=fe-find-input]");
    input?.focus();
    input?.select();
  }

  setFindCount(text: string): void {
    this._findCount = text;
  }

  private _onEntryClick = (): void => {
    // The bottom bar carries only the icon — it toggles the full-width find
    // bar that sits above the status bar.
    if (this._findOpen) {
      this.closeFind();
      this.onFindClose?.();
    } else {
      this.onFindOpen?.();
    }
  };

  private _onInput = (e: InputEvent): void => {
    const value = (e.target as HTMLInputElement).value;
    this._findValue = value;
    this.onFindInput?.(value);
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        this.onFindPrev?.();
      } else {
        this.onFindNext?.();
      }
    } else if (e.key === "Escape") {
      this.closeFind();
      this.onFindClose?.();
    }
  };

  private _toggleRegex = (): void => {
    this._findRegex = !this._findRegex;
    this.onFindRegex?.(this._findRegex);
  };

  private _toggleCase = (): void => {
    this._findCase = !this._findCase;
    this.onFindCase?.(this._findCase);
  };

  private _toggleWholeWord = (): void => {
    this._findWholeWord = !this._findWholeWord;
    this.onFindWholeWord?.(this._findWholeWord);
  };

  /** One icon toggle for the find strip (regex / case) — Git-sidebar style. */
  private _findToggle(
    icon: string,
    title: string,
    active: boolean,
    testId: string,
    onClick: () => void,
  ): TemplateResult {
    return html`
      <button
        type="button"
        data-testid=${testId}
        title=${title}
        style="flex-shrink:0;width:16px;height:16px;display:grid;place-items:center;padding:0;cursor:pointer;background:transparent;border:1px solid transparent;border-radius:3px;color:${active ? "#4a9eff" : "var(--fe-secondary-color,#888)"};"
        @click=${onClick}
      >
        ${unsafeHTML(icon)}
      </button>
    `;
  }

  private _isVisible(btn: BottomBarButton): boolean {
    return !btn.visible || btn.visible();
  }

  // ═══ Template ──────────────────────────────────────────────────────

  render(): TemplateResult {
    return html`
      <div
        class="sbb-stack"
        style="position:relative;display:flex;flex-direction:column;flex-shrink:0;"
      >
        ${
          this._findOpen
            ? html`
                <div
                  class="fe-find-bar"
                  style="position:relative;display:flex;flex-shrink:0;align-items:center;gap:8px;height:28px;padding:0 8px;background:var(--fe-gutter-bg,#1e1e1e);border-top:1px solid var(--fe-border-color,#2a2a2a);font-size:11px;color:var(--fe-secondary-color,#888);"
                >
                  <!-- The find field lives HERE — a second bar just above the
                       status bar — and spans the full editor width (flex:1). -->
                  <input
                    class="fe-find-input"
                    data-testid="fe-find-input"
                    type="text"
                    placeholder="Find in file"
                    spellcheck="false"
                    .value=${this._findValue}
                    style="flex:1 1 auto;min-width:0;height:100%;padding:0;box-sizing:border-box;background:transparent;border:none;border-radius:0;color:var(--fe-primary-color,#ccc);font-size:12px;font-family:inherit;outline:none;"
                    @input=${this._onInput}
                    @keydown=${this._onKeyDown}
                  />
                  ${
                    this._findCount
                      ? html`<span
                          class="fe-find-count"
                          style="flex-shrink:0;color:var(--fe-secondary-color,#888);font-size:11px;"
                          >${this._findCount}</span
                        >`
                      : ""
                  }
                  ${this._findToggle(ICON_REGEX, "Regex search", this._findRegex, "fe-find-regex", this._toggleRegex)}
                  ${this._findToggle(ICON_CASE, "Match case", this._findCase, "fe-find-case", this._toggleCase)}
                  ${this._findToggle(ICON_WORD, "Whole word", this._findWholeWord, "fe-find-whole-word", this._toggleWholeWord)}
                </div>
              `
            : ""
        }
        <div
          class="sbb-row"
          style="position:relative;display:flex;flex-shrink:0;align-items:center;height:34px;background:var(--bg-secondary, #161616);border-top:1px solid var(--fe-border-color, #2a2a2a);padding:0 0 0 8px;gap:8px;font-size:11px;color:var(--fe-secondary-color, #888);"
        >
          ${
            this._emptyMessage !== null
              ? html`<span style="color:#666;font-size:11px;">${this._emptyMessage}</span>`
              : html`
                  <div
                    style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;"
                  >
                    <span
                      class="sbb-size"
                      style="color:${this._isDirty ? "#e2b714" : "#777"};font-size:11px;display:flex;align-items:center;font-style:normal;"
                      >${this._sizeText}${this._isDirty ? html`<span style="color:#e2b714;margin-left:4px;">Modified</span>` : ""}</span
                    >
                    <!-- Find entry icon — the bottom bar carries ONLY the icon;
                       the field lives in the full-width find bar above. -->
                    <button
                      type="button"
                      class="p41ge-icon-btn fe-find-entry${this._findOpen ? " is-active" : ""}"
                      data-cap-side="both"
                      data-testid="fe-find-entry"
                      aria-label="Find in file (⌘F when focused)"
                      ${tooltipContent({ type: "simple", text: "Find in file (⌘F when focused)" })}
                      style="-webkit-app-region:no-drag;"
                      @click=${this._onEntryClick}
                    >
                      ${unsafeHTML(ICON_FIND)}
                    </button>
                  </div>
                  ${
                    this._infoText
                      ? html`<span
                          class="sbb-info"
                          style="flex-shrink:0;color:#9a9a9a;font-size:11px;font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace;white-space:nowrap;"
                          >${this._infoText}</span
                        >`
                      : ""
                  }
                  <div style="display:flex;align-items:stretch;height:100%;">
                    ${
                      this._hasFormatter
                        ? html`
                            <div
                              class="p41ge-icon-btn sbb-format-btn"
                              data-cap-side="left"
                              aria-label="Format document"
                              ${tooltipContent({ type: "simple", text: "Format document" })}
                              style="-webkit-app-region:no-drag;"
                              @click=${() => this._formatterHandler?.()}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 -960 960 960"
                                fill="currentColor"
                                style="display:block;width:16px;height:16px;"
                              >
                                <path
                                  d="M240-280 40-480l200-200 56 56-143 144 143 144-56 56Zm178 132-76-24 200-640 76 24-200 640Zm302-132-56-56 143-144-143-144 56-56 200 200-200 200Z"
                                ></path>
                              </svg>
                            </div>
                          `
                        : ""
                    }
                    ${this._buttons.map(
                      (btn) => html`
                        <div
                          class="p41ge-icon-btn sbb-custom-btn"
                          data-btn-id=${btn.id}
                          style="-webkit-app-region:no-drag;display:${this._isVisible(btn) ? "inline-flex" : "none"};"
                          title=${btn.title ?? ""}
                          @click=${() => btn.onClick()}
                        >
                          ${unsafeHTML(btn.icon)}
                        </div>
                      `,
                    )}
                    <!-- Word wrap toggle -->
                    <div
                      class="p41ge-icon-btn sbb-wrap-btn${this._wordWrapOn ? " is-active" : ""}"
                      aria-label="Toggle line wrap"
                      ${tooltipContent({ type: "simple", text: "Toggle line wrap" })}
                      style="-webkit-app-region:no-drag;box-sizing:content-box;padding:0 var(--grid-edge-right-pad, 0px) 0 0;"
                      @click=${() => {
                        const newState = !this._wordWrapOn;
                        this._wordWrapOn = newState;
                        this._wordWrapHandler?.(newState);
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
                        style="display:block;width:16px;height:16px;"
                      >
                        <path d="M2 4h12" />
                        <path d="M2 8h8" />
                        <path d="M2 12h6" />
                        <path d="M13 10l2 2-2 2" />
                        <path d="M15 12h-5" />
                      </svg>
                    </div>
                  </div>
                `
          }
        </div>
      </div>
    `;
  }
}

if (!customElements.get("fe-status-bar")) {
  customElements.define("fe-status-bar", FeStatusBar);
}

export { FeStatusBar };
