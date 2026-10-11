/**
 * <openp41ge-topbar> — simplified title bar (no workset tabs).
 *
 * Worksets have been removed. This component now just renders a simple
 * title bar with project name and window controls.
 * To be replaced with a proper project-aware title bar in a future phase.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import type { Window } from "../../layout/types";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "topbar");

const isMac = (() => {
  try {
    return window.openp41ge?.platform === "darwin" || navigator.platform.startsWith("Mac");
  } catch (err) {
    log.debug("topbar platform probe failed:", err);
    return false;
  }
})();

const HEIGHT = 35;

class Openp41geTopBar extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  @property({ attribute: false })
  windowData: Window | null = null;

  render(): TemplateResult | typeof nothing {
    const win = this.windowData;
    if (!win) return nothing;

    return html`
      <div
        class="tb-row flex items-center bg-gutter border-b border-divider shrink-0 select-none relative"
        style="--tb-h:${HEIGHT}px;-webkit-app-region:drag"
      >
        <!-- Traffic-light spacer (85px on Mac, 12px otherwise) -->
        <div class="tb-mw shrink-0" style="--tb-mw:${isMac ? 85 : 12}px"></div>

        <!-- Project name / window title -->
        <div
          class="flex-1 min-w-0 px-3 text-sm text-muted whitespace-nowrap overflow-hidden text-ellipsis"
        >
          openp41ge
        </div>

        ${
          isMac
            ? ""
            : html`
                <!-- Non-Mac window controls -->
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

customElements.define("openp41ge-topbar", Openp41geTopBar);
