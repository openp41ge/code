/**
 * log-streams.ts — registry of log streams, each belonging to a system.
 *
 * A **stream is a system** (the platform itself, or a plugin such as
 * explorer / agents). Subsystems are the logger *namespaces* (an entry's
 * `source`) inside a system's stream, not separate streams — so a stream's
 * viewer shows every entry emitted by that system and lets the user narrow to
 * a subsystem with the in-viewer source filter.
 *
 * A system is registered by its own package (explicit self-registration), or
 * eagerly the first time it creates a logger (see `logger.ts`), so even a
 * stream with zero entries appears in the sidebar. The registry stores only
 * system names + registration order; entry counts and last-timestamps are
 * derived live from the global log buffer (single source of truth).
 */

import { getLogBuffer } from "./log-buffer";

export interface LogStreamInfo {
  /** The system (plugin id / platform) this stream represents. */
  system: string;
  /** Number of buffered log entries emitted by this system (all subsystems). */
  entryCount: number;
  /** Timestamp of the system's most recent entry, or null if none yet. */
  lastTs: number | null;
}

type StreamListener = () => void;

const _systems = new Set<string>(); // system id
let _streamOrder = 0;
const _order = new Map<string, number>(); // system id -> registration order
const _listeners = new Set<StreamListener>();

/**
 * Register a system's log stream (idempotent). Notifies subscribers on first
 * registration. The optional `name` (a subsystem/namespace) is accepted for
 * backward compatibility but does not affect identity — a system registers
 * once regardless of how many namespaces it logs under.
 */
export function registerLogStream(system: string, _name?: string): void {
  if (!system || !system.trim()) return;
  if (!_systems.has(system)) {
    _systems.add(system);
    _order.set(system, _streamOrder++);
    for (const fn of _listeners) fn();
  }
}

/** Remove a system's stream from the registry. Notifies subscribers. */
export function unregisterLogStream(system: string, _name?: string): void {
  if (_systems.delete(system)) {
    _order.delete(system);
    for (const fn of _listeners) fn();
  }
}

/**
 * List all registered streams in registration order, each with its live
 * entry count + most-recent timestamp (derived from the log buffer across all
 * of the system's subsystems).
 */
export function listLogStreams(): LogStreamInfo[] {
  const counts = new Map<string, number>();
  const lastTs = new Map<string, number>();
  for (const e of getLogBuffer()) {
    counts.set(e.system, (counts.get(e.system) ?? 0) + 1);
    lastTs.set(e.system, e.timestamp);
  }

  return Array.from(_systems)
    .sort((a, b) => (_order.get(a) ?? 0) - (_order.get(b) ?? 0))
    .map((system) => {
      const c = counts.get(system);
      return {
        system,
        entryCount: c ?? 0,
        lastTs: c ? (lastTs.get(system) ?? null) : null,
      };
    });
}

/** Subscribe to stream registration/unregistration. Returns unsubscribe. */
export function subscribeLogStreams(listener: StreamListener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Reset all registry state (for tests). */
export function _resetLogStreams(): void {
  _systems.clear();
  _order.clear();
  _streamOrder = 0;
  _listeners.clear();
}
