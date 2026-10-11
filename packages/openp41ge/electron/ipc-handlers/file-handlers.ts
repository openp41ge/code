/**
 * File system IPC handlers.
 */

import { ipcMain, dialog } from "electron";
import fs from "fs";
import path from "path";
import { createLogger } from "openp41ge-core-logger";
import type { OperationDispatcher } from "../../src/main/index.js";
import type { ElectronFileSystem } from "../../src/main/index.js";
import { currentBranchOf } from "../../src/main/services/node-git-service.js";
import {
  findMatchesInText,
  countMatchesInText,
  type ContentMatchOptions,
  type FileContentMatch,
} from "../../src/main/services/content-search.js";

const log = createLogger("openp41ge", "file-handlers");

/**
 * What the streaming walk reports per matching file: enough to render the file
 * row, its badge and its ancestor chain, but none of the match lines.
 *
 * The renderer needs a count for every hit (badges, directory totals, which
 * rows survive the filter, which folders to reveal) but only needs the match
 * lines for files whose rows are actually expanded — a handful at a time. The
 * lines are fetched per file via `file:contentMatchesForFile`.
 */
interface ContentMatchIndexEntry {
  path: string;
  name: string;
  dir: string;
  count: number;
  truncated?: boolean;
}

/** How often (in files scanned) to yield to the event loop during a walk. */
const YIELD_EVERY = 32;

/**
 * Directories that are never descended into while walking for content matches.
 * Skipping these (node_modules, build output, etc.) keeps a short query from
 * synchronously reading tens of thousands of files, which previously made the
 * Explorer appear stuck on “Searching…” for a 2-letter query.
 */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  ".venv",
  "__pycache__",
  "coverage",
  "target",
  ".turbo",
]);

/** Hard cap on files read per walk, independent of how many matched. */
const MAX_SCANNED_FILES = 5000;

/** Hard cap on matching files reported per walk. */
const MAX_MATCHING_FILES = 200;

/** Files larger than this are skipped entirely. */
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Hard cap on match instances reported per file.
 *
 * A 1-2 character query ("d", then "dr") matches thousands of times in a single
 * file. Sending every instance produced huge IPC payloads and one Explorer tree
 * row per instance, which locked the renderer up for good. The cap also stops
 * the per-file scan early, so long files cost the cap rather than their length.
 */
const MAX_MATCHES_PER_FILE = 200;

/**
 * Longest match line sent to the renderer. The Explorer crops to ~44 visible
 * characters, so anything beyond a comfortable context window is dead weight —
 * and on a minified single-line file the untruncated line is the whole file.
 */
const MAX_LINE_CHARS = 400;

/**
 * Index entries buffered before a chunk is sent.
 *
 * One IPC message per matching file meant ~200 sends (each a structured clone)
 * for a broad query; batching cuts that by an order of magnitude without
 * delaying the first results noticeably.
 */
const CHUNK_BATCH_SIZE = 25;

/**
 * Search ids the renderer has asked to stop (`file:cancelContentSearch`). A
 * walk checks `isCancelled` periodically so superseded searches stop promptly
 * instead of every partial keystroke piling up full un-cancellable walks
 * (which saturated the main process and left the UI stuck on “Searching…”).
 *
 * Mapped to the cancel timestamp so stale entries (a cancel that lands after
 * the search already finished) are pruned automatically and can't grow the
 * map unboundedly.
 */
const cancelledSearches = new Map<string, number>();
const CANCEL_STALE_MS = 5000;

/**
 * Decide what a walked file contributes, or `null` when it doesn't match.
 * Keeping this a parameter lets the streaming walk collect cheap per-file
 * counts while the one-shot walk collects full match lists.
 */
type ContentWalkCollector<T> = (fullPath: string, name: string, content: string) => T | null;

/**
 * Walk `rootPaths`, reading text files and collecting whatever `collect`
 * returns for the ones that match. `onFile` (when provided) is invoked for each
 * matching file as soon as it is found — enabling incremental/streaming
 * delivery. `isCancelled` (when provided) lets a superseded search stop early.
 */
async function walkContentSearch<T>(
  rootPaths: string[],
  collect: ContentWalkCollector<T>,
  onFile?: (result: T) => void,
  isCancelled?: () => boolean,
): Promise<T[]> {
  const results: T[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (isCancelled?.()) return;
    if (depth > 6 || results.length >= MAX_MATCHING_FILES || scanned >= MAX_SCANNED_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      log.debug("content-search cannot read dir; skipping:", dir, err);
      return;
    }
    for (const entry of entries) {
      if (isCancelled?.()) return;
      if (results.length >= MAX_MATCHING_FILES) return;
      if (scanned >= MAX_SCANNED_FILES) return;
      if (entry.name.startsWith(".") && depth < 2) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);
        const content = readTextFile(fullPath);
        if (content === null) continue;
        const result = collect(fullPath, entry.name, content);
        scanned += 1;
        if (result !== null) {
          results.push(result);
          onFile?.(result);
        }
        // Let the main process breathe and flush queued IPC messages so the
        // renderer can render results as they arrive.
        if (scanned % YIELD_EVERY === 0) {
          await new Promise((r) => setTimeout(r, 0));
          if (isCancelled?.()) return;
        }
      }
    }
  }

  for (const root of rootPaths) {
    try {
      await walk(path.resolve(root), 0);
    } catch (err) {
      log.warn("content-search invalid root; skipping:", root, err);
    }
    if (isCancelled?.() || results.length >= MAX_MATCHING_FILES) break;
  }

  return results;
}

/** Read a searchable text file, or null when it is missing, huge or binary. */
function readTextFile(fullPath: string): string | null {
  let content: string;
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0 || stat.size > MAX_FILE_BYTES) return null;
    content = fs.readFileSync(fullPath, "utf8");
  } catch {
    return null;
  }
  const sample = content.slice(0, 8000);
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) return null; // binary
  }
  return content;
}

/** Collector producing the lightweight index entry streamed during a search. */
function indexCollector(
  query: string,
  options: ContentMatchOptions | undefined,
): ContentWalkCollector<ContentMatchIndexEntry> {
  return (fullPath, name, content) => {
    const count = countMatchesInText(content, query, {
      ...options,
      maxMatches: MAX_MATCHES_PER_FILE,
    });
    if (count === 0) return null;
    return {
      path: fullPath,
      name,
      dir: path.dirname(fullPath),
      count,
      truncated: count >= MAX_MATCHES_PER_FILE,
    };
  };
}

/** Extract a file's match lines under the shared per-file and per-line caps. */
function matchesForContent(
  content: string,
  query: string,
  options: ContentMatchOptions | undefined,
): FileContentMatch[] {
  return findMatchesInText(content, query, {
    ...options,
    maxMatches: MAX_MATCHES_PER_FILE,
    maxLineChars: MAX_LINE_CHARS,
  });
}

/** How many levels of subdirectory listings a single `file:readTree` may return. */
const MAX_READ_TREE_DEPTH = 4;

/** Normalise a requested prefetch depth to an integer within [0, MAX_READ_TREE_DEPTH]. */
function clampPrefetchDepth(depth: unknown): number {
  const n = typeof depth === "number" && Number.isFinite(depth) ? Math.round(depth) : 0;
  return Math.max(0, Math.min(MAX_READ_TREE_DEPTH, n));
}

export function registerFileHandlers(
  fileSystem: ElectronFileSystem,
  resolve: (event: { sender: Electron.WebContents }) => OperationDispatcher | null,
): void {
  ipcMain.handle("file:readdir", async (_event, dirPath: string) => {
    return fileSystem.readdir(dirPath);
  });

  // Read a directory down to `depth` levels of subdirectory listings so the
  // renderer can open the next levels without a round trip. Depth is clamped
  // to a sane ceiling to bound the IPC payload for large trees.
  ipcMain.handle("file:readTree", async (_event, dirPath: string, depth?: number) => {
    const d = clampPrefetchDepth(depth);
    return fileSystem.readTree(dirPath, d);
  });

  ipcMain.handle("file:stat", async (_event, filePath: string) => {
    return fileSystem.stat(filePath);
  });

  ipcMain.handle(
    "file:readRange",
    async (_event, filePath: string, offset: number, length: number) => {
      return fileSystem.readRange(filePath, offset, length);
    },
  );

  ipcMain.handle("file:startChunkedRead", async (event, filePath: string) => {
    const CHUNK_SIZE = 16 * 1024;
    return fileSystem.readChunked(filePath, CHUNK_SIZE, (progress) => {
      event.sender.send("file:chunkProgress", progress);
    });
  });

  ipcMain.handle("file:writeFile", async (_event, filePath: string, content: string) => {
    return fileSystem.writeFile(filePath, content);
  });

  ipcMain.handle("file:mkdir", async (_event, dirPath: string) => {
    try {
      await fileSystem.mkdir(dirPath);
      return { success: true, path: dirPath };
    } catch (err) {
      log.warn("file:mkdir failed:", dirPath, err);
      return { success: false, path: dirPath };
    }
  });

  // ── File scope/search ────────────────────────────────────────────────────

  ipcMain.handle("file:getScope", (event) => {
    return resolve(event)?.getWorkspace().scopedFolders ?? [];
  });

  ipcMain.handle("file:addScope", (event, dirPath: string) => {
    const d = resolve(event);
    if (!d) return false;
    const resolved = path.resolve(dirPath);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) return false;
    } catch (err) {
      log.warn("file:addScope cannot stat path; refusing scope:", resolved, err);
      return false;
    }
    const ws = d.getWorkspace();
    if (ws.scopedFolders.includes(resolved)) return true;
    d.setWorkspace({
      ...ws,
      scopedFolders: [...ws.scopedFolders, resolved],
    });
    d.broadcast();
    return true;
  });

  ipcMain.handle("file:removeScope", (event, dirPath: string) => {
    const d = resolve(event);
    if (!d) return false;
    const resolved = path.resolve(dirPath);
    const ws = d.getWorkspace();
    d.setWorkspace({
      ...ws,
      scopedFolders: ws.scopedFolders.filter((f) => f !== resolved),
    });
    d.broadcast();
    return true;
  });

  /**
   * Search for files matching a query within the given root paths.
   */
  ipcMain.handle("file:search", async (_event, query: string, rootPaths: string[]) => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    const results: { path: string; name: string; dir: string }[] = [];
    const maxResults = 50;

    function walk(dir: string, depth: number) {
      if (depth > 5 || results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        log.debug("file find cannot read dir; skipping:", dir, err);
        return;
      }
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith(".") && depth < 2) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.name.toLowerCase().includes(q)) {
          results.push({ path: fullPath, name: entry.name, dir });
        }
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      }
    }

    for (const root of rootPaths) {
      try {
        walk(path.resolve(root), 0);
      } catch (err) {
        log.warn("file find invalid root; skipping:", root, err);
      }
      if (results.length >= maxResults) break;
    }

    return results;
  });

  /**
   * Streaming CONTENT search INDEX: reads each text file under `rootPaths`
   * (skipping binary/large files) and sends only `{ path, name, dir, count }`
   * per matching file, batched into `file:searchContentsChunk` messages, then a
   * final `done` chunk. Match lines are fetched per file, on demand, via
   * `file:contentMatchesForFile`.
   *
   * Returns `{ total, cancelled }` when finished so callers know the final
   * count and whether the walk stopped early because it was superseded.
   *
   * `searchId` (optional) lets the renderer cancel a superseded search by
   * sending `file:cancelContentSearch(searchId)`; the walk then stops early.
   */
  ipcMain.handle(
    "file:searchContentsStream",
    async (
      event,
      query: string,
      rootPaths: string[],
      options?: ContentMatchOptions,
      searchId?: string,
    ) => {
      const sender = event.sender;
      if (!query || typeof query !== "string" || query.length === 0) {
        if (!sender.isDestroyed()) {
          sender.send("file:searchContentsChunk", { type: "done", searchId, total: 0 });
        }
        return { total: 0 };
      }
      let total = 0;
      const isCancelled = searchId ? () => cancelledSearches.has(searchId) : undefined;
      // Every chunk carries its `searchId`: the channel is shared by all
      // in-flight searches, so without it a superseded walk's chunks would be
      // delivered to the listener of the search that replaced it.
      let batch: ContentMatchIndexEntry[] = [];
      const flush = () => {
        if (batch.length === 0) return;
        const entries = batch;
        batch = [];
        if (sender.isDestroyed() || isCancelled?.()) return;
        sender.send("file:searchContentsChunk", { type: "chunk", searchId, entries });
      };
      const onFile = (entry: ContentMatchIndexEntry) => {
        if (sender.isDestroyed() || isCancelled?.()) return;
        total += 1;
        batch.push(entry);
        if (batch.length >= CHUNK_BATCH_SIZE) flush();
      };
      await walkContentSearch(rootPaths, indexCollector(query, options), onFile, isCancelled);
      flush();
      const cancelled = isCancelled?.() ?? false;
      if (searchId) cancelledSearches.delete(searchId);
      if (!sender.isDestroyed()) {
        sender.send("file:searchContentsChunk", { type: "done", searchId, total });
      }
      return { total, cancelled };
    },
  );

  /**
   * Match lines for ONE file — the lazy half of the streaming search.
   *
   * The Explorer asks for these only when a matched file's row is expanded and
   * on screen, so the broad walk never pays to describe hits nobody looks at.
   * Re-running the match on a single file costs a read plus a scan, and it also
   * means the lines always reflect the query being asked about right now.
   */
  ipcMain.handle(
    "file:contentMatchesForFile",
    async (_event, filePath: string, query: string, options?: ContentMatchOptions) => {
      if (!filePath || !query || typeof query !== "string") return { matches: [] };
      const content = readTextFile(path.resolve(filePath));
      if (content === null) return { matches: [] };
      const matches = matchesForContent(content, query, options);
      return { matches, truncated: matches.length >= MAX_MATCHES_PER_FILE };
    },
  );

  // A superseded search asks the main process to stop its walk early.
  ipcMain.on("file:cancelContentSearch", (_event, searchId: string) => {
    if (!searchId) return;
    cancelledSearches.set(searchId, Date.now());
    // Prune stale cancels so rapid typing can't grow the map unboundedly.
    const now = Date.now();
    for (const [id, at] of cancelledSearches) {
      if (now - at > CANCEL_STALE_MS) cancelledSearches.delete(id);
    }
  });

  /**
   * Search for recent/preferred files within the given root paths.
   */
  ipcMain.handle("file:listRecent", async (_event, rootPaths: string[]) => {
    const preferred = [
      "readme",
      "readme.md",
      "readme.txt",
      "makefile",
      "makefile.mk",
      "package.json",
      "index.html",
      "index.js",
      "index.ts",
      ".gitignore",
      "dockerfile",
      "docker-compose.yml",
      "tsconfig.json",
      "vite.config.ts",
      "vite.config.js",
      ".env",
      ".env.example",
      "package-lock.json",
    ];

    interface RecentEntry {
      path: string;
      name: string;
      dir: string;
      mtime: number;
    }
    const results: RecentEntry[] = [];
    const maxResults = 50;

    function walk(dir: string, depth: number) {
      if (depth > 4 || results.length >= maxResults * 2) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        log.debug("folder-picker cannot read dir; skipping:", dir, err);
        return;
      }
      for (const entry of entries) {
        if (results.length >= maxResults * 2) return;
        if (entry.name.startsWith(".") && depth < 2) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          try {
            const stat = fs.statSync(fullPath);
            results.push({ path: fullPath, name: entry.name, dir, mtime: stat.mtimeMs });
          } catch (err) {
            log.debug("folder-picker unreadable file; skipping:", fullPath, err);
          }
        }
      }
    }

    for (const root of rootPaths) {
      try {
        walk(path.resolve(root), 0);
      } catch (err) {
        log.warn("folder-picker invalid root; skipping:", root, err);
      }
      if (results.length >= maxResults * 2) break;
    }

    results.sort((a, b) => {
      const aPref = preferred.includes(a.name.toLowerCase());
      const bPref = preferred.includes(b.name.toLowerCase());
      if (aPref && !bPref) return -1;
      if (!aPref && bPref) return 1;
      if (a.mtime !== b.mtime) return b.mtime - a.mtime;
      return a.name.localeCompare(b.name);
    });

    return results.slice(0, maxResults).map(({ mtime: _mtime, ...rest }) => rest);
  });

  ipcMain.handle("file:pickFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("file:gitBranch", async (_event, dirPath: string) => {
    return currentBranchOf(dirPath);
  });
}
