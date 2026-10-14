/**
 * Which windows show a state (plans/2026-10-14-one-window.md, step 3): a
 * workspace's state goes to the windows bound to it; the in-memory state of
 * windows with no workspace goes to workspace windows with no workspace only.
 */

import type { Openp41geWindowMeta } from "./window-manager.js";

/** Whether a window with `meta` shows the state of `workspacePath` (null: the
 *  no-workspace state). */
export function showsState(
  meta: Pick<Openp41geWindowMeta, "windowType" | "workspacePath">,
  workspacePath: string | null,
): boolean {
  if (workspacePath !== null) return meta.workspacePath === workspacePath;
  return meta.windowType === "workspace" && meta.workspacePath === null;
}
