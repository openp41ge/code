/**
 * <tab-bar> — renders tab buttons with drag support, close buttons,
 * and drop indicator.
 *
 * Light DOM for compatibility with elementFromPoint in the orchestrator.
 * Manages its own TabBarDropTarget internally.
 */

import { LitElement, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { TabBarDropTarget } from "openp41ge-core-tabs/targets/tab-bar-drop-target";
import { getDropIndexInBar, getTabButtonsInBar } from "openp41ge-core-tabs/boundary";

/** Scroll speed for overflowing tab text (pixels per second). */
const TAB_TEXT_SCROLL_SPEED = 40;

/** Fixed pause at each end of the slide (seconds). */
const TAB_SCROLL_PAUSE = 0.5;

export class TabBar extends LitElement {
  @property({ type: Array }) tabIds: string[] = [];
  @property({ type: Object }) tabs: Record<
    string,
    {
      title: string;
      pinned?: boolean;
      ephemeral?: boolean;
      ephemeralPinned?: boolean;
      /** Optional prefix icon (SVG markup) rendered before the tab title. */
      icon?: string;
      /** Optional muted text after the title and a dot (e.g. a worktree tab's repository). */
      description?: string;
    }
  > = {};
  @property({ type: String }) activeTabId: string = "";
  @property({ type: String }) winId: string = "";
  @property({ type: Number }) col: number = 0;
  @property({ type: Boolean }) focused: boolean = false;
  /** With `focused`, the active tab shows the focus line. Cleared by the host
   *  while the window is blurred or its focus is elsewhere. */
  @property({ type: Boolean }) focusVisible: boolean = true;
  /** When true, render a trailing “＋” button (right end of the bar) that
   *  bubbles a `tab-bar-add` event so the host can open a new tab. Opt-in:
   *  the workspace grid does not set it, so it stays out of the way there. */
  @property({ type: Boolean }) showAdd: boolean = false;

  /** Local override for ephemeral pin state — set optimistically on click,
   *  cleared when the workspace state confirms via updated `tabs` property. */
  private _localEphemeralPinned: Record<string, boolean> = {};

  private _dropTarget: TabBarDropTarget | null = null;
  private _indicatorEl: HTMLElement | null = null;
  private _fadeLeftEl: HTMLElement | null = null;
  private _fadeRightEl: HTMLElement | null = null;

  /** Expose the internal drop target for the orchestrator's target resolver. */
  get dropTarget(): TabBarDropTarget | null {
    return this._dropTarget;
  }

  /** The underlying bar container element. */
  get barElement(): HTMLElement | null {
    return (this.renderRoot?.querySelector(".tab-bar-container") as HTMLElement) ?? null;
  }

  /** A tab's title scroll: the title's animation, and its icon's (they move together). */
  private _scrollAnimations = new WeakMap<HTMLElement, Animation[]>();

  disconnectedCallback(): void {
    super.disconnectedCallback();
    const barEl = this.barElement;
    if (barEl) {
      barEl.removeEventListener("scroll", this);
    }
  }

  createRenderRoot() {
    return this; // Light DOM
  }

  firstUpdated() {
    const barEl = this.barElement;
    if (barEl) {
      this._dropTarget = new TabBarDropTarget(barEl, this.winId, this.col);
      this._setupIndicator(barEl);
    }
    this._fadeLeftEl =
      (this.renderRoot?.querySelector(".tab-bar-fade-left") as HTMLElement) ?? null;
    this._fadeRightEl =
      (this.renderRoot?.querySelector(".tab-bar-fade-right") as HTMLElement) ?? null;
    this._updateFades();
    barEl?.addEventListener("scroll", this);
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("winId") || changedProperties.has("col")) {
      const barEl = this.barElement;
      if (barEl) {
        this._dropTarget = new TabBarDropTarget(barEl, this.winId, this.col);
      }
    }
    if (changedProperties.has("tabIds")) {
      // Re-evaluate fade visibility after tab list changes
      requestAnimationFrame(() => this._updateFades());
    }
    if (changedProperties.has("activeTabId") && this.activeTabId) {
      requestAnimationFrame(() => this._scrollToTab(this.activeTabId));
    }
    if (changedProperties.has("tabs")) {
      // Clean up local overrides for tabs that no longer exist
      for (const id of Object.keys(this._localEphemeralPinned)) {
        if (!(id in this.tabs)) {
          delete this._localEphemeralPinned[id];
        }
      }
    }
  }

  /** @deprecated Use scrollToTab instead. */
  private _scrollToTab(tabId: string): void {
    this.scrollToTab(tabId);
  }

  // ── Scroll fade management ───────────────────────────────────────────-

  /**
   * Event listener interface: called by addEventListener("scroll", this)
   * because TabBar implements EventListener (has handleEvent).
   */
  handleEvent(_e: Event): void {
    this._updateFades();
  }

  private _updateFades(): void {
    const barEl = this.barElement;
    if (!barEl || !this._fadeLeftEl || !this._fadeRightEl) return;

    const canScrollLeft = barEl.scrollLeft > 0;
    const canScrollRight = barEl.scrollLeft < barEl.scrollWidth - barEl.clientWidth - 1;

    this._fadeLeftEl.classList.toggle("tab-bar-fade-visible", canScrollLeft);
    this._fadeRightEl.classList.toggle("tab-bar-fade-visible", canScrollRight);
  }

  // ── Tab text scroll animation ────────────────────────────────────────

  /** Scroll the tab bar so the tab with the given id is visible. */
  scrollToTab(tabId: string): void {
    requestAnimationFrame(() => {
      const barEl = this.barElement;
      if (!barEl) return;
      const tabBtn = barEl.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null;
      if (!tabBtn) return;

      const containerRect = barEl.getBoundingClientRect();
      const tabRect = tabBtn.getBoundingClientRect();

      // Tab is already fully visible
      if (tabRect.left >= containerRect.left && tabRect.right <= containerRect.right) return;

      const scrollOffset = tabRect.left - containerRect.left + barEl.scrollLeft - 8;
      barEl.scrollLeft = scrollOffset;
    });
  }

  private _startTextScroll(tabEl: HTMLElement): void {
    const inner = tabEl.querySelector(".tab-text-inner") as HTMLElement | null;
    if (!inner) return;

    const textWidth = inner.scrollWidth;
    const visibleWidth = inner.clientWidth;
    if (textWidth <= visibleWidth || textWidth === 0) return;

    const scrollDist = textWidth - visibleWidth + 8;

    inner.style.textOverflow = "clip";
    inner.style.overflow = "visible";

    // Cancel any existing animation on this element
    for (const a of this._scrollAnimations.get(inner) ?? []) a.cancel();

    const scrollTime = scrollDist / TAB_TEXT_SCROLL_SPEED;
    const pauseTime = TAB_SCROLL_PAUSE;
    const totalDuration = scrollTime * 2 + pauseTime * 2;

    const p1 = pauseTime / totalDuration;
    const p2 = (pauseTime + scrollTime) / totalDuration;
    const p3 = (pauseTime * 2 + scrollTime) / totalDuration;

    const keyframes: Keyframe[] = [
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(0)", offset: p1 },
      { transform: `translateX(-${scrollDist}px)`, offset: p2 },
      { transform: `translateX(-${scrollDist}px)`, offset: p3 },
      { transform: "translateX(0)", offset: 1 },
    ];
    const timing: KeyframeAnimationOptions = {
      duration: totalDuration * 1000,
      iterations: Infinity,
      easing: "linear",
    };
    // The icon scrolls with the title (the text container clips both), so
    // the text never slides under it.
    const icon = tabEl.querySelector(".tab-icon") as HTMLElement | null;
    const anims = [inner.animate(keyframes, timing)];
    if (icon) anims.push(icon.animate(keyframes, timing));
    this._scrollAnimations.set(inner, anims);
  }

  private _stopTextScroll(tabEl: HTMLElement): void {
    const inner = tabEl.querySelector(".tab-text-inner") as HTMLElement | null;
    if (!inner) return;
    const anims = this._scrollAnimations.get(inner);
    if (anims) {
      for (const a of anims) a.cancel();
      this._scrollAnimations.delete(inner);
    }
    inner.style.textOverflow = "ellipsis";
    inner.style.overflow = "hidden";
  }

  // ── Drop indicator management ─────────────────────────────────────────

  private _setupIndicator(barEl: HTMLElement) {
    if (!this._indicatorEl) {
      this._indicatorEl = document.createElement("div");
      this._indicatorEl.className = "tab-drop-indicator";
      this._indicatorEl.style.cssText =
        "position:absolute;top:0;bottom:0;width:3px;background:rgb(74,158,255);box-shadow:0 0 10px rgba(74,158,255,0.6);display:none;pointer-events:none;z-index:10;";
      barEl.style.position = "relative";
      barEl.appendChild(this._indicatorEl);
    }
  }

  /** Show the drop indicator at the position determined by clientX. */
  showDropIndicator(clientX: number) {
    const barEl = this.barElement;
    if (!barEl || !this._indicatorEl) return;

    const dropIndex = getDropIndexInBar(barEl, clientX);
    const tabs = getTabButtonsInBar(barEl);

    let pos: number;
    if (tabs.length === 0 || dropIndex <= 0) {
      pos = 0;
    } else if (dropIndex >= tabs.length) {
      const last = tabs[tabs.length - 1];
      pos = last.offsetLeft + last.offsetWidth;
    } else {
      // Shift left 1px so the 3px line is centered on the boundary (mirrors
      // the tabs package's tab-reorder indicator, so both look identical).
      pos = tabs[dropIndex].offsetLeft - 1;
    }

    this._indicatorEl.style.display = "block";
    this._indicatorEl.style.left = `${pos}px`;
  }

  /** Hide the drop indicator. */
  hideDropIndicator() {
    if (this._indicatorEl) {
      this._indicatorEl.style.display = "none";
    }
  }

  /** Get the insertion index for a given cursor clientX. */
  getInsertionIndex(clientX: number): number {
    const barEl = this.barElement;
    if (!barEl) return 0;
    return getDropIndexInBar(barEl, clientX);
  }

  /** Get a specific tab button element by tab ID. */
  getTabButton(tabId: string): HTMLElement | null {
    return (this.renderRoot?.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement) ?? null;
  }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    if (this.tabIds.length === 0) return nothing;
    return html`
      <style>
        /* A preview tab's icon slants with its italic title. On the icon's
           content, not the icon box: the text scroll animates the box's
           transform. */
        [data-preview] .tab-icon > * {
          transform: skewX(-12deg);
        }
        /* The focused tab (the active tab of the focused cell): a blue line
           across its top edge. Inset, so the tab keeps its size. */
        .tab-btn[data-focused] {
          box-shadow: inset 0 2px 0 #4a9eff;
        }
        /* The close button is full height, so its hover background would cover
           the line: it draws the line over its own background too. */
        .tab-btn[data-focused] .tab-close {
          box-shadow: inset 0 2px 0 #4a9eff;
        }
        .tab-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 6px;
          font-size: 13px;
          /* Always render the ✕ in the UI font so it is the same size in every
             window, regardless of an inherited monospace font (e.g. the Logs
             window sets monospace on its root, which would otherwise shrink
             the ✕ glyph). */
          font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
          /* The ✕ glyph must never inherit the tab's italic (unpinned tabs
             italicize their title). Always render it upright. */
          font-style: normal;
          /* Neutralize the inherited 34px line-height (from the tab) that
             pushes the glyph low; a tight line box lets flex center the ✕. */
          line-height: 1;
          color: #666;
          cursor: pointer;
          /* Full-height, square close button: spans the tab's 34px height and
             is as wide as it is tall. */
          width: 34px;
          height: 34px;
          flex-shrink: 0;
          border-radius: 0;
          transition:
            background 0.15s,
            color 0.15s;
        }
        .tab-close-x {
          display: block;
          line-height: 1;
          /* Font metrics leave the ✕ glyph low in its 20px button;
             lift just the glyph (the button itself stays put). */
          transform: translateY(-1px);
        }
        /* Background (inactive) tabs: hover matches the activated tab's grey. */
        .tab-btn .tab-close:hover {
          background: var(--border-divider, #2d2d2d);
          color: #fff;
        }
        /* Activated tab: hover uses a brightened grey. */
        .tab-btn.active .tab-close:hover {
          background: var(--bg-hover-strong, #444);
          color: #fff;
        }
        .tab-pin {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 4px;
          font-size: 11px;
          color: #666;
          cursor: pointer;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          border-radius: 4px;
          transition:
            background 0.15s,
            color 0.15s;
          opacity: 0.6;
        }
        .tab-btn:hover .tab-pin {
          opacity: 1;
          color: #999;
        }
        .tab-pin:hover {
          color: #e5c07b;
          background: rgba(229, 192, 123, 0.2);
          opacity: 1;
        }
        .tab-pin.pinned {
          color: #e5c07b;
          opacity: 1;
        }
      </style>
      <div class="tab-bar-wrapper" style="position:relative;flex:1;min-width:0;">
        <div
          class="tab-bar-container"
          style="display:flex;align-items:center;height:35px;box-sizing:border-box;border-bottom:1px solid var(--border-divider, #2d2d2d);background:var(--bg-surface, #161616);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-ms-overflow-style:none;"
        >
          <style>
            .tab-bar-container::-webkit-scrollbar {
              display: none;
              width: 0;
              height: 0;
            }
            .tab-bar-fade-left,
            .tab-bar-fade-right {
              position: absolute;
              top: 0;
              bottom: 0;
              width: 30px;
              pointer-events: none;
              z-index: 5;
              opacity: 0;
              transition: opacity 0.12s ease;
            }
            .tab-bar-fade-visible {
              opacity: 1;
            }
            .tab-bar-fade-left {
              left: 0;
              background: linear-gradient(to right, var(--tab-bar-bg, #161616), transparent);
            }
            .tab-bar-fade-right {
              right: 0;
              background: linear-gradient(to left, var(--tab-bar-bg, #161616), transparent);
            }
            .tab-bar-add {
              position: absolute;
              top: 0;
              right: 0;
              bottom: 0;
              z-index: 4;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 34px;
              flex-shrink: 0;
              color: var(--text-secondary, #999);
              font-size: 15px;
              cursor: pointer;
              user-select: none;
              background: var(--bg-surface, #161616);
              border-left: 1px solid #333;
              border-bottom: 1px solid var(--border-divider, #2d2d2d);
              transition:
                color 0.15s,
                background 0.15s;
            }
            .tab-bar-add:hover {
              color: var(--text-primary, #ccc);
              background: var(--bg-hover-strong, #444);
            }
          </style>
          ${this.tabIds.map((id) => {
            const tab = this.tabs[id];
            const isActive = id === this.activeTabId;
            const aBg = "background:var(--border-divider,#2d2d2d);color:#eee;";
            const iBg = "color:#888;";
            const isEphemeral = tab?.ephemeral ?? false;
            // Use local override if set, otherwise fall back to workspace state
            const isEphemeralPinned =
              id in this._localEphemeralPinned
                ? this._localEphemeralPinned[id]
                : (tab?.ephemeralPinned ?? false);
            const hasIcon = !!tab?.icon;
            // An unpinned (preview) tab is italic: its title, and its icon.
            const isPreview = !isEphemeral && !tab?.pinned;
            const tabStyle = [
              `display:inline-flex;align-items:center;flex-shrink:0;min-width:${hasIcon ? "calc(var(--tab-min-width,120px) + 24px)" : "var(--tab-min-width,120px)"};max-width:75%;height:34px;padding:0 0 0 8px;border-right:1px solid #333;cursor:pointer;font-size:12px;line-height:34px;user-select:none;white-space:nowrap;`,
              `font-style:${isPreview ? "italic" : "normal"};`,
              isActive && this.focused && isEphemeral
                ? isEphemeralPinned
                  ? "background:rgba(229,192,123,0.18);border-bottom:2px solid rgb(229,192,123);color:#e5c07b;"
                  : "background:rgba(229,192,123,0.12);border-bottom:2px dashed rgb(229,192,123);color:#e5c07b;"
                : isActive
                  ? aBg
                  : iBg,
            ].join("");
            return html`
              <div
                role="tab"
                class="tab-btn ${isActive ? "active" : ""}"
                data-tab-id=${id}
                ?data-preview=${isPreview}
                ?data-focused=${isActive && this.focused && this.focusVisible}
                style=${tabStyle}
                @mouseenter=${(e: MouseEvent) => this._startTextScroll(e.currentTarget as HTMLElement)}
                @mouseleave=${(e: MouseEvent) => this._stopTextScroll(e.currentTarget as HTMLElement)}
              >
                <div
                  class="tab-text-container"
                  style="flex:1;overflow:hidden;min-width:0;padding:0 0 0 8px;display:flex;align-items:center;"
                >
                  ${
                    tab?.icon
                      ? html`<span
                          class="tab-icon"
                          style="display:inline-flex;align-items:center;flex-shrink:0;margin-right:6px;line-height:1;color:inherit;"
                          >${unsafeHTML(tab.icon)}</span
                        >`
                      : nothing
                  }
                  <span
                    class="tab-text-inner"
                    style="white-space:nowrap;display:inline-block;overflow:hidden;text-overflow:ellipsis;"
                    >${tab ? tab.title : id}${
                      tab?.description
                        ? html`<span class="tab-description" style="margin-left:6px;opacity:0.55"
                            ><span
                              class="tab-description-dot"
                              style="display:inline-block;width:4px;height:4px;border-radius:50%;background:currentColor;vertical-align:middle;margin:0 6px 2px 0"
                            ></span
                            >${tab.description}</span
                          >`
                        : nothing
                    }</span
                  >
                </div>
                ${
                  isEphemeral
                    ? html`<span
                        class="flex items-center shrink-0"
                        style="display:inline-flex;align-items:center;flex-shrink:0;"
                      >
                        <span
                          class="tab-pin ${isEphemeralPinned ? "pinned" : ""}"
                          id="pin-${id}"
                          title=${isEphemeralPinned ? "Unpin tab — closes on defocus" : "Pin tab — stays open on defocus"}
                          @click=${(e: MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const newPinned = !isEphemeralPinned;
                            this._localEphemeralPinned[id] = newPinned;
                            this.requestUpdate();
                            this.dispatchEvent(
                              new CustomEvent("grid-pin", {
                                bubbles: true,
                                detail: {
                                  winId: this.winId,
                                  tabId: id,
                                  pinned: newPinned,
                                  ephemeral: true,
                                },
                              }),
                            );
                          }}
                        >
                          ${
                            isEphemeralPinned
                              ? html`<svg
                                  width="14"
                                  height="14"
                                  viewBox="0 -960 960 960"
                                  fill="currentColor"
                                >
                                  <path
                                    d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z"
                                  />
                                </svg>`
                              : html`<svg
                                  width="14"
                                  height="14"
                                  viewBox="0 -960 960 960"
                                  fill="currentColor"
                                >
                                  <path
                                    d="M680-840v80h-40v327l-80-80v-247H400v87l-87-87-33-33v-47h400ZM480-40l-40-40v-240H240v-80l80-80v-46L56-792l56-56 736 736-58 56-264-264h-6v240l-40 40ZM354-400h92l-44-44-2-2-46 46Zm126-193Zm-78 149Z"
                                  />
                                </svg>`
                          }
                        </span>
                        <span class="tab-close" data-close-tab-id=${id}
                          ><span class="tab-close-x">✕</span></span
                        >
                      </span>`
                    : html`<span class="tab-close" data-close-tab-id=${id}
                        ><span class="tab-close-x">✕</span></span
                      >`
                }
              </div>
            `;
          })}
        </div>
        <div class="tab-bar-fade-left"></div>
        <div class="tab-bar-fade-right"></div>
        ${
          this.showAdd
            ? html`
                <div
                  class="tab-bar-add"
                  title="Add a log stream tab"
                  @click=${(e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.dispatchEvent(
                      new CustomEvent("tab-bar-add", {
                        bubbles: true,
                        detail: { winId: this.winId, col: this.col },
                      }),
                    );
                  }}
                >
                  ＋
                </div>
              `
            : nothing
        }
      </div>
    `;
  }
}

if (!customElements.get("tab-bar")) {
  customElements.define("tab-bar", TabBar);
}
