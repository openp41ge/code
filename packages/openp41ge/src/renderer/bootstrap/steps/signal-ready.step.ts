/**
 * Signal that the renderer is ready.
 *
 * This step:
 *   1. Sets window.__openp41geReady for test framework detection
 *   2. Notifies the main process lifecycle manager via IPC
 *   3. Dispatches a openp41ge:ready custom event for other components
 *
 * This is the LAST step in the bootstrap sequence.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "signal-ready");

export class SignalReadyStep implements IStartupStep {
  readonly name = "signal-ready";

  async run(_context: StartupContext): Promise<void> {
    window.__openp41geReady = true;
    if (typeof window.openp41ge !== "undefined") {
      window.openp41ge.lifecycle.notifyReady();
    }
    document.dispatchEvent(new CustomEvent("openp41ge:ready"));
    log.info("ready signal sent");
  }
}
