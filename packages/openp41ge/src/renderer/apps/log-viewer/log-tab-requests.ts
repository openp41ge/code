/**
 * Requests for the log tab showing a stream: reveal an error, or point its
 * find bar at a query. Opening a stream's tab is asynchronous (the open goes
 * through the workspace state), so a request for a stream with no mounted
 * tab waits until one mounts; a tab already showing the stream gets it now.
 */

/** What a log tab is asked to do. */
export type LogTabRequest =
  | { readonly kind: "reveal"; readonly errorId: string }
  | { readonly kind: "find"; readonly query: string };

/** A mounted log tab. */
export interface LogTabTarget {
  readonly system: string | null;
  apply(request: LogTabRequest): void;
}

const live: LogTabTarget[] = [];
/** The latest request of each kind per stream, for a tab not yet mounted. */
const pending = new Map<string, Map<LogTabRequest["kind"], LogTabRequest>>();

/** Send `request` to the tab showing `system` (the latest mounted), or keep it
 *  for the next one to mount. */
export function requestLogTab(system: string, request: LogTabRequest): void {
  const target = [...live].reverse().find((t) => t.system === system);
  if (target) {
    target.apply(request);
    return;
  }
  const forSystem = pending.get(system) ?? new Map();
  forSystem.set(request.kind, request);
  pending.set(system, forSystem);
}

/** A log tab mounted: it receives requests for its stream, starting with any
 *  waiting for it. Returns the detach. */
export function attachLogTab(target: LogTabTarget): () => void {
  live.push(target);
  if (target.system) {
    const waiting = pending.get(target.system);
    pending.delete(target.system);
    for (const request of waiting?.values() ?? []) target.apply(request);
  }
  return () => {
    const i = live.indexOf(target);
    if (i >= 0) live.splice(i, 1);
  };
}
