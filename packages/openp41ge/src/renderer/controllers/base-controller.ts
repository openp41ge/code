/**
 * BaseController — abstract base implementing TabController.
 *
 * Provides:
 * - Store for generic state (this.state)
 * - Default no-op setVisible
 * - Default snapshot/restore from this.state
 *
 * Subclasses must implement mount() and unmount().
 */

import type { TabController } from "./types";

export abstract class BaseController implements TabController {
  readonly tabId: string;
  readonly appType: string;

  /** The container element passed to mount(). Cleared on unmount(). */
  protected container: HTMLElement | null = null;

  /** Serializable state for this tab. */
  protected state: Record<string, unknown> = {};

  constructor(tabId: string, appType: string) {
    this.tabId = tabId;
    this.appType = appType;
  }

  /** Subclasses create their DOM inside `el`. */
  abstract mount(container: HTMLElement): void;

  /** Subclasses detach resources (not processes), clear DOM. */
  abstract unmount(): void;

  /** Default: no-op. Subclasses override for output throttling. */
  setVisible(_visible: boolean): void {
    // Nothing by default.
  }

  /** Save serializable state. Subclasses extend with their own fields. */
  snapshot(): Record<string, unknown> {
    return { ...this.state };
  }

  /** Restore state after re-mount. Subclasses extend. */
  restore(state: Record<string, unknown>): void {
    this.state = { ...state };
  }
}
