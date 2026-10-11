/**
 * Subscribe to workspace state updates from the main process.
 *
 * Two subscriptions:
 *   1. IPC subscription: receives state updates pushed from the main process
 *      (e.g., after another window makes a change) and updates the local state.
 *   2. Render subscription: calls _render() whenever workspace state changes.
 *
 * The render subscription MUST be registered before any setState() call so
 * that the initial render happens deterministically.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { isOpenp41geWindowview } from "../../interfaces/element-guards";
import type { Openp41geWindowviewElement } from "../../interfaces/element-guards";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "subscribe-state-updates");

export class SubscribeStateUpdatesStep implements IStartupStep {
  readonly name = "subscribe-state-updates";

  async run(context: StartupContext): Promise<void> {
    // If preload bridge is missing, skip IPC subscription
    if (typeof window.openp41ge === "undefined") {
      log.warn("preload bridge not available, skipping state subscription");
      return;
    }

    // Subscribe to state updates from main process
    let _stateUpdateCount = 0;
    window.openp41ge.workspace.onStateUpdate((stateJson: string) => {
      _stateUpdateCount++;
      const ws = JSON.parse(stateJson);
      context.workspaceState.setState(ws);
    });

    // Subscribe to state changes → render
    let _renderCount = 0;
    context.workspaceState.subscribe((_ws) => {
      _renderCount++;

      this._render(context);
    });

    log.info("state update subscriptions registered");

    // A window-manager window never receives a workspace state update (it is not
    // bound to a layout Window), so render its picker view directly.
    // A logs window likewise owns its stream tabs locally.
    if (context.windowType === "manager" || context.windowType === "logs") {
      void this._render(context);
    }
  }

  /** Render the current workspace state into the DOM. */
  private async _render(context: StartupContext): Promise<void> {
    const root = document.getElementById("root");
    if (!root) return;

    // A window-manager window hosts the workspace picker, not the grid.
    if (context.windowType === "manager") {
      // Remove the empty <openp41ge-windowview> shell mounted by the bootstrap
      // before the window kind was resolved.
      root.querySelector("openp41ge-windowview")?.remove();
      if (!root.querySelector("openp41ge-window-manager")) {
        const el = document.createElement("openp41ge-window-manager");
        root.appendChild(el);
      }
      return;
    }

    // A logs window hosts the standalone log grid, not a workspace layout.
    if (context.windowType === "logs") {
      root.querySelector("openp41ge-windowview")?.remove();
      if (!root.querySelector("openp41ge-logs-window")) {
        const el = document.createElement("openp41ge-logs-window");
        root.appendChild(el);
      }
      return;
    }

    const ws = context.workspaceState.getWorkspace();
    if (!ws) return;

    // Resolve window ID: prefer the one from FetchInitialStateStep, fall back
    // to polling the preload bridge (which gets set via the openp41ge:init IPC
    // message on did-finish-load).
    let windowId = context.windowId;
    if (!windowId && typeof window.openp41ge !== "undefined") {
      windowId = window.openp41ge.workspace.getWindowId();
    }

    // Defensive: if windowId is still not resolved, skip rendering.
    // The FetchInitialStateStep awaits waitForInit() before setting
    // context.windowId, so this only happens in edge cases (e.g., a
    // stray broadcast before init finishes). Using ws.windows[0] as
    // fallback would render the wrong window's data in multi-window apps.
    if (!windowId) {
      log.warn("window ID not resolved yet, skipping render");
      return;
    }

    const myWindow = ws.windows.find((w) => w.id === windowId);

    if (!myWindow) {
      log.warn("window not found for id:", windowId);
      return;
    }

    root.dataset.workspace = JSON.stringify(ws);

    // Find existing element (mounted by _mountUI) or create one
    let el = root.querySelector("openp41ge-windowview");
    if (!el) {
      const created = document.createElement("openp41ge-windowview");
      if (!isOpenp41geWindowview(created)) {
        log.error("failed to create openp41ge-windowview element");
        return;
      }
      root.appendChild(created);
      el = created;
    }

    (el as Openp41geWindowviewElement).windowData = myWindow;
    (el as Openp41geWindowviewElement).workspaceData = ws;
    (el as Openp41geWindowviewElement).layouts = context.workspaceState.getLayouts();

    // Wait for the windowview's Lit update cycle to complete before syncing
    // controller mounts. This ensures <tab-grid> has received its updated
    // .placements property from the windowview's render before mountController()
    // searches for tabs in the grid layout. Without this await, sync() runs
    // synchronously after setting windowData but before Lit's async microtask
    // processes the windowview update, leaving grid placements stale.
    await (el as unknown as { updateComplete: Promise<void> }).updateComplete;

    // Sync controller mounts after the grid has rendered its DOM
    // (await Lit's updateComplete to ensure [data-tab-id] elements exist).
    if (windowId) {
      await context.tabMountManager.sync(ws, windowId);
    }
  }
}
