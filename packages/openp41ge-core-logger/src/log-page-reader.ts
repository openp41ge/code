/**
 * log-page-reader.ts — a source of log entries that can be paged **backward**
 * (newest first), plus a default in-memory implementation.
 *
 * The `<openp41ge-log-viewer>` consumes a `LogPageReader` so the platform can
 * hand it a file-backed reader (over `~/.openp41ge/logs` daily files) while
 * the package stays self-contained by defaulting to `MemLogPageReader` (the
 * in-memory log bus).
 */

import {
  getLogBuffer,
  subscribeLogs,
  LOG_LEVEL_LABELS,
  type LogEntry,
  type LogLevel,
} from "./log-buffer";

/** Lightweight display shape the viewer renders. */
export interface LogViewEntry {
  timestamp: number;
  level: LogLevel;
  levelLabel: string;
  system: string;
  source: string;
  message: string;
  process: string;
}

/** A page of entries (oldest → newest) plus a cursor to continue older. */
export interface LogPageResult {
  entries: LogViewEntry[];
  /** True if there is at least one more (older) entry to load **in the same
   * source/day**. When false but `nextDayCursor` is set, an older day exists
   * that must be loaded only after explicit confirmation. */
  hasOlder: boolean;
  /** Opaque cursor for the next `loadOlder` call; `null` when no older. */
  cursor: unknown;
  /** When `hasOlder` is false, this cursor loads the previous day after the
   * user confirms (a day boundary). Absent when no older day exists. */
  nextDayCursor?: unknown;
  /** Human label for the confirmation row (e.g. "Load yesterday's logs"). */
  nextDayLabel?: string;
  /**
   * Monotonic maximum character length of a rendered log line in this source
   * (computed on the node/main side over everything it has served so far).
   * The viewer uses it to anchor the log list's content width so the
   * horizontal scrollbar only changes when a genuinely longer line is loaded,
   * rather than every time the virtual window scrolls to a different set of
   * entries. Absent on readers that don't track it (treated as unknown).
   */
  maxLineChars?: number;
}

/** Source of backward-paginated log entries with live subscription. */
export interface LogPageReader {
  /** Load the most-recent `limit` entries (the bottom of the log). */
  loadLatest(limit?: number): Promise<LogPageResult>;
  /** Load the next (older) `limit` entries after `cursor`. */
  loadOlder(cursor: unknown, limit?: number): Promise<LogPageResult>;
  /** Subscribe to new entries appended at the newest end. */
  subscribe(listener: (entry: LogViewEntry) => void): () => void;
}

export const LOG_PAGE_DEFAULT_LIMIT = 300;

/** Format a timestamp as the viewer's clock string (HH:MM:SS). */
export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/**
 * Character length of a rendered log line.
 *
 * The viewer draws each line as `LEVEL HH:MM:SS [source] message` in a
 * monospace font (spacing between the segments is CSS margins, not spaces), so
 * the line's pixel width is `charWidth * chars + fixedSpacing`. The node (main
 * process) uses this to report the longest line in the log store, and the
 * renderer converts it to a pixel width so the horizontal scrollbar stays
 * stable regardless of which entries are currently in the virtual window.
 */
export function logLineChars(e: {
  levelLabel?: string;
  level?: LogLevel;
  timestamp: number;
  source: string;
  message: string;
}): number {
  const label = e.levelLabel ?? (e.level !== undefined ? LOG_LEVEL_LABELS[e.level] : "INFO");
  return label.length + formatLogTime(e.timestamp).length + e.source.length + 2 + e.message.length;
}

function toViewEntry(e: LogEntry): LogViewEntry {
  return {
    timestamp: e.timestamp,
    level: e.level,
    levelLabel: LOG_LEVEL_LABELS[e.level],
    system: e.system,
    source: e.source,
    message: e.text,
    process: e.process,
  };
}

/**
 * In-memory `LogPageReader` over the global log bus.
 *
 * Cursor is the `id` of the oldest entry in the currently-loaded window — the
 * exclusive bound for loading older entries. Works because ids are monotonic,
 * so it's stable even when the buffer trims from the front.
 */
export class MemLogPageReader implements LogPageReader {
  /** Monotonic running max line length over every entry served. */
  private _maxLineChars = 0;

  private _foldMax(entries: LogViewEntry[]): void {
    for (const e of entries) {
      const n = logLineChars(e);
      if (n > this._maxLineChars) this._maxLineChars = n;
    }
  }

  async loadLatest(limit = LOG_PAGE_DEFAULT_LIMIT): Promise<LogPageResult> {
    const buf = getLogBuffer();
    const count = Math.min(limit, buf.length);
    const window = buf.slice(buf.length - count);
    const entries = window.map(toViewEntry);
    const oldestId = window.length > 0 ? window[0].id : null;
    const hasOlder = buf.length > count;
    this._foldMax(entries);
    return {
      entries,
      hasOlder,
      cursor: hasOlder ? oldestId : null,
      maxLineChars: this._maxLineChars,
    };
  }

  async loadOlder(cursor: unknown, limit = LOG_PAGE_DEFAULT_LIMIT): Promise<LogPageResult> {
    const beforeId = typeof cursor === "number" ? cursor : Number.MAX_SAFE_INTEGER;
    const older = getLogBuffer().filter((e) => e.id < beforeId);
    const count = Math.min(limit, older.length);
    const window = older.slice(older.length - count);
    const entries = window.map(toViewEntry);
    const oldestId = window.length > 0 ? window[0].id : null;
    const hasOlder = older.length > count;
    this._foldMax(entries);
    return {
      entries,
      hasOlder,
      cursor: hasOlder ? oldestId : null,
      maxLineChars: this._maxLineChars,
    };
  }

  subscribe(listener: (entry: LogViewEntry) => void): () => void {
    return subscribeLogs((entry) => {
      if (entry) listener(toViewEntry(entry));
    });
  }
}
