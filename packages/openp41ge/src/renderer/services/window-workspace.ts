/**
 * Whether this window has a workspace open, and so which tab types it can
 * host: a window with no workspace hosts only those that need none
 * (`workspace: "none"`).
 */

import type { SurfaceWorkspace } from "openp41ge-sdk";

/** This window has a workspace open. Without the preload bridge's binding
 *  (a test harness or demo) the window counts as having one. */
export function windowHasWorkspace(): boolean {
  const get = window.openp41ge?.workspace?.getWorkspacePath;
  return get ? get() !== null : true;
}

/** Whether a tab type can open in this window. */
export function availableInWindow(
  reg: { readonly workspace?: SurfaceWorkspace } | undefined,
): boolean {
  return reg?.workspace === "none" || windowHasWorkspace();
}
