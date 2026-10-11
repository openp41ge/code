/**
 * log-buffer.ts — Global structured log / event bus shared across all loggers.
 *
 * This module is the app's permanent logging pipeline. Every feature emits
 * structured entries (via `createLogger()` in logger.ts); the bus multiplexes
 * them to pluggable transports:
 *
 *   - the in-memory ring buffer (`getLogBuffer()` / `queryLog()`) that the
 *     `<openp41ge-log-viewer>` and the overlay's `<debug-log-panel>` render,
 *   - the console (`console-transport.ts`),
 *   - the main-process `LogFileStore` (persisted to `~/.openp41ge/logs/`),
 *   - the renderer IPC transport (`renderer-log-transport.ts`).
 *
 * Capture levels: INFO/WARN/ERROR are always captured. DEBUG is captured only
 * while a debug session is enabled via `setMinLevel(LogLevel.DEBUG)` (the
 * overlay's session toggle). Entries below the capture threshold are dropped
 * before they reach any transport.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** Which process produced an entry. */
export type LogProcess = "main" | "renderer";

/** Human-readable label for each level. */
export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

export interface StoredLogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  /** The system (plugin id / subsystem) this entry belongs to. */
  system: string;
  /** The stream name (logger namespace) within the system. */
  source: string;
  message: string;
  /** Structured payload (optional) — queryable, persisted as JSON. */
  data?: Record<string, unknown>;
  process: LogProcess;
  /** Renderer window id (renderer process only). */
  winId?: string;
}

export interface LogEntry extends StoredLogEntry {
  /** = `source` — backward-compatible alias used by `<openp41ge-log-viewer>`. */
  name: string;
  /** Rendered message (message + stringified data). Backward-compatible alias. */
  text: string;
  /**
   * Original args passed to the logger — used only by the console transport to
   * replay the exact developer call. Never persisted.
   */
  args?: readonly unknown[];
}

/** Query filters for `queryLog()` — all optional, all ANDed. */
export interface LogQuery {
  system?: string | readonly string[];
  source?: string | readonly string[];
  minLevel?: LogLevel;
  maxLevel?: LogLevel;
  since?: number;
  before?: number;
  /** Cap the result to the most-recent `limit` matches. */
  limit?: number;
  /** Case-insensitive substring match against source + message + text. */
  search?: string;
  process?: LogProcess;
  winId?: string;
}

// ── Global buffer (module-level singleton) ──

const _buffer: LogEntry[] = [];
let _nextId = 0;
const _listeners = new Set<(entry: LogEntry | null) => void>();

const MAX_LOG_ENTRIES = 10_000;

/** Capture threshold — entries below this level are not logged at all. */
let _minLevel: LogLevel = LogLevel.INFO;

/** Default process tag for entries in this JS context. */
const _defaultProcess: LogProcess = typeof window === "undefined" ? "main" : "renderer";

function _tryStringify(obj: unknown): string {
  // Errors have no enumerable own props — their .message/.stack is what matters.
  if (obj instanceof Error) return String(obj);
  try {
    const json = JSON.stringify(obj);
    return json === undefined ? String(obj) : json;
  } catch {
    return String(obj);
  }
}

function _renderText(message: string | readonly unknown[]): string {
  const parts = Array.isArray(message) ? message : [message];
  return parts
    .map((a) => (typeof a === "object" && a !== null ? _tryStringify(a) : String(a)))
    .join(" ");
}

/**
 * Push a structured entry to the global log bus.
 *
 * `message` may be a plain string or an array of args (legacy callers —
 * they are joined with spaces, as before).
 *
 * Returns the created entry, or `null` if it was dropped by the capture
 * threshold (level < `getMinLevel()`).
 */
export function pushLog(
  level: LogLevel,
  system: string,
  source: string,
  message: string | readonly unknown[],
  data?: Record<string, unknown>,
): LogEntry | null {
  if (level < _minLevel) return null;

  const rendered = _renderText(message);
  const entry: LogEntry = {
    id: _nextId++,
    timestamp: Date.now(),
    level,
    system,
    source,
    message: rendered,
    ...(data !== undefined ? { data } : {}),
    process: _defaultProcess,
    name: source,
    text: rendered,
    args: Array.isArray(message) ? message : [message],
  };
  _buffer.push(entry);

  // Trim oldest entries when buffer exceeds capacity
  if (_buffer.length > MAX_LOG_ENTRIES) {
    _buffer.splice(0, _buffer.length - MAX_LOG_ENTRIES);
  }

  for (const listener of _listeners) {
    try {
      listener(entry);
    } catch {
      // Silently ignore listener errors to avoid cascading failures
    }
  }
  return entry;
}

/** Return a snapshot of the current log buffer (oldest → newest). */
export function getLogBuffer(): readonly LogEntry[] {
  return [..._buffer];
}

/**
 * Query the captured log buffer with optional filters.
 * Returns matches oldest → newest; `limit` caps to the most recent matches.
 */
export function queryLog(filter: LogQuery = {}): readonly LogEntry[] {
  const systems = filter.system
    ? new Set(Array.isArray(filter.system) ? filter.system : [filter.system])
    : null;
  const sources = filter.source
    ? new Set(Array.isArray(filter.source) ? filter.source : [filter.source])
    : null;
  const search = filter.search?.trim().toLowerCase();

  const matches = _buffer.filter((e) => {
    if (systems && !systems.has(e.system)) return false;
    if (sources && !sources.has(e.source)) return false;
    if (filter.minLevel !== undefined && e.level < filter.minLevel) return false;
    if (filter.maxLevel !== undefined && e.level > filter.maxLevel) return false;
    if (filter.since !== undefined && e.timestamp < filter.since) return false;
    if (filter.before !== undefined && e.timestamp > filter.before) return false;
    if (filter.process !== undefined && e.process !== filter.process) return false;
    if (filter.winId !== undefined && e.winId !== filter.winId) return false;
    if (search) {
      const haystack = `${e.source} ${e.message} ${e.text}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (filter.limit !== undefined && filter.limit > 0 && matches.length > filter.limit) {
    return matches.slice(matches.length - filter.limit);
  }
  return matches;
}

/** Clear all log entries and notify listeners (with `null`). */
export function clearLogBuffer(): void {
  _buffer.length = 0;
  for (const listener of _listeners) {
    try {
      listener(null);
    } catch {
      // ignore
    }
  }
}

/**
 * Subscribe to the log bus.
 *
 * The listener is called with the newly pushed entry (or `null` on clear).
 * Because it receives no useful args historically, existing callers that
 * re-read `getLogBuffer()` still work. Returns an unsubscribe function.
 */
export function subscribeLogs(listener: (entry: LogEntry | null) => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Set the capture threshold. Entries below `level` are dropped before they
 * reach any transport. Default is INFO (so DEBUG is only captured while a
 * debug session is explicitly enabled). Set DEBUG to begin capturing debug.
 */
export function setMinLevel(level: LogLevel): void {
  _minLevel = level;
}

/** Current capture threshold. */
export function getMinLevel(): LogLevel {
  return _minLevel;
}
