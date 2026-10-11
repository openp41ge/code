/**
 * RendererBootstrap — orchestrates the renderer startup sequence.
 *
 * Key design decisions:
 *
 * 1. UI renders IMMEDIATELY on start(), before any async step:
 *    The <openp41ge-windowview> component is mounted in the DOM with null data.
 *    Lit handles the null state gracefully by returning nothing (no visual
 *    flash, no loading state). Subsequent state changes trigger re-renders
 *    automatically via the render subscriber.
 *
 * 2. Each step is wrapped in try/catch:
 *    Errors are logged but NEVER stop the pipeline. Every step runs,
 *    even if previous steps failed. This makes startup deterministic.
 *
 * 3. Steps are injected via constructor:
 *    Tests can provide mock steps or reorder steps easily.
 *
 * 4. The bootstrap is the only entry point:
 *    app.ts creates the context + steps, then calls start().
 */

import type { IStartupStep } from "./startup-step";
import type { StartupContext } from "./startup-context";
import type { Openp41geWindowviewElement } from "../interfaces/element-guards";
import { isOpenp41geWindowview } from "../interfaces/element-guards";
import { createLogger } from "openp41ge-core-logger";
import { installErrorCapture } from "../services/error-capture-service";

const log = createLogger("openp41ge", "bootstrap");

export class RendererBootstrap {
  constructor(
    private readonly steps: IStartupStep[],
    private readonly context: StartupContext,
  ) {}

  /**
   * Start the renderer:
   *   1. Fire ALL IPC calls immediately (state + config) — they run in
   *      the background while sync steps execute
   *   2. Mount <openp41ge-windowview> immediately (synchronous, no data yet)
   *   3. Run all steps in order, each wrapped in try/catch
   *   4. Steps that need state/config data await the pre-started promises
   *
   * The state and config IPC calls overlap, cutting total latency from
   * 2 sequential roundtrips to ~1 parallel roundtrip.
   */
  async start(): Promise<void> {
    // Install error capture FIRST — before any code runs — so startup
    // errors are visible on screen.
    installErrorCapture();

    log.info("bootstrap start");

    // DEBUG: check preload bridge
    try {
      if (typeof window.openp41ge === "undefined") {
        log.warn("PRELOAD BRIDGE window.openp41ge is UNDEFINED (browser dev mode)");
      } else {
        log.info("PRELOAD BRIDGE window.openp41ge is available");
      }
    } catch (e) {
      log.error("PRELOAD BRIDGE check error:", e, { skipToast: true });
    }

    // ── Phase 1: Fire all IPC calls immediately (no await) ────────
    // Both run in the background while sync steps execute below.
    try {
      this.context.initialStatePromise =
        window.openp41ge?.workspace?.getState() ?? Promise.resolve(null);
    } catch (e) {
      // Non-fatal: we fall back to an empty state and keep booting. warn (not
      // error) so it doesn't trip the error capture.
      log.error("Failed to get initial state:", e, { skipToast: true });
      this.context.initialStatePromise = Promise.resolve("") as Promise<string>;
    }
    this.context.configService.load(); // idempotent — starts loading once

    // ── Phase 2: Mount UI shell immediately (no await) ────────────
    this._mountUI();

    // ── Phase 3: Run all steps deterministically ───────────────────
    for (const step of this.steps) {
      try {
        await step.run(this.context);
        log.info(`step "${step.name}" completed`);
      } catch (err) {
        log.error(`step "${step.name}" FAILED (continuing):`, err, { skipToast: true });
        // Continue to the next step — never stop the pipeline
      }
    }

    log.info("bootstrap complete");
  }

  /**
   * Mount the <openp41ge-windowview> element synchronously, before any data
   * has been loaded. Lit renders nothing when windowData is null, so the
   * user sees the browser's native background (or nothing) until data
   * arrives — no flash, no loading state, no delay.
   */
  private _mountUI(): void {
    const root = document.getElementById("root");
    if (!root) {
      log.error("#root element not found — cannot mount UI");
      return;
    }

    // Don't recreate if already mounted (e.g., from a previous render)
    let existing = root.querySelector("openp41ge-windowview");
    if (!existing) {
      const el = document.createElement("openp41ge-windowview");
      if (!isOpenp41geWindowview(el)) {
        log.error("created element is not a openp41ge-windowview");
        return;
      }
      root.appendChild(el);
      existing = el;
    }

    // Set null data — Lit's render() returns `nothing` for null, so no
    // visual output until real data arrives via the render subscriber.
    (existing as Openp41geWindowviewElement).windowData = null;
    (existing as Openp41geWindowviewElement).workspaceData = null;
    (existing as Openp41geWindowviewElement).layouts = new Map();
  }
}
