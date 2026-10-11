import { createLogger } from "openp41ge-core-logger";
import type { HandlerFn } from "../services/event-router";
import type { ICommandBus } from "../interfaces/command-bus";

const log = createLogger("openp41ge", "handlers/tabs");

/** Wrap a terminal handler so the command it dispatches shows in the log bus. */
const trace =
  (handlerId: string, fn: HandlerFn): HandlerFn =>
  async (payload) => {
    log.debug("handler", { handlerId, payload });
    await fn(payload);
  };

/**
 * Tab operation handlers for the event system.
 *
 * These are registered with the EventRouter and dispatched when matching
 * graph edges fire. Each handler calls the CommandBus to dispatch IPC
 * operations to the main process.
 */
export function createTabHandlers(commandBus: ICommandBus): Record<string, HandlerFn> {
  return {
    "tabs/open-system-tab": trace("tabs/open-system-tab", async (payload) => {
      const { windowId, side, appType, title } = payload;
      commandBus.dispatch("openSystemTab", windowId, side, appType, title);
    }),

    "tabs/activate-tab": trace("tabs/activate-tab", async (payload) => {
      const { windowId, side, tabId } = payload;
      commandBus.dispatch("activateSystemTab", windowId, side, tabId);
    }),

    "tabs/close-tab": trace("tabs/close-tab", async (payload) => {
      const { windowId, side, tabId, force } = payload;
      commandBus.dispatch("closeSystemTab", windowId, side, tabId, force ?? true);
    }),

    "tabs/pin-tab": trace("tabs/pin-tab", async (payload) => {
      const { tabId, pinned } = payload;
      commandBus.dispatch("pinSystemTab", tabId, pinned);
    }),

    "tabs/open-in-cell": trace("tabs/open-in-cell", async (payload) => {
      const { windowId, appType, title, config, col, insertBefore, replaceExisting } = payload;
      commandBus.dispatch(
        "openTabInCell",
        windowId,
        appType,
        title,
        config,
        col,
        insertBefore,
        replaceExisting,
      );
    }),

    "tabs/remove-from-cell": trace("tabs/remove-from-cell", async (payload) => {
      const { windowId, paneId } = payload;
      commandBus.dispatch("removeTabFromCell", windowId, paneId);
    }),

    "tabs/remove-column-tab": trace("tabs/remove-column-tab", async (payload) => {
      const { windowId, tabId } = payload;
      commandBus.dispatch("removeColumnTab", windowId, tabId);
    }),

    "tabs/add-column-tab-at": trace("tabs/add-column-tab-at", async (payload) => {
      const { windowId, appType, title, label, col } = payload;
      commandBus.dispatch("addColumnTabAt", windowId, appType, title, label, col);
    }),

    "layout/resize-grid": trace("layout/resize-grid", async (payload) => {
      const { windowId, paneWinId, cols } = payload;
      commandBus.dispatch("resizeGrid", windowId, paneWinId, 1, cols);
    }),
  };
}
