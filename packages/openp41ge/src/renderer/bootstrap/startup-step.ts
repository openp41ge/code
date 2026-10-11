/**
 * IStartupStep — a single step in the renderer bootstrap sequence.
 *
 * Each step has one responsibility. Steps are run serially by RendererBootstrap,
 * each wrapped in try/catch so a failure never blocks subsequent steps.
 *
 * This satisfies:
 *   - Single Responsibility: each step does one thing
 *   - Open/Closed: new steps are added as new classes, not by modifying existing ones
 *   - Liskov: all steps implement the same interface
 *   - Interface Segregation: the interface is minimal (name + run)
 *   - Dependency Inversion: steps depend on StartupContext (abstraction), not concrete services
 */

import type { StartupContext } from "./startup-context";

export interface IStartupStep {
  /** Human-readable name for logging. */
  readonly name: string;

  /**
   * Execute this step. Errors should be thrown (they are caught by the
   * RendererBootstrap orchestrator), but the step may also handle errors
   * internally and return successfully.
   */
  run(context: StartupContext): Promise<void>;
}
