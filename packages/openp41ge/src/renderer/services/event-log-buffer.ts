export interface LogEntry {
  eventId: string;
  timestamp: number;
  eventType: string;
  payload: Record<string, unknown>;
  matchedEdge: {
    id: string;
    from: string;
    when: Record<string, unknown> | null;
    to: string[];
  } | null;
  handlerResults: {
    handlerId: string;
    duration: number;
    error?: string;
  }[];
  totalDuration: number;
  stateSnapshot: Record<string, unknown>;
  sourceFile: string;
}

export interface LogFilter {
  eventType?: string;
  since?: number;
  limit?: number;
}

/**
 * Ring buffer for event log entries.
 * Maintains the last MAX_ENTRIES entries in insertion order.
 */
export class EventLogBuffer {
  private _buffer: LogEntry[] = [];
  private _maxEntries: number;
  private _nextId = 0;

  constructor(maxEntries = 500) {
    this._maxEntries = maxEntries;
  }

  /** Append a new entry to the buffer. */
  append(entry: Omit<LogEntry, "eventId" | "timestamp">): LogEntry {
    const full: LogEntry = {
      eventId: `evt-${++this._nextId}`,
      timestamp: performance.now(),
      ...entry,
    };
    this._buffer.push(full);
    if (this._buffer.length > this._maxEntries) {
      this._buffer.shift();
    }
    return full;
  }

  /** Query entries with optional filters. */
  getLogs(filter?: LogFilter): LogEntry[] {
    let result = this._buffer;
    if (filter?.eventType) {
      result = result.filter((e) => e.eventType === filter.eventType);
    }
    if (filter?.since !== undefined) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter?.limit !== undefined) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  /** Get a single entry by ID. */
  getEvent(eventId: string): LogEntry | undefined {
    return this._buffer.find((e) => e.eventId === eventId);
  }

  /** Clear all entries. */
  clear(): void {
    this._buffer = [];
  }

  /** Current number of entries. */
  get size(): number {
    return this._buffer.length;
  }
}
