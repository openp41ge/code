import { createLogger } from "openp41ge-core-logger";
import type { HandlerFn } from "../services/event-router";
import type { AppState } from "../services/app-state";

const log = createLogger("openp41ge", "handlers/focus");

/** Wrap a terminal handler so the state it mutates shows in the log bus. */
const trace =
  (handlerId: string, fn: HandlerFn): HandlerFn =>
  async (payload) => {
    log.debug("handler", { handlerId, payload });
    await fn(payload);
  };

/**
 * Focus-state handlers for the core event system.
 *
 * These are registered with the EventRouter and dispatched when matching
 * graph edges fire. Each handler updates a single slice of AppState.
 */

export function createFocusHandlers(state: AppState): Record<string, HandlerFn> {
  return {
    "focus/set-focused": trace("focus/set-focused", async () => {
      state.windowFocused = true;
    }),

    "focus/set-blurred": trace("focus/set-blurred", async () => {
      state.windowFocused = false;
      state.focusedSide = null;
    }),

    "focus/set-sidebar-right": trace("focus/set-sidebar-right", async () => {
      state.focusedSide = "right";
    }),

    "focus/set-sidebar-left": trace("focus/set-sidebar-left", async () => {
      state.focusedSide = "left";
    }),

    "focus/clear-sidebar": trace("focus/clear-sidebar", async () => {
      state.focusedSide = null;
    }),
  };
}
