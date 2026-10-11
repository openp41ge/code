/**
 * ConfigEditorController — the `config-editor` grid tab: the platform's JSON
 * editor (<openp41ge-config-editor>) for one extension's config. The tab's
 * config is `{ extensionId }`; the values themselves live in `config.json`.
 */

import type { TabController } from "../../controllers/types";
import "../../components/openp41ge-config-editor";

export class ConfigEditorController implements TabController {
  readonly tabId: string;
  readonly appType = "config-editor";
  private _container: HTMLElement | null = null;
  private _extensionId = "";

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  mount(container: HTMLElement): void {
    this._container = container;
    const el = document.createElement("openp41ge-config-editor");
    el.extensionId = this._extensionId;
    container.appendChild(el);
  }

  unmount(): void {
    if (this._container) this._container.innerHTML = "";
    this._container = null;
  }

  setVisible(_visible: boolean): void {}

  snapshot(): Record<string, unknown> {
    return { extensionId: this._extensionId };
  }

  restore(state: Record<string, unknown>): void {
    this._extensionId = typeof state.extensionId === "string" ? state.extensionId : "";
  }
}
