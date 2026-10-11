/**
 * close-tabs-showing.ts — close the tabs of an open workspace that showed a
 * deleted repository or folder (their content no longer exists).
 */

import { tabsShowing, type DeletedTarget } from "../../layout/tabs-showing.js";
import type { OperationDispatcher } from "./operation-dispatcher.js";

/** Close every tab in `dispatcher`'s workspace that shows `target`. */
export function closeTabsShowing(dispatcher: OperationDispatcher, target: DeletedTarget): void {
  const tabs = tabsShowing(dispatcher.getWorkspace(), target);
  if (tabs.length === 0) return;
  for (const { windowId, tabId } of tabs) {
    dispatcher.apply("removeColumnTab", [windowId, tabId]);
  }
  dispatcher.broadcast();
}
