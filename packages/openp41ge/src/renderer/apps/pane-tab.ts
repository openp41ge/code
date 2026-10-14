/**
 * Helpers for the platform's own sidebar tabs (the management and log tabs):
 * a controller that shows one pane element, and opening something in the
 * window's grid.
 */

import type { SystemTabController } from "../controllers/types";
import { Openp41geTabsEventHandler } from "../services/openp41ge-tabs-event-handler";
import { extensionDrag } from "../services/extension-drag";
import type { MountDragBinding } from "../services/extension-drag-service";

/** Open `appType` with `tabConfig` in this window's grid, as a drop of it would
 *  (in the last focused column). */
export function openInGrid(
  appType: string,
  tabConfig: Record<string, unknown>,
  pinned: boolean,
): void {
  const grid = document.querySelector("tab-grid") as (HTMLElement & { winId?: string }) | null;
  document.dispatchEvent(
    new CustomEvent("grid-open-tab", {
      detail: {
        tabType: appType,
        tabConfig,
        targetCol: Openp41geTabsEventHandler.getLastFocusedCol(grid?.winId ?? ""),
        pinned,
      },
    }),
  );
}

/** A sidebar tab that shows one pane element, filling the tab; its tagged
 *  rows (`data-drag-source-id`) drag through the platform pipeline. */
export class PaneTabController implements SystemTabController {
  private _el: HTMLElement | null = null;
  private _drag: MountDragBinding | null = null;

  constructor(
    readonly tabId: string,
    readonly appType: string,
    private readonly _create: () => HTMLElement,
  ) {}

  mount(container: HTMLElement): void {
    const el = this._create();
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.height = "100%";
    el.style.minHeight = "0";
    container.appendChild(el);
    this._el = el;
    this._drag = extensionDrag.platformBinder().attach(`sidebar:${this.appType}`, container);
  }

  unmount(): void {
    this._drag?.dispose();
    this._drag = null;
    this._el?.remove();
    this._el = null;
  }
}
