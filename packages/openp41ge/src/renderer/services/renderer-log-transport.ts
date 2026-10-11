/**
 * renderer-log-transport — pushes the renderer log bus to the main process.
 *
 * Subscribes to the shared openp41ge-core-logger bus, coalesces captured entries
 * into batches, and forwards them over `window.openp41ge.logs.append()` so they
 * land in <dataDir>/logs alongside main-process entries.
 *
 * The bus already gates capture by level (DEBUG only while a debug session is
 * enabled), so this transport simply forwards whatever was captured — no extra
 * filtering, and nothing to do when debug is off.
 *
 * Each entry is stamped with the live window id at flush time (the preload
 * bridge resolves `openp41ge:init` lazily, so it may not exist at bootstrap).
 */

import { subscribeLogs, getLogBuffer, type StoredLogEntry } from "openp41ge-core-logger";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "renderer-log-transport");

const FLUSH_INTERVAL_MS = 120;
const MAX_BATCH = 200;

let _pending: StoredLogEntry[] = [];
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsub: (() => void) | null = null;
let _started = false;

function _canForward(): boolean {
  return typeof window !== "undefined" && !!window.openp41ge?.logs?.append;
}

function _resolveWinId(): string | undefined {
  return typeof window !== "undefined"
    ? (window.openp41ge?.workspace?.getWindowId?.() ?? undefined)
    : undefined;
}

function _serialize(e: StoredLogEntry): Record<string, unknown> {
  const line: Record<string, unknown> = {
    timestamp: e.timestamp,
    level: e.level,
    system: e.system,
    source: e.source,
    message: e.message,
    process: e.process,
  };
  if (e.data !== undefined && e.data !== null) line.data = e.data;
  const winId = e.winId ?? _resolveWinId();
  if (winId) line.winId = winId;
  if (e.errorId) line.errorId = e.errorId;
  return line;
}

function flush(): void {
  if (_pending.length === 0 || !_canForward()) {
    _pending = [];
    return;
  }
  const batch = _pending;
  _pending = [];
  try {
    window.openp41ge.logs.append(batch.map(_serialize));
  } catch (err) {
    // Never let log forwarding break the app.
    log.debug("log forwarding failed:", err);
  }
}

function _teardown(): void {
  _unsub?.();
  _unsub = null;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("pagehide", flush);
  }
  _pending = [];
  _started = false;
}

/**
 * Start the renderer log transport. Safe to call repeatedly (idempotent).
 * Returns a cleanup function.
 */
export function initRendererLogTransport(): () => void {
  if (_started) return () => {};

  if (!_canForward()) {
    // No preload bridge (e.g. demo app, tests) — mark started so callers don't
    // retry; forwarding stays a no-op.
    _started = true;
    return () => {
      _started = false;
    };
  }
  _started = true;

  // Forward anything already captured (earlier bootstrap steps) before the
  // subscription is live, so early logs are not lost.
  _pending.push(...getLogBuffer());

  const unsub = subscribeLogs((entry) => {
    if (!entry) {
      _pending = [];
      return;
    }
    _pending.push(entry);
    if (_pending.length >= MAX_BATCH) flush();
  });
  _unsub = unsub;

  _timer = setInterval(flush, FLUSH_INTERVAL_MS);
  window.addEventListener("pagehide", flush);

  // Flush the initial snapshot immediately.
  flush();

  return _teardown;
}

/** Test helper: force a full teardown so the next init() starts clean. */
export function _resetRendererLogTransportForTests(): void {
  _teardown();
}
