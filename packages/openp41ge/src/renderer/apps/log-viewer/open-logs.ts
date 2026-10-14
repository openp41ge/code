/**
 * Open logs in this window's grid: a stream as its `log-viewer` tab (one per
 * stream), the platform's log, or an error's stream with the entry revealed.
 */

import { createLogger } from "openp41ge-core-logger";
import { openInGrid } from "../pane-tab";
import { requestLogTab } from "./log-tab-requests";

const log = createLogger("openp41ge", "open-logs");

/** The platform's own log stream — what "open logs" shows. */
export const PLATFORM_LOG_SYSTEM = "openp41ge";

/** Open `system`'s stream tab (`pinned`: a lasting tab, else a preview). */
export function openLogStream(system: string, pinned: boolean): void {
  openInGrid("log-viewer", { system }, pinned);
}

/**
 * Open the platform's log; with `errorId`, that error's stream with its entry
 * revealed (detail drawer open). Resolves false, opening nothing, when no log
 * has the error.
 */
export async function openLogsInWindow(target?: { errorId?: string }): Promise<boolean> {
  const errorId = target?.errorId;
  if (!errorId) {
    openLogStream(PLATFORM_LOG_SYSTEM, true);
    return true;
  }
  const found = await window.openp41ge?.logs?.findError?.(errorId);
  if (!found) {
    log.warn(`no log entry has error id ${errorId}`);
    return false;
  }
  openLogStream(found.system, true);
  requestLogTab(found.system, { kind: "reveal", errorId });
  return true;
}
