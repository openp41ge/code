/**
 * LogFileStore — persists the structured log bus to disk as JSONL.
 *
 * Files live under `<baseDir>/logs/` (default `~/.openp41ge-code/logs`; dev build
 * `~/.openp41ge-code-dev/logs`):
 *   - `openp41ge.log`            — the live day's file (stable name for `tail -f`)
 *   - `openp41ge-YYYY-MM-DD.log` — archived previous days, pruned after
 *                                   retentionDays (default 14)
 *
 * Renderer entries arrive over IPC (`log:append`); main-process entries arrive
 * from the shared log bus via `subscribeLogs`. Everything lands in the same
 * file set, tagged by `process` / `winId` for cross-window correlation.
 */

import fs from "fs";
import path from "path";
import {
  LogLevel,
  LOG_LEVEL_LABELS,
  createLogger,
  logLineChars,
  type LogQuery,
  type StoredLogEntry,
} from "openp41ge-core-logger";

const log = createLogger("openp41ge", "LogFileStore");

/** A level's label (as saved in the file) → the level. */
const LEVEL_BY_LABEL = new Map(
  Object.entries(LOG_LEVEL_LABELS).map(([level, label]) => [label, Number(level) as LogLevel]),
);

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface PersistedLogEntry {
  timestamp: number;
  level: LogLevel;
  levelLabel: string;
  system: string;
  source: string;
  message: string;
  data?: Record<string, unknown>;
  process: "main" | "renderer";
  winId?: string;
  /** Set on ERROR entries: the error's unique id (see `StoredLogEntry`). */
  errorId?: string;
}

/** Cursor for backward paging through the daily log files. */
export interface LogBackCursor {
  /** Index into `listFiles()` (0 = newest file). */
  fileIndex: number;
  /** Raw lines already served from that file's bottom. */
  lineCount: number;
}

export interface LogBackPage {
  /** Entries in this window, oldest → newest. */
  entries: PersistedLogEntry[];
  /** True if more (older) entries are available **within the current file**. */
  hasOlder: boolean;
  /** Cursor to continue older within the current file; `null` when none. */
  cursor: LogBackCursor | null;
  /**
   * Set when `hasOlder` is false and an **older day** exists: the reader must
   * not silently cross the day boundary. Load it only after explicit
   * confirmation (the viewer renders a "Load yesterday's logs" row).
   */
  nextDay?: { cursor: LogBackCursor; label: string } | null;
  /**
   * Monotonic maximum character length of a rendered log line across every
   * entry the store has written or served. The renderer anchors its log-list
   * content width to this so the horizontal scrollbar only grows when a
   * genuinely longer line appears, instead of flickering as the virtual
   * window scrolls past different entries.
   */
  maxLineChars: number;
}

/** Fold a single entry into the store's monotonic longest-line length. */
function foldMax(
  entry: {
    levelLabel?: string;
    level?: LogLevel;
    timestamp: number;
    source: string;
    message: string;
  },
  current: number,
): number {
  const n = logLineChars(entry);
  return n > current ? n : current;
}

const LIVE_FILE = "openp41ge.log";
const MS_PER_DAY = 86_400_000;

/** Rotate the live file beyond this size so a runaway log can never grow
 *  the on-disk log unboundedly (e.g. an error loop writing GBs in minutes). */
const MAX_LIVE_FILE_BYTES = 64 * 1024 * 1024; // 64 MB
/** Backward-read chunk size (bytes) — bounds memory regardless of file size. */
const TAIL_CHUNK_BYTES = 256 * 1024;
/** Line-count scan chunk size (bytes) — bounded memory full-file scan. */
const COUNT_CHUNK_BYTES = 1024 * 1024;

function _dayString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class LogFileStore {
  private readonly _logsDir: string;
  private readonly _retentionDays: number;
  /** Calendar day currently being written to the live file ('' = none yet). */
  private _liveDay = "";
  /** Guards against the log-bus → append → log → append loop on write errors. */
  private _inWrite = false;
  /** Monotonic longest rendered line (chars) across all entries written/served. */
  private _maxLineChars = 0;
  /** Cached total line counts keyed by `name|size|mtime` (avoids rescanning). */
  private _lineCountCache = new Map<string, number>();
  /** Live-file size cap; beyond this the live file is rotated aside. */
  private readonly _maxLiveBytes: number;

  constructor(baseDir: string, retentionDays = 14, maxLiveBytes = MAX_LIVE_FILE_BYTES) {
    this._logsDir = path.join(baseDir, "logs");
    this._retentionDays = Math.max(1, retentionDays);
    this._maxLiveBytes = Math.max(1, maxLiveBytes);
  }

  get logsDir(): string {
    return this._logsDir;
  }

  private get _livePath(): string {
    return path.join(this._logsDir, LIVE_FILE);
  }

  // ── Writing ─────────────────────────────────────────────────────────

  private _ensureDir(): void {
    if (!fs.existsSync(this._logsDir)) {
      fs.mkdirSync(this._logsDir, { recursive: true });
    }
  }

  private _rollOverIfNeeded(): void {
    const today = _dayString(new Date());
    if (this._liveDay === today) return;
    this._ensureDir();

    if (fs.existsSync(this._livePath)) {
      try {
        const mtimeDay = _dayString(new Date(fs.statSync(this._livePath).mtimeMs));
        // Same-day restart: keep appending to the existing live file.
        // New calendar day: archive the live file, naming it by its own day.
        if (mtimeDay !== today) {
          const archiveDay = this._liveDay || mtimeDay;
          const archivePath = path.join(this._logsDir, `openp41ge-${archiveDay}.log`);
          if (!fs.existsSync(archivePath)) {
            fs.renameSync(this._livePath, archivePath);
          } else {
            // Rare: archive already exists — append live into it, then drop it.
            fs.appendFileSync(archivePath, fs.readFileSync(this._livePath, "utf-8"), "utf-8");
            fs.rmSync(this._livePath, { force: true });
          }
        }
      } catch {
        // Archive rollover is best-effort; keep writing to the live file.
      }
    }

    this._liveDay = today;
    this._pruneArchives();
  }

  /** Move the live file aside (as a queryable archive) once it exceeds the size
   *  cap, then continue writing to a fresh live file. Best-effort: never blocks
   *  logging. Prevents a runaway writer from consuming unbounded disk. */
  private _rotateIfTooLarge(): void {
    try {
      const st = fs.statSync(this._livePath);
      if (st.size <= this._maxLiveBytes) return;
      const day = this._liveDay || _dayString(new Date());
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = path.join(this._logsDir, `openp41ge-${day}-${stamp}.log`);
      if (fs.existsSync(archivePath)) {
        // Cannot rename onto an existing archive — drop the runaway tail instead.
        fs.rmSync(this._livePath, { force: true });
      } else {
        fs.renameSync(this._livePath, archivePath);
      }
    } catch {
      // best-effort; keep logging
    }
  }

  private _serialize(entry: StoredLogEntry): string {
    const line: Record<string, unknown> = {
      timestamp: entry.timestamp,
      level: LOG_LEVEL_LABELS[entry.level],
      system: entry.system,
      source: entry.source,
      message: entry.message,
      process: entry.process,
    };
    if (entry.data !== undefined && entry.data !== null) {
      line.data = entry.data;
    }
    if (entry.winId) {
      line.winId = entry.winId;
    }
    if (entry.errorId) {
      line.errorId = entry.errorId;
    }
    return JSON.stringify(line);
  }

  /** Append a single entry (main-process bus subscription). */
  append(entry: StoredLogEntry): void {
    if (!entry || this._inWrite) return;
    this._inWrite = true;
    try {
      this._rollOverIfNeeded();
      this._rotateIfTooLarge();
      fs.appendFileSync(this._livePath, this._serialize(entry) + "\n", "utf-8");
      this._maxLineChars = foldMax(entry, this._maxLineChars);
    } catch (err) {
      // Never let persistence take down the app.
      log.error("[LogFileStore] append failed:", err);
    } finally {
      this._inWrite = false;
    }
  }

  /** Append a batch of entries (renderer IPC flush). */
  appendBatch(entries: readonly StoredLogEntry[]): void {
    if (!entries || entries.length === 0 || this._inWrite) return;
    this._inWrite = true;
    try {
      this._rollOverIfNeeded();
      this._rotateIfTooLarge();
      const lines = entries.map((e) => this._serialize(e)).join("\n") + "\n";
      fs.appendFileSync(this._livePath, lines, "utf-8");
      for (const e of entries) this._maxLineChars = foldMax(e, this._maxLineChars);
    } catch (err) {
      log.error("[LogFileStore] appendBatch failed:", err);
    } finally {
      this._inWrite = false;
    }
  }

  // ── Retention ───────────────────────────────────────────────────────

  private _pruneArchives(): void {
    const cutoff = Date.now() - this._retentionDays * MS_PER_DAY;
    let files: string[];
    try {
      files = fs.readdirSync(this._logsDir);
    } catch {
      return;
    }
    for (const name of files) {
      if (!name.startsWith("openp41ge-") || name === LIVE_FILE) continue;
      try {
        const p = path.join(this._logsDir, name);
        if (fs.statSync(p).mtimeMs < cutoff) {
          fs.rmSync(p, { force: true });
        }
      } catch {
        // ignore
      }
    }
  }

  // ── Reading (agent + overlay queries) ────────────────────────────────

  /** List log files in the logs dir (newest mtime first). */
  listFiles(): LogFileInfo[] {
    this._ensureDir();
    try {
      return fs
        .readdirSync(this._logsDir)
        .filter((name) => name.startsWith("openp41ge") && name.endsWith(".log"))
        .map((name) => {
          const p = path.join(this._logsDir, name);
          const st = fs.statSync(p);
          return { name, sizeBytes: st.size, mtimeMs: st.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return [];
    }
  }

  private _parseLine(line: string): PersistedLogEntry | null {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const levelLabel = String(raw.level ?? "INFO").toUpperCase();
      return {
        timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
        // The file holds the label ("ERROR"); read back the level it names.
        level: LEVEL_BY_LABEL.get(levelLabel) ?? LogLevel.INFO,
        levelLabel,
        system: String(raw.system ?? "unknown"),
        source: String(raw.source ?? "unknown"),
        message: String(raw.message ?? ""),
        ...(raw.data !== undefined ? { data: raw.data as Record<string, unknown> } : {}),
        process: raw.process === "main" ? "main" : "renderer",
        ...(typeof raw.winId === "string" ? { winId: raw.winId } : {}),
        ...(typeof raw.errorId === "string" ? { errorId: raw.errorId } : {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * Total count of newline-delimited (non-blank) lines in a file, computed with
   * a bounded-memory streaming scan and cached per `name|size|mtime`. Never
   * reads the whole file into one string, so a huge log can't OOM the process.
   */
  private _countLines(fileName: string): number {
    const full = path.join(this._logsDir, fileName);
    let size = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(full);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      return 0;
    }
    const key = `${fileName}|${size}|${mtime}`;
    const cached = this._lineCountCache.get(key);
    if (cached !== undefined) return cached;

    let fd: number;
    try {
      fd = fs.openSync(full, "r");
    } catch {
      return 0;
    }
    let count = 0;
    try {
      const buf = Buffer.alloc(COUNT_CHUNK_BYTES);
      let offset = 0;
      for (;;) {
        const n = fs.readSync(fd, buf, 0, COUNT_CHUNK_BYTES, offset);
        if (n <= 0) break;
        for (let i = 0; i < n; i++) if (buf[i] === 0x0a) count++;
        offset += n;
      }
      // A final line with no trailing newline still counts as a line.
      if (offset > 0) {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, offset - 1);
        if (last[0] !== 0x0a) count++;
      }
    } catch {
      count = 0;
    } finally {
      fs.closeSync(fd);
    }
    this._lineCountCache.set(key, count);
    return count;
  }

  /**
   * Return the last `count` non-blank lines of a file, oldest → newest, by
   * reading **backward** in bounded chunks. Never loads the whole file into
   * memory, so the main process can read even a runaway multi-GB log without
   * crashing. `count` bounds how many lines are ever retained at once.
   */
  private _readTailLines(fileName: string, count: number): string[] {
    const full = path.join(this._logsDir, fileName);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      return [];
    }
    if (size <= 0 || count <= 0) return [];

    let fd: number;
    try {
      fd = fs.openSync(full, "r");
    } catch {
      return [];
    }
    let text = "";
    let newlines = 0;
    let start = size;
    try {
      while (start > 0 && newlines < count) {
        const chunkStart = Math.max(0, start - TAIL_CHUNK_BYTES);
        const buf = Buffer.alloc(start - chunkStart);
        const n = fs.readSync(fd, buf, 0, buf.length, chunkStart);
        if (n <= 0) break;
        for (let i = 0; i < n; i++) if (buf[i] === 0x0a) newlines++;
        text = buf.subarray(0, n).toString("utf-8") + text;
        start = chunkStart;
      }
    } finally {
      fs.closeSync(fd);
    }

    // If we didn't reach the top of the file, `text` may begin mid-line; drop
    // that leading partial fragment so line indexes stay exact.
    if (start > 0) {
      let prev: number;
      try {
        const probe = Buffer.alloc(1);
        const pfd = fs.openSync(full, "r");
        try {
          fs.readSync(pfd, probe, 0, 1, start - 1);
        } finally {
          fs.closeSync(pfd);
        }
        prev = probe[0];
      } catch {
        prev = 0x0a; // if probe fails, assume a line boundary (over-read safest)
      }
      if (prev !== 0x0a) {
        const idx = text.indexOf("\n");
        text = idx >= 0 ? text.slice(idx + 1) : "";
      }
    }

    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(-count);
  }

  /**
   * Human label for the confirmation row shown at a day boundary.
   *
   * Files are newest-first, so the file at `fileIndex` is normally `fileIndex`
   * days old. When the name embeds a `YYYY-MM-DD` date, that is used to compute
   * an exact age; otherwise the index is the fallback.
   */
  private _dayBoundaryLabel(fileName: string, fileIndex: number): string {
    let daysAgo = fileIndex;
    const m = /openp41ge-(\d{4}-\d{2}-\d{2})\.log$/.exec(fileName);
    if (m) {
      const fileDate = new Date(`${m[1]}T00:00:00`);
      const today = new Date(`${_dayString(new Date())}T00:00:00`);
      if (!Number.isNaN(fileDate.getTime())) {
        const diff = Math.round((today.getTime() - fileDate.getTime()) / MS_PER_DAY);
        if (diff > 0) daysAgo = diff;
      }
    }
    if (daysAgo === 1) return "Load yesterday's logs";
    return `Load logs from ${daysAgo} days ago`;
  }

  /**
   * Read log entries **backward**, strictly **within a single daily file**.
   *
   * Starts at the bottom of the file at `cursor.fileIndex` (0 = newest) and
   * returns up to `limit` entries (oldest → newest), plus a cursor to continue
   * loading older lines **from that same file**. When the file is exhausted,
   * `hasOlder` is `false` and, if an older day exists, `nextDay` is set — the
   * reader must not silently cross the day boundary; it loads that file only
   * after explicit confirmation.
   *
   * `cursor === null` means "start at the very end of the newest file".
   */
  readLogsBackward(cursor: LogBackCursor | null, limit = 200): LogBackPage {
    const files = this.listFiles(); // newest first
    if (files.length === 0) {
      return {
        entries: [],
        hasOlder: false,
        cursor: null,
        nextDay: null,
        maxLineChars: this._maxLineChars,
      };
    }
    const want = Math.max(1, Math.floor(limit));
    const fileIndex = cursor ? Math.max(0, Math.min(cursor.fileIndex, files.length - 1)) : 0;
    const lineCount = cursor ? Math.max(0, cursor.lineCount) : 0;

    const fileName = files[fileIndex].name;
    const total = this._countLines(fileName);

    // Current file fully consumed → expose the older day as a confirmable
    // boundary, rather than silently crossing into it.
    if (lineCount >= total) {
      const nextIndex = fileIndex + 1;
      if (nextIndex < files.length) {
        return {
          entries: [],
          hasOlder: false,
          cursor: null,
          nextDay: {
            cursor: { fileIndex: nextIndex, lineCount: 0 },
            label: this._dayBoundaryLabel(files[nextIndex].name, nextIndex),
          },
          maxLineChars: this._maxLineChars,
        };
      }
      return {
        entries: [],
        hasOlder: false,
        cursor: null,
        nextDay: null,
        maxLineChars: this._maxLineChars,
      };
    }

    // Read only the tail window we need (never the whole file), so a huge or
    // runaway log cannot exhaust the main process's memory.
    const tail = this._readTailLines(fileName, lineCount + want);
    // `tail` is the last (lineCount + want) lines; the window is the first
    // `want` of those, i.e. all but the final `lineCount` (already-served) ones.
    const window = tail.slice(0, Math.max(0, tail.length - lineCount)).slice(-want);
    const entries: PersistedLogEntry[] = [];
    for (const line of window) {
      const entry = this._parseLine(line);
      if (entry) {
        entries.push(entry);
        this._maxLineChars = foldMax(entry, this._maxLineChars);
      }
    }

    const newLineCount = lineCount + entries.length;
    const hasMoreInFile = newLineCount < total;
    const hasOlder = hasMoreInFile;
    const nextDay = hasOlder
      ? null
      : fileIndex + 1 < files.length
        ? {
            cursor: { fileIndex: fileIndex + 1, lineCount: 0 },
            label: this._dayBoundaryLabel(files[fileIndex + 1].name, fileIndex + 1),
          }
        : null;
    return {
      entries,
      hasOlder,
      cursor: hasOlder ? { fileIndex, lineCount: newLineCount } : null,
      nextDay,
      maxLineChars: this._maxLineChars,
    };
  }

  /**
   * Query persisted log entries across the most recent files (newest first,
   * within a file oldest → newest). Returns matches in read order;
   * `limit` caps the result set to the first N matches.
   */
  query(filter: LogQuery = {}): PersistedLogEntry[] {
    const sources = filter.source
      ? new Set(Array.isArray(filter.source) ? filter.source : [filter.source])
      : null;
    const minLevel = filter.minLevel ?? LogLevel.DEBUG;
    const maxLevel = filter.maxLevel ?? LogLevel.ERROR;
    const search = filter.search?.trim().toLowerCase();

    const files = this.listFiles().slice(0, 8);
    const collected: PersistedLogEntry[] = [];

    for (const file of files) {
      let content = "";
      try {
        content = fs.readFileSync(path.join(this._logsDir, file.name), "utf-8");
      } catch {
        continue;
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const entry = this._parseLine(line);
        if (!entry) continue;
        if (sources && !sources.has(entry.source)) continue;
        if (entry.level < minLevel || entry.level > maxLevel) continue;
        if (filter.since !== undefined && entry.timestamp < filter.since) continue;
        if (filter.before !== undefined && entry.timestamp > filter.before) continue;
        if (filter.process !== undefined && entry.process !== filter.process) continue;
        if (filter.winId !== undefined && entry.winId !== filter.winId) continue;
        if (search) {
          const haystack = `${entry.source} ${entry.message}`.toLowerCase();
          if (!haystack.includes(search)) continue;
        }
        collected.push(entry);
        if (filter.limit !== undefined && filter.limit > 0 && collected.length >= filter.limit) {
          return collected;
        }
      }
    }

    return collected;
  }

  /**
   * The persisted entry with this `errorId` (newest file first), or null. Used
   * to open an error in the Logs window from a link elsewhere in the app.
   */
  findError(errorId: string): PersistedLogEntry | null {
    const needle = JSON.stringify(errorId);
    for (const file of this.listFiles()) {
      let content = "";
      try {
        content = fs.readFileSync(path.join(this._logsDir, file.name), "utf-8");
      } catch {
        continue;
      }
      if (!content.includes(needle)) continue;
      for (const line of content.split("\n")) {
        if (!line.includes(needle)) continue;
        const entry = this._parseLine(line);
        if (entry?.errorId === errorId) return entry;
      }
    }
    return null;
  }
}
