/**
 * BlankController — renders an empty (blank) pane.
 *
 * This is the app type used when a new column is split off with no target
 * app (e.g. the grid "Split right" action). It produces an empty content
 * area with just a header close button so the pane can be dismissed.
 */

import { BaseController } from "../../controllers/base-controller";
import { paneHeaderButton } from "../../components/pane-header-button";
import { getWorkspace, emitEvent } from "../../app";
import type { TabId } from "../../../layout/types";

export class BlankController extends BaseController {
  mount(container: HTMLElement): void {
    this.container = container;

    container.className = "w-full h-full flex flex-col bg-gutter overflow-hidden cursor-grab";
    container.innerHTML = `
      <div class="flex items-center justify-between px-2 h-7 bg-bg-tertiary border-b border-divider shrink-0 select-none cursor-grab" style="justify-content:flex-end;"></div>
      <div class="flex-1 min-h-0"></div>
    `;

    // Append a close button so the blank pane can be dismissed.
    const headerEl = container.querySelector("div");
    if (!(headerEl instanceof HTMLElement)) return;
    headerEl.appendChild(
      paneHeaderButton({
        content: "\u00D7",
        className: "pane-close",
        title: "Close",
        onClick: () => {
          const ws = getWorkspace();
          if (!ws) return;
          for (const win of ws.windows) {
            for (const p of win.grid.placements) {
              if (p.tabIds.includes(this.tabId as TabId)) {
                emitEvent("tab-remove-column", { windowId: win.id, tabId: this.tabId });
                return;
              }
            }
          }
        },
      }),
    );
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }
  }
}
