/**
 * Which windows show a state: a workspace's state goes to the windows that
 * show that workspace; the in-memory state of windows with no workspace goes
 * to those windows only.
 */

import type { Openp41geWindowMeta } from "./window-manager.js";

/** Whether a window with `meta` shows the state of `workspacePath` (null: the
 *  no-workspace state). */
export function showsState(
  meta: Pick<Openp41geWindowMeta, "workspacePath">,
  workspacePath: string | null,
): boolean {
  return meta.workspacePath === workspacePath;
}
