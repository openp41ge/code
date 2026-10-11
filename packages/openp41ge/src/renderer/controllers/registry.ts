/**
 * Controller registry — module-level, survives DOM teardown.
 *
 * Same pattern as drag state: lives at module level so controllers survive
 * `innerHTML = ""` on the grid. When a tab switches back, the same
 * controller is found in the registry and mounted into the new container.
 *
 * The registry does NOT own controller lifecycle. Callers create/register
 * controllers and call mount/unmount themselves.
 */

import type { TabController } from "./types";

const _controllers = new Map<string, TabController>();

export function registerController(ctrl: TabController): void {
  _controllers.set(ctrl.tabId, ctrl);
}

export function getController(tabId: string): TabController | undefined {
  return _controllers.get(tabId);
}

/**
 * Unmount all registered controllers and clear the registry.
 * Used during app reset to tear down all panes before re-creating the UI.
 */
export function unmountAllControllers(): void {
  for (const ctrl of _controllers.values()) {
    try {
      ctrl.unmount();
    } catch (err) {
      console.error("Error unmounting controller:", ctrl.tabId, err); // eslint-disable-line no-console
    }
  }
  _controllers.clear();
}
