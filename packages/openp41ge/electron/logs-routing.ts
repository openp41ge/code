/**
 * Where "open logs" opens (the Logs menu item, an error toast, an extension's
 * error link): a workspace window opens a Logs tab in its own grid; any other
 * window (or none) opens the logs window. See plans/2026-10-14-one-window.md.
 */

import type { Openp41geWindowType } from "./window-manager.js";

/** Whether a request from a window of `sourceType` opens in that window. */
export function logsOpenInPlace(sourceType: Openp41geWindowType | null): boolean {
  return sourceType === "workspace";
}
