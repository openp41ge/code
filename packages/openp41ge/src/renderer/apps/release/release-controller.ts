/**
 * ReleaseController — the `release` grid tab: <openp41ge-release-view> for
 * the tab's release (`{ tag }`).
 */

import type { TabController } from "../../controllers/types";
import "../../components/openp41ge-release-view";

export class ReleaseController implements TabController {
  readonly tabId: string;
  readonly appType = "release";
  private _container: HTMLElement | null = null;
  private _tag = "";

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  mount(container: HTMLElement): void {
    this._container = container;
    const el = document.createElement("openp41ge-release-view");
    el.tag = this._tag;
    container.appendChild(el);
  }

  unmount(): void {
    if (this._container) this._container.innerHTML = "";
    this._container = null;
  }

  setVisible(_visible: boolean): void {}

  snapshot(): Record<string, unknown> {
    return { tag: this._tag, path: `release:${this._tag}` };
  }

  restore(state: Record<string, unknown>): void {
    this._tag = typeof state.tag === "string" ? state.tag : "";
  }
}
