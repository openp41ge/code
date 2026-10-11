/**
 * TabActivationHistory — per-window tab activation log for back/forward nav.
 *
 * A monotonic, append-only log of tab activations. Every activation — opening
 * a tab, clicking / refocusing an already-open tab, double-clicking an item in
 * the tree, or navigating with Back/Forward — appends a NEW entry to the log,
 * **even if that tab appeared earlier**. The log may therefore contain the
 * same tab more than once, in the exact order it was activated.
 *
 * The log is immutable once created: closing a tab does NOT remove its
 * entries. Back/Forward cycle the log in order, skipping entries whose tab is
 * no longer open (per the `isOpen` predicate), never re-opening a closed tab.
 *
 * `position` is the index of the entry for the tab currently focused. A
 * closed tab may still be the last-focused entry; navigation simply skips over
 * it.
 *
 * API:
 *   pushActivation(windowId, tabId)   — append an activation (no-op if the tab
 *                                       is already the focused/current one)
 *   goBack(windowId, isOpen?) → tabId|null
 *   goForward(windowId, isOpen?) → tabId|null
 *   canGoBack / canGoForward(windowId, isOpen?) → boolean
 *   getCurrent(windowId) → tabId|null
 *   getHistory(windowId) → string[] (copy, oldest → newest)
 *   clear(windowId)
 *   _reset()
 */

import { MAX_HISTORY } from "openp41ge-core-constants";

type IsOpen = (tabId: string) => boolean;

interface WindowHistory {
  log: string[];
  position: number;
}

const _histories = new Map<string, WindowHistory>();

function getOrCreateHistory(winId: string): WindowHistory {
  let h = _histories.get(winId);
  if (!h) {
    h = { log: [], position: -1 };
    _histories.set(winId, h);
  }
  return h;
}

export const TabActivationHistory = {
  /**
   * Record a tab activation. Appends the tab to the END of the log and moves
   * the focus position to it. If the tab is already the focused/current one,
   * this is a no-op (no duplicate for the same tab being clicked twice).
   *
   * Returns true if the history was modified, false if it was a no-op.
   */
  pushActivation(winId: string, tabId: string): boolean {
    const h = getOrCreateHistory(winId);

    // No-op if this tab is already the one currently focused.
    if (h.position >= 0 && h.log[h.position] === tabId) {
      return false;
    }

    h.log.push(tabId);
    // Cap the log at MAX_HISTORY (drop the oldest entries).
    if (h.log.length > MAX_HISTORY) {
      h.log.shift();
    }
    h.position = h.log.length - 1;
    return true;
  },

  /**
   * Navigate back to the previous open tab. Scans the log backwards from the
   * current position, skipping closed entries (per `isOpen`), and moves the
   * focus position to the first open entry found. Returns the tab ID or null.
   */
  goBack(winId: string, isOpen?: IsOpen): string | null {
    const h = _histories.get(winId);
    if (!h || h.position < 0) return null;

    for (let i = h.position - 1; i >= 0; i--) {
      const tab = h.log[i];
      if (!isOpen || isOpen(tab)) {
        h.position = i;
        return tab;
      }
    }
    return null;
  },

  /**
   * Navigate forward to the next open tab. Scans the log forwards from the
   * current position, skipping closed entries (per `isOpen`). Returns the tab
   * ID or null.
   */
  goForward(winId: string, isOpen?: IsOpen): string | null {
    const h = _histories.get(winId);
    if (!h || h.position < 0) return null;

    for (let i = h.position + 1; i < h.log.length; i++) {
      const tab = h.log[i];
      if (!isOpen || isOpen(tab)) {
        h.position = i;
        return tab;
      }
    }
    return null;
  },

  /** True if there is an open entry before the current position. */
  canGoBack(winId: string, isOpen?: IsOpen): boolean {
    const h = _histories.get(winId);
    if (!h || h.position < 0) return false;

    for (let i = h.position - 1; i >= 0; i--) {
      if (!isOpen || isOpen(h.log[i])) return true;
    }
    return false;
  },

  /** True if there is an open entry after the current position. */
  canGoForward(winId: string, isOpen?: IsOpen): boolean {
    const h = _histories.get(winId);
    if (!h || h.position < 0) return false;

    for (let i = h.position + 1; i < h.log.length; i++) {
      if (!isOpen || isOpen(h.log[i])) return true;
    }
    return false;
  },

  /**
   * The tab at the current focus position, or null. May return a tab that has
   * since been closed (navigation skips it); callers that need an open tab
   * should filter via `isOpen`.
   */
  getCurrent(winId: string): string | null {
    const h = _histories.get(winId);
    if (!h || h.position < 0 || h.position >= h.log.length) return null;
    return h.log[h.position];
  },

  /**
   * A copy of the full activation log, oldest → newest (duplicates included).
   */
  getHistory(winId: string): string[] {
    const h = _histories.get(winId);
    return h ? [...h.log] : [];
  },

  /**
   * When a tab is closed, advance the focus position to the PREVIOUS OPEN
   * entry in the log (the entry activated just before the closed tab's most
   * recent activation), skipping the closed tab itself and any other closed
   * entries. Moves `position` to that entry and returns it, or returns null
   * if there is no previous open entry (or the closed tab isn't in the log).
   */
  focusPreviousOpen(winId: string, closedTabId: string, isOpen?: IsOpen): string | null {
    const h = _histories.get(winId);
    if (!h || h.log.length === 0) return null;

    const start = h.log.lastIndexOf(closedTabId);
    if (start < 0) return null; // tab was never activated → nothing to go back to

    for (let i = start - 1; i >= 0; i--) {
      const tab = h.log[i];
      if (tab === closedTabId) continue; // skip earlier occurrences of the closed tab
      if (!isOpen || isOpen(tab)) {
        h.position = i;
        return tab;
      }
    }
    return null;
  },

  /** Clear all history for a window (e.g., on window close). */
  clear(winId: string): void {
    _histories.delete(winId);
  },

  /** Reset all state (for testing). */
  _reset(): void {
    _histories.clear();
  },
};
