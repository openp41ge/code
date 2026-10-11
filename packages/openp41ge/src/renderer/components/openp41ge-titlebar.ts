/**
 * <openp41ge-titlebar> — minimal title bar (Lit).
 *
 * Worksets have been removed. This component provides:
 *   - macOS traffic-light spacer / non-Mac window controls
 *   - Window title
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import type { Window } from "../../layout/types";
import { emitEvent } from "../app";
import { TITLEBAR_HEIGHT } from "openp41ge-core-constants";
import { tooltipContent } from "openp41ge-sdk-uikit";
import { TabActivationHistory } from "../services/tab-activation-history";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "titlebar");

import "./openp41ge-workspace-label";

const isMac = (() => {
  try {
    return window.openp41ge?.platform === "darwin" || navigator.platform.startsWith("Mac");
  } catch (err) {
    log.debug("titlebar platform probe failed:", err);
    return false;
  }
})();

class Openp41geTitleBar extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  @property({ attribute: false })
  windowData: Window | null = null;

  @property({ attribute: false })
  leftSidebarVisible: boolean = false;

  @property({ attribute: false })
  rightSidebarVisible: boolean = false;

  // ── Custom titlebar drag ────────────────────────────────────────────
  // The bar is permanently `no-drag`: on a `-webkit-app-region: drag` region
  // the OS swallows all mouse events, so we could never hear the double-click.
  // Instead we reimplement the move over IPC (setPosition) and intercept the
  // double-click to run the animated maximize.
  private _dragActive = false;
  private _dragStarted = false;
  private _dragMoved = false;
  private _dragMovePending = false;
  private _downScreen = { x: 0, y: 0 };
  private _grabOffset = { x: 0, y: 0 };

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("workspace-file-changed", this._requestUpdate);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("workspace-file-changed", this._requestUpdate);
  }

  private _requestUpdate = (): void => {
    this.requestUpdate();
  };

  private _toggleLeft(): void {
    const win = this.windowData;
    if (!win) return;
    emitEvent("sidebar-toggle", { windowId: win.id, side: "left" });
  }

  private _toggleRight(): void {
    const win = this.windowData;
    if (!win) return;
    emitEvent("sidebar-toggle", { windowId: win.id, side: "right" });
  }

  // Custom window drag. startDrag is deferred until the pointer actually
  // travels past a small threshold; a clean click / double-click never
  // touches the drag machinery, which keeps the second double-click
  // (maximize → restore) intact. The grab offset pins the window's top-left
  // to the same spot under the cursor for the whole gesture. Moves are
  // rAF-throttled (one IPC per frame); IPC send (not invoke) keeps it
  // fire-and-forget so pointer tracking stays tight.
  private _onBarPointerDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest(".tb-btn, openp41ge-workspace-label, [data-winbtn]")) return;
    if (e.button !== 0) return;

    this._dragActive = true;
    this._dragStarted = false;
    this._dragMoved = false;
    this._downScreen = { x: e.screenX, y: e.screenY };
    this._grabOffset = { x: window.screenX - e.screenX, y: window.screenY - e.screenY };

    e.preventDefault(); // no text/image-selection while dragging the window
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {
      log.debug("titlebar setPointerCapture failed (synthetic pointer):", err);
    }
  };

  private _onBarPointerMove = (e: PointerEvent): void => {
    if (!this._dragActive) return;
    if (!this._dragStarted) {
      // Click-vs-drag discriminant: don't call this a drag (and don't send
      // any IPC) until the pointer has clearly travelled — slight jitter
      // during a double-click must never start a drag/restore.
      if (
        Math.abs(e.screenX - this._downScreen.x) <= 3 &&
        Math.abs(e.screenY - this._downScreen.y) <= 3
      )
        return;
      this._dragStarted = true;
      this._dragMoved = true;
      window.openp41ge?.window.startDrag();
    }
    if (this._dragMovePending) return;
    const sx = e.screenX;
    const sy = e.screenY;
    this._dragMovePending = true;
    requestAnimationFrame(() => {
      this._dragMovePending = false;
      window.openp41ge?.window.dragMove(sx + this._grabOffset.x, sy + this._grabOffset.y);
    });
  };

  private _onBarPointerUp = (e: PointerEvent): void => {
    if (!this._dragActive) return;
    this._dragActive = false;
    if (this._dragStarted) window.openp41ge?.window.endDrag();
    this._dragStarted = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {
      log.debug("titlebar releasePointerCapture failed (already released):", err);
    }
  };

  private _onBarDblClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest(".tb-btn, openp41ge-workspace-label, [data-winbtn]")) return;
    if (this._dragMoved) return; // was a real drag, not a double-click
    window.openp41ge?.window.maximizeAnimated();
  };

  // ── Back / Forward activation-history navigation ───────────────────
  private _isTabOpen(tabId: string): boolean {
    const win = this.windowData;
    if (!win) return false;
    return win.grid.placements.some((pl) => (pl.tabIds as string[]).includes(tabId));
  }

  /** Dispatch the same DOM event the tab grid uses to activate a tab. */
  private _activateTab(tabId: string): void {
    const win = this.windowData;
    if (!win) return;
    document.dispatchEvent(
      new CustomEvent("grid-activate", {
        bubbles: true,
        composed: true,
        detail: { winId: win.id, tabId },
      }),
    );
  }

  private _goBack(): void {
    const win = this.windowData;
    if (!win) return;
    const tabId = TabActivationHistory.goBack(win.id, (t) => this._isTabOpen(t));
    if (tabId) this._activateTab(tabId);
  }

  private _goForward(): void {
    const win = this.windowData;
    if (!win) return;
    const tabId = TabActivationHistory.goForward(win.id, (t) => this._isTabOpen(t));
    if (tabId) this._activateTab(tabId);
  }

  private _navBtn(direction: "back" | "forward", title: string, path: string): TemplateResult {
    const win = this.windowData;
    const disabled = win
      ? direction === "back"
        ? !TabActivationHistory.canGoBack(win.id, (t) => this._isTabOpen(t))
        : !TabActivationHistory.canGoForward(win.id, (t) => this._isTabOpen(t))
      : true;
    return html`
      <div
        class="tb-btn flex items-center justify-center w-7 h-7 rounded cursor-pointer shrink-0"
        style="-webkit-app-region:no-drag;color:var(--text-secondary,#aaa);${
          disabled ? "opacity:0.35;cursor:default;pointer-events:none;" : ""
        }"
        title="${title}"
        @click=${() => (direction === "back" ? this._goBack() : this._goForward())}
        @mouseenter=${(e: MouseEvent) => {
          if (disabled) return;
          (e.currentTarget as HTMLElement).style.color = "var(--text-primary,#eee)";
        }}
        @mouseleave=${(e: MouseEvent) => {
          (e.currentTarget as HTMLElement).style.color = "var(--text-secondary,#aaa)";
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="${path}"></path>
        </svg>
      </div>
    `;
  }

  render(): TemplateResult | typeof nothing {
    const win = this.windowData;
    if (!win) return nothing;

    return html`
      <style>
        .tb-btn:hover {
          background: var(--hover-bg, rgba(128, 128, 128, 0.15));
        }
      </style>
      <div
        class="tb-row flex items-center bg-gutter border-b border-divider shrink-0 select-none relative"
        style="--tb-h:${TITLEBAR_HEIGHT}px;-webkit-app-region:no-drag;"
        @pointerdown=${this._onBarPointerDown}
        @pointermove=${this._onBarPointerMove}
        @pointerup=${this._onBarPointerUp}
        @pointercancel=${this._onBarPointerUp}
        @dblclick=${this._onBarDblClick}
      >
        <!-- Traffic-light spacer (85px on Mac, 12px otherwise) -->
        <div class="tb-mw shrink-0" style="--tb-mw:${isMac ? 85 : 12}px"></div>

        <!-- Left sidebar toggle -->
        <div
          class="tb-btn flex items-center justify-center w-7 h-7 rounded cursor-pointer text-secondary hover:text-primary shrink-0 mr-1"
          style="-webkit-app-region:no-drag"
          ${tooltipContent({
            type: "simple",
            text: this.leftSidebarVisible ? "Close left sidebar" : "Open left sidebar",
          })}
          @click=${() => this._toggleLeft()}
        >
          <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
            <path
              d="${
                this.leftSidebarVisible
                  ? "M660-320v-320L500-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z"
                  : "M500-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z"
              }"
            ></path>
          </svg>
        </div>

        <!-- Back / Forward (activation history navigation) -->
        ${this._navBtn("back", "Back", "M15 18 9 12 15 6")}
        ${this._navBtn("forward", "Forward", "M9 18 15 12 9 6")}

        <!-- Spacer to push content to the right -->
        <div class="flex-1 min-w-0"></div>

        <!-- Workspace name (right-aligned, plain text — not clickable) -->
        <openp41ge-workspace-label></openp41ge-workspace-label>

        <!-- Right sidebar toggle -->
        <div
          class="tb-btn flex items-center justify-center w-7 h-7 rounded cursor-pointer text-secondary hover:text-primary shrink-0"
          style="-webkit-app-region:no-drag;margin-right:14px"
          ${tooltipContent({
            type: "simple",
            text: this.rightSidebarVisible ? "Close right sidebar" : "Open right sidebar",
          })}
          @click=${() => this._toggleRight()}
        >
          <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
            <path
              d="${
                this.rightSidebarVisible
                  ? "M300-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm440-80h120v-560H640v560Zm-80 0v-560H200v560h360Zm80 0h120-120Z"
                  : "M460-320v-320L300-480l160 160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm440-80h120v-560H640v560Zm-80 0v-560H200v560h360Zm80 0h120-120Z"
              }"
            ></path>
          </svg>
        </div>

        ${
          isMac
            ? nothing
            : html`
                <div class="flex h-full shrink-0">
                  ${this._winBtn("\u2500", false, () => window.openp41ge?.window.minimize())}
                  ${this._winBtn("\u25a1", false, () => window.openp41ge?.window.maximize())}
                  ${this._winBtn("\u2715", true, () => window.openp41ge?.window.close())}
                </div>
              `
        }
      </div>
    `;
  }

  private _winBtn(label: string, isClose: boolean, onClick: () => void): TemplateResult {
    return html`
      <div
        class="w-[46px] h-full flex items-center justify-center cursor-pointer text-sm text-secondary transition-[background] duration-100"
        style="-webkit-app-region:no-drag"
        data-winbtn
        @mouseenter=${(e: MouseEvent) => {
          const el = e.currentTarget as HTMLElement;
          el.classList.add(isClose ? "bg-[#e81123]" : "bg-[#333]");
          if (isClose) el.classList.add("text-white");
        }}
        @mouseleave=${(e: MouseEvent) => {
          const el = e.currentTarget as HTMLElement;
          el.classList.remove("bg-[#e81123]", "bg-[#333]");
          if (isClose) el.classList.remove("text-white");
        }}
        @click=${onClick}
      >
        ${label}
      </div>
    `;
  }
}

customElements.define("openp41ge-titlebar", Openp41geTitleBar);
