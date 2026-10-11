/**
 * Initialize cross-service dependencies.
 *
 * After all services are constructed (in StartupContext), this step wires
 * them together by calling .init() on services that depend on other services.
 *
 * This is a separate step so the construction phase (which never fails)
 * is distinct from the wiring phase (which could fail if a service throws).
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "init-services");

export class InitServicesStep implements IStartupStep {
  readonly name = "init-services";

  async run(context: StartupContext): Promise<void> {
    context.wireServices();
    log.info("services wired");
  }
}
