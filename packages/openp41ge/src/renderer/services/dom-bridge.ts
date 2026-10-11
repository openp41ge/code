import { createLogger } from "openp41ge-core-logger";
import type { EventRouter } from "./event-router";

const log = createLogger("openp41ge", "dom-bridge");

/**
 * DOM Bridge — intercepts browser-native DOM events and routes them
 * through the EventRouter.
 *
 * Captured on the document in capture phase. Events are observed but not
 * suppressed — components retain their own DOM event handlers (resize
 * notches, tab clicks, etc.).
 */
export class DOMBridge {
  private _router: EventRouter;
  private _attached = false;

  constructor(router: EventRouter) {
    this._router = router;
  }

  /** Start intercepting DOM events. */
  attach(): void {
    if (this._attached) return;
    this._attached = true;

    // Mousedown — determine which zone was clicked.
    // Does NOT stopImmediatePropagation — sidebars need their own mousedown
    // handlers (resize notch, tab clicks) to still fire. The zone event is
    // emitted as a fire-and-forget observation for focus tracking.
    document.addEventListener(
      "mousedown",
      (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const eventType = this._determineMousedownEvent(target, e.clientX);
        if (eventType) {
          // DEBUG: the DOM→router observation, including the tag that was
          // clicked. Events that match no edge are logged by the router as
          // "route-no-match", so the pair traces the full path.
          log.debug("dom-event", { eventType, x: e.clientX, y: e.clientY, tag: target.tagName });
          this._router.emit(eventType, { x: e.clientX, y: e.clientY, target: target.tagName });
        }
      },
      true, // capture phase
    );

    // Window focus/blur
    window.addEventListener("focus", () => {
      log.debug("dom-event", { eventType: "window-focus" });
      this._router.emit("window-focus", {});
    });

    window.addEventListener("blur", () => {
      log.debug("dom-event", { eventType: "window-blur" });
      this._router.emit("window-blur", {});
    });
  }

  /** Stop intercepting DOM events. */
  detach(): void {
    // In practice, the bridge lives for the lifetime of the app.
    // This is here for completeness and testing.
    this._attached = false;
  }

  private _determineMousedownEvent(target: HTMLElement, clientX: number): string | null {
    const leftSidebar = document.querySelector("openp41ge-sidebar[side=left]");
    const rightSidebar = document.querySelector("openp41ge-sidebar[side=right]");
    const grid = document.querySelector("openp41ge-grid");

    if (leftSidebar?.contains(target)) {
      return "sidebar-click-left";
    }
    if (rightSidebar?.contains(target)) {
      return "sidebar-click-right";
    }
    if (grid?.contains(target)) {
      return "grid-click";
    }
    // Fallback: use X coordinate to guess zone
    const winWidth = window.innerWidth;
    if (clientX < winWidth * 0.2) return "sidebar-click-left";
    if (clientX > winWidth * 0.8) return "sidebar-click-right";
    return "grid-click";
  }
}
