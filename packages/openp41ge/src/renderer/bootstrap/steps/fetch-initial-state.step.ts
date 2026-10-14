/**
 * Fetch the initial workspace state from the main process.
 *
 * The UI has already been rendered (empty, waiting for data).
 * This step fetches the state and publishes it to the workspace state manager,
 * which triggers a re-render via the subscriber registered in step 6.
 *
 * If this fails, the UI stays in its empty state until a state update arrives
 * via the IPC subscription (step 6).
 *
 * Window ID resolution:
 *   - The openp41ge:init IPC (which sets _windowId in the preload) fires on
 *     did-finish-load, AFTER deferred module scripts execute.
 *   - The state fetch (getState) works either way — it returns the cached
 *     initial state if init arrived, or fires a fresh IPC call.
 *   - But getWindowId() returns null until init arrives.
 *   - We must await waitForInit() before resolving windowId, otherwise the
 *     fallback uses ws.windows[0].id and the WRONG window's data is rendered.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import type { Workspace, SystemTabId } from "../../../layout/types";
import { closeSystemTab } from "../../../layout/system-tab-operations";
import { getSystemTabRegistration } from "../../apps/app-registry";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "fetch-initial-state");

export class FetchInitialStateStep implements IStartupStep {
  readonly name = "fetch-initial-state";

  async run(context: StartupContext): Promise<void> {
    // If preload bridge is missing, skip this step silently
    if (typeof window.openp41ge === "undefined") {
      log.warn("preload bridge not available, skipping state fetch");
      return;
    }

    const statePromise = context.initialStatePromise ?? window.openp41ge.workspace.getState();

    // Fire state fetch AND waitForInit in parallel — the state fetch
    // might already have the data (via cached initial state) while
    // waitForInit ensures windowId is ready.
    const [json] = await Promise.all([statePromise, window.openp41ge.workspace.waitForInit()]);
    const ws: Workspace = JSON.parse(json);

    // Resolve window ID — waitForInit ensures getWindowId() is ready.
    // Fall through to the first-window fallback only if getWindowId()
    // somehow still returns null or the ID doesn't match (defensive).
    const rawId = window.openp41ge.workspace.getWindowId();
    let windowId: string | null = null;

    if (rawId && ws.windows.find((w) => w.id === rawId)) {
      windowId = rawId;
    } else {
      log.warn("window ID not resolved yet, using first window");
      if (ws.windows.length > 0) {
        windowId = ws.windows[0].id;
      }
    }

    context.initialWorkspace = ws;
    context.windowId = windowId;

    // Publish state — this triggers the render subscriber
    if (windowId) {
      context.workspaceState.setState(pruneUnregisteredSystemTabs(ws, windowId));
    }

    log.info("initial state received, window:", windowId);
  }
}

/**
 * Drop sidebar system tabs whose appType has no registered system-tab type.
 *
 * Persisted workspace state can reference a system tab whose implementation
 * was removed or whose contributing extension is no longer installed (e.g.
 * the old built-in explorer). Such tabs would otherwise mount into an empty
 * host. Registration runs before this step, so the registry is authoritative.
 */
function pruneUnregisteredSystemTabs(ws: Workspace, windowId: string): Workspace {
  let result = ws;
  const ids = Object.keys(ws.systemTabs);
  for (const id of ids) {
    const appType = result.systemTabs[id as SystemTabId]?.appType;
    if (!appType) continue;
    if (getSystemTabRegistration(appType)) continue;
    // Remove the orphan from whichever shared sidebar lists reference it.
    for (const side of ["left", "right"] as const) {
      const list =
        side === "left" ? result.sidebar.leftSidebarTabs : result.sidebar.rightSidebarTabs;
      if ((list as string[]).includes(id)) {
        result = closeSystemTab(result, windowId, side, id, true);
      }
    }
  }
  return result;
}
