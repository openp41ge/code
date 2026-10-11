/**
 * manager-grid-placeholder — the manager grid's fallback controller for an
 * app type that is not registered.
 */

import type { TabController } from "../controllers/types";

/** Fallback controller when an app type isn't registered (e.g. extension not
 *  loaded) so the cell still renders a labelled placeholder. */
export class PlaceholderController implements TabController {
  private _container: HTMLElement | null = null;
  constructor(
    readonly tabId: string,
    readonly appType: string,
  ) {}

  mount(container: HTMLElement): void {
    this._container = container;
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.height = "100%";
    container.style.color = "var(--text-secondary, #999)";
    container.style.fontSize = "13px";
    container.textContent = `${this.appType} (app type not registered)`;
  }

  unmount(): void {
    if (this._container) this._container.textContent = "";
  }
  setVisible(_visible: boolean): void {}
  snapshot(): Record<string, unknown> {
    return {};
  }
  restore(_state: Record<string, unknown>): void {}
}
