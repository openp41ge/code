/**
 * RendererSystemTabController — mounts an extension's **sidebar** surface in
 * the sidebar. The extension renders its own content via its render function;
 * this controller owns only the mount lifecycle and error isolation.
 */

import type { SystemTabController } from "../../controllers/types";
import { appendSidebarSurfaceRoot } from "./sidebar-surface-root";
import {
  mountRendererSurface,
  type RendererSurfaceHostDeps,
  type RendererSurfaceInstance,
} from "../../services/extension-renderer-runtime";
import type { SidebarSurfaceSpec } from "openp41ge-sdk";

export class RendererSystemTabController implements SystemTabController {
  readonly tabId: string;
  readonly appType: string;

  private _root: HTMLElement | null = null;
  private _instance: RendererSurfaceInstance | undefined;

  constructor(
    tabId: string,
    appType: string,
    private readonly spec: SidebarSurfaceSpec,
    private readonly deps: RendererSurfaceHostDeps,
  ) {
    this.tabId = tabId;
    this.appType = appType;
  }

  mount(container: HTMLElement): void {
    // Render into our own root: the sidebar owns the host's class/visibility.
    const { root, content } = appendSidebarSurfaceRoot(container);
    this._root = root;
    this._instance = mountRendererSurface(this.spec, content, this.deps);
  }

  unmount(): void {
    this._instance?.dispose();
    this._instance = undefined;
    this._root?.remove();
    this._root = null;
  }
}
