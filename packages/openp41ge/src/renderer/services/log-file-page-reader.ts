/**
 * LogFilePageReader — a `LogPageReader` backed by the daily log files.
 *
 * Talks to the main process over `window.openp41ge.logs.readBackward()` so it
 * pages **backward** through history (the bottom of the newest file first, then
 * older lines, then previous days). Live entries are picked up by polling the
 * newest file's tail (the file is the single source of truth for both main- and
 * renderer-process logs, so there is no echo/duplication concern). Entries are
 * deduped by a `(timestamp|level|system|source|message)` signature.
 */

import {
  LOG_PAGE_DEFAULT_LIMIT,
  type LogPageReader,
  type LogPageResult,
  type LogViewEntry,
} from "openp41ge-core-logger";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "log-file-page-reader");

function sig(e: LogViewEntry): string {
  return `${e.timestamp}|${e.level}|${e.system}|${e.source}|${e.message}`;
}

export class LogFilePageReader implements LogPageReader {
  private _seen = new Set<string>();
  private _listeners = new Set<(entry: LogViewEntry) => void>();
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _capable: boolean | null = null;

  private _toView(e: {
    timestamp: number;
    level: number;
    levelLabel: string;
    system: string;
    source: string;
    message: string;
    process: string;
    errorId?: string;
  }): LogViewEntry {
    return {
      timestamp: e.timestamp,
      level: e.level as LogViewEntry["level"],
      levelLabel: e.levelLabel,
      system: e.system,
      source: e.source,
      message: e.message,
      process: e.process,
      ...(e.errorId ? { errorId: e.errorId } : {}),
    };
  }

  private _markSeen(entries: { source: string }[]): void {
    for (const e of entries) this._seen.add(sig(this._toView(e as never)));
  }

  /**
   * Whether the running main process serves `log:read-backward`. Detected by
   * probing the long-standing `log:path` channel (present in both old and new
   * mains). A newer main advertises `capabilities.readBackward`; an older main
   * does not. We must NOT call `readBackward` on an older main: Electron logs
   * "No handler registered" via console.error for a missing `invoke` channel,
   * which would trip the error capture.
   */
  private async _checkCapability(): Promise<boolean> {
    if (this._capable !== null) return this._capable;
    try {
      const res = await window.openp41ge.logs.getPath();
      this._capable = res?.capabilities?.readBackward === true;
    } catch (err) {
      log.debug("log capability probe failed:", err);
      this._capable = false;
    }
    return this._capable;
  }

  async loadLatest(limit = LOG_PAGE_DEFAULT_LIMIT): Promise<LogPageResult> {
    if (!(await this._checkCapability())) {
      // Caller (the viewer) treats a rejected load as "fall back to the
      // in-memory bus" — so no missing-IPC console.error reaches the overlay.
      throw new Error("LogFilePageReader unsupported: log:read-backward not available");
    }
    const res = await window.openp41ge.logs.readBackward(null, limit);
    this._markSeen(res.entries);
    // Only start polling once the bridge is confirmed working — otherwise a
    // stale main process (no `log:read-backward` handler) would log a
    // `console.error` on every poll and flood the error capture with toasts.
    this._startPolling();
    return this._mapPage(res);
  }

  async loadOlder(cursor: unknown, limit = LOG_PAGE_DEFAULT_LIMIT): Promise<LogPageResult> {
    const res = await window.openp41ge.logs.readBackward(
      cursor as Parameters<typeof window.openp41ge.logs.readBackward>[0],
      limit,
    );
    this._markSeen(res.entries);
    return this._mapPage(res);
  }

  private _mapPage(res: {
    entries: {
      timestamp: number;
      level: number;
      levelLabel: string;
      system: string;
      source: string;
      message: string;
      process: string;
      errorId?: string;
    }[];
    hasOlder: boolean;
    cursor: unknown;
    nextDay?: { cursor: unknown; label: string } | null;
    maxLineChars?: number;
  }): LogPageResult {
    return {
      entries: res.entries.map((e) => this._toView(e)),
      hasOlder: res.hasOlder,
      cursor: res.cursor,
      maxLineChars: res.maxLineChars,
      ...(res.nextDay
        ? {
            nextDayCursor: res.nextDay.cursor as LogPageResult["cursor"],
            nextDayLabel: res.nextDay.label,
          }
        : {}),
    };
  }

  subscribe(listener: (entry: LogViewEntry) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
      if (this._listeners.size === 0) this._stopPolling();
    };
  }

  private _startPolling(): void {
    this._timer = setInterval(() => this._poll(), 1000);
  }

  private _stopPolling(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _poll(): Promise<void> {
    try {
      const res = await window.openp41ge.logs.readBackward(null, LOG_PAGE_DEFAULT_LIMIT);
      for (const raw of res.entries) {
        const entry = this._toView(raw);
        const key = sig(entry);
        if (this._seen.has(key)) continue;
        this._seen.add(key);
        for (const listener of this._listeners) listener(entry);
      }
    } catch (err) {
      // The bridge stopped working (e.g. main process restarted without the
      // handler). Stop polling so we don't keep logging console.error.
      log.debug("log tail polling failed; stopping poll:", err);
      this._stopPolling();
    }
  }
}
