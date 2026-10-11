/**
 * Start the quote rotation controller.
 *
 * This starts a timer that cycles through movie quotes displayed in
 * empty grid cells. It's a cosmetic feature with no dependencies
 * on other startup steps.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "start-quote-controller");

export class StartQuoteControllerStep implements IStartupStep {
  readonly name = "start-quote-controller";

  async run(context: StartupContext): Promise<void> {
    context.quoteController.start();
    log.info("quote controller started");
  }
}
