/**
 * extension-contributions.ts — renderer-side view of the extension host.
 *
 * Fetches the active-extension summary once at startup and keeps it in sync
 * with the main process via `extension:state` pushes. The renderer loader reads
 * `getActiveExtensions()` to load each extension's renderer entry; nothing
 * else in the renderer asks the main process about extensions.
 */

import type { ActiveExtensionSummary } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "extension-contributions");

let _cache: ActiveExtensionSummary[] = [];
let _loaded = false;
let _subscribed = false;
const _listeners = new Set<(active: ActiveExtensionSummary[]) => void>();

function setActive(active: ActiveExtensionSummary[]): void {
  _cache = active ?? [];
  _loaded = true;
  for (const listener of _listeners) listener(_cache);
}

function ensureSubscription(): void {
  if (_subscribed) return;
  _subscribed = true;
  try {
    window.openp41ge.extension.onState((active) => setActive(active));
  } catch (err) {
    // Preload bridge may be absent in some test environments; fall back to
    // one-shot `getActive` on demand.
    log.debug("extension.onState unavailable:", err);
  }
}

/** Current active extensions (possibly empty until the first fetch lands). */
export function getActiveExtensions(): ActiveExtensionSummary[] {
  ensureSubscription();
  if (!_loaded) void refreshActiveExtensions();
  return _cache;
}

/** Fetch the active-extension summary from the main process and cache it. */
export async function refreshActiveExtensions(): Promise<ActiveExtensionSummary[]> {
  try {
    const active = await window.openp41ge.extension.getActive();
    setActive(active ?? []);
    return active ?? [];
  } catch (err) {
    log.error("failed to load active extensions:", err, { skipToast: true });
    return _cache;
  }
}

/** Subscribe to active-extension changes. Returns an unsubscribe function. */
export function onExtensionsChanged(cb: (active: ActiveExtensionSummary[]) => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
