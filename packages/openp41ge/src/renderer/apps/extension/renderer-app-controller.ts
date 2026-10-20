/**
 * RendererAppController — mounts an extension's **grid** surface as a grid
 * pane. The extension renders its own content via its render function (see
 * services/extension-renderer-runtime.ts); this controller only owns the
 * platform chrome around it and the mount/unmount lifecycle.
 */

import { BaseController } from "../../controllers/base-controller";
import {
  mountRendererSurface,
  type RendererSurfaceHostDeps,
  type RendererSurfaceInstance,
} from "../../services/extension-renderer-runtime";
import type { GridSurfaceSpec } from "openp41ge-sdk";

export class RendererAppController extends BaseController {
  private _instance: RendererSurfaceInstance | undefined;
  /** Tab config (from `restore`) — per-tab context passed to the surface, e.g.
   *  the workspace file `path`/`dir` a workspace-editor cell edits. */
  private _config: Readonly<Record<string, unknown>> = {};

  constructor(
    tabId: string,
    appType: string,
    private readonly spec: GridSurfaceSpec,
    private readonly deps: RendererSurfaceHostDeps,
  ) {
    super(tabId, appType);
  }

  override restore(state: Record<string, unknown>): void {
    super.restore?.(state);
    this._config = state ?? {};
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.className = "w-full h-full flex flex-col bg-gutter overflow-hidden";
    // These mount targets live inside the manager grid's shadow root, where
    // global utility classes do not cascade (shadow DOM). Set the grid-surface
    // chrome via inline styles so the cell content fills the grid regardless of
    // shadow scope. Note: the grid toggles `container.style.display` for
    // show/hide, so layout must not depend on the container being a flex box —
    // position the content absolutely inside the (relative) container.
    container.style.position = "relative";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.overflow = "hidden";
    container.style.boxSizing = "border-box";
    container.style.backgroundColor = "var(--bg-gutter, #161616)";
    container.innerHTML = `
      <div class="flex-1 min-h-0 overflow-hidden" style="position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;"></div>
    `;
    const content = container.querySelector("div.flex-1");
    if (content instanceof HTMLElement) {
      // The surface's openTab names this tab (for `placement: "next-column"`);
      // its pin pins this tab, as an edit pins a file editor's preview.
      const deps: RendererSurfaceHostDeps = {
        ...this.deps,
        openTab: (request) => this.deps.openTab(request, { tabId: this.tabId }),
        pin: () =>
          container.dispatchEvent(
            new CustomEvent("grid-pin", {
              bubbles: true,
              composed: true,
              detail: {
                winId: window.openp41ge.workspace.getWindowId(),
                tabId: this.tabId,
                pinned: true,
              },
            }),
          ),
      };
      this._instance = mountRendererSurface(this.spec, content, deps, this._config);
    }
  }

  unmount(): void {
    this._instance?.dispose();
    this._instance = undefined;
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }
  }
}
