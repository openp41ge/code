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

  // Mousedown — determine which zone was clicked.
  // Does NOT stopImmediatePropagation — sidebars need their own mousedown
  // handlers (resize notch, tab clicks) to still fire. The zone event is
  // emitted as a fire-and-forget observation for focus tracking.
  private readonly _onMousedown = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const eventType = this._determineMousedownEvent(target);
    if (eventType) {
      // DEBUG: the DOM→router observation, including the tag that was
      // clicked. Events that match no edge are logged by the router as
      // "route-no-match", so the pair traces the full path.
      log.debug("dom-event", { eventType, x: e.clientX, y: e.clientY, tag: target.tagName });
      this._router.emit(eventType, { x: e.clientX, y: e.clientY, target: target.tagName });
    }
  };

  private readonly _onFocus = (): void => {
    log.debug("dom-event", { eventType: "window-focus" });
    this._router.emit("window-focus", {});
  };

  private readonly _onBlur = (): void => {
    log.debug("dom-event", { eventType: "window-blur" });
    this._router.emit("window-blur", {});
  };

  constructor(router: EventRouter) {
    this._router = router;
  }

  /** Start intercepting DOM events. */
  attach(): void {
    if (this._attached) return;
    this._attached = true;
    document.addEventListener("mousedown", this._onMousedown, true); // capture phase
    window.addEventListener("focus", this._onFocus);
    window.addEventListener("blur", this._onBlur);
    // A window that opens focused gets no focus event.
    if (document.hasFocus()) this._onFocus();
  }

  /** Stop intercepting DOM events. */
  detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener("mousedown", this._onMousedown, true);
    window.removeEventListener("focus", this._onFocus);
    window.removeEventListener("blur", this._onBlur);
  }

  /** The zone a mousedown landed in, or null outside the sidebars and grid. */
  private _determineMousedownEvent(target: HTMLElement): string | null {
    if (target.closest?.("openp41ge-sidebar[side=left]")) return "sidebar-click-left";
    if (target.closest?.("openp41ge-sidebar[side=right]")) return "sidebar-click-right";
    if (target.closest?.("tab-grid")) return "grid-click";
    return null;
  }
}
