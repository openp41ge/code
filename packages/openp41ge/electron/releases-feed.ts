/**
 * ReleasesFeed — which releases of the app exist, checked in the background.
 *
 * The manager window's Releases tab shows this list. It fetches only the
 * GitHub release list (metadata), never a file: downloading an update stays
 * the updater's job, on the user's request.
 *
 *   - At start the cached list (on disk) shows at once; it is checked when
 *     missing or older than RELEASES_CHECK_INTERVAL_MS.
 *   - Then it is checked every RELEASES_CHECK_INTERVAL_MS, and on `refresh()`.
 *   - A failed check keeps the last list and reports the error.
 *
 * `api.github.com` is public for a public repo: no credentials are sent.
 */

import fs from "fs";
import path from "path";

/** A published release, as the GitHub API lists it (the fields used). */
export interface ReleaseRecord {
  tag_name: string;
  name: string;
  prerelease: boolean;
  published_at: string | null;
  body: string | null;
  html_url: string | null;
}

/** The list and how current it is. */
export interface ReleasesSnapshot {
  readonly releases: readonly ReleaseRecord[];
  /** When the list was last fetched (ms), null: never. */
  readonly fetchedAt: number | null;
  /** A check is running. */
  readonly checking: boolean;
  /** Why the last check failed (null: it did not). */
  readonly error: string | null;
}

interface ReleasesCache {
  releases: ReleaseRecord[];
  fetchedAt: number;
}

export interface ReleasesFeedDeps {
  fetchList(): Promise<ReleaseRecord[]>;
  readCache(): ReleasesCache | null;
  writeCache(cache: ReleasesCache): void;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** How often the list is checked. */
export const RELEASES_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const RELEASES_API = "https://api.github.com/repos/openp41ge/code/releases?per_page=100";

export class ReleasesFeed {
  private _snapshot: ReleasesSnapshot = {
    releases: [],
    fetchedAt: null,
    checking: false,
    error: null,
  };
  private _check: Promise<ReleasesSnapshot> | null = null;
  private _timer: unknown = null;
  private readonly _listeners = new Set<(snapshot: ReleasesSnapshot) => void>();

  constructor(private readonly _deps: ReleasesFeedDeps) {}

  start(): void {
    let cache: ReleasesCache | null = null;
    try {
      cache = this._deps.readCache();
    } catch {
      cache = null;
    }
    if (cache) this._snapshot = { ...this._snapshot, ...cache };
    this._timer = this._deps.setInterval(() => void this.refresh(), RELEASES_CHECK_INTERVAL_MS);
    const age = cache ? this._deps.now() - cache.fetchedAt : Infinity;
    if (age > RELEASES_CHECK_INTERVAL_MS) void this.refresh();
  }

  stop(): void {
    if (this._timer !== null) this._deps.clearInterval(this._timer);
    this._timer = null;
  }

  snapshot(): ReleasesSnapshot {
    return this._snapshot;
  }

  onChange(cb: (snapshot: ReleasesSnapshot) => void): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  /** Check now (joins a check that is already running). */
  refresh(): Promise<ReleasesSnapshot> {
    this._check ??= this._run().finally(() => {
      this._check = null;
    });
    return this._check;
  }

  private async _run(): Promise<ReleasesSnapshot> {
    this._set({ checking: true });
    try {
      const releases = await this._deps.fetchList();
      const fetchedAt = this._deps.now();
      this._set({ releases, fetchedAt, checking: false, error: null });
      try {
        this._deps.writeCache({ releases, fetchedAt });
      } catch {
        // The cache is a convenience; the list is still current in memory.
      }
    } catch (err) {
      this._set({ checking: false, error: err instanceof Error ? err.message : String(err) });
    }
    return this._snapshot;
  }

  private _set(change: Partial<ReleasesSnapshot>): void {
    this._snapshot = { ...this._snapshot, ...change };
    for (const cb of this._listeners) {
      try {
        cb(this._snapshot);
      } catch {
        // a listener's failure is its own
      }
    }
  }
}

/** The real dependencies: GitHub's API, and a cache file in `dataDir`. */
export function releasesFeedDeps(dataDir: string): ReleasesFeedDeps {
  const file = path.join(dataDir, "releases.json");
  return {
    fetchList: async () => {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub releases request failed (${res.status})`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as ReleaseRecord[]).map(record) : [];
    },
    readCache: () => {
      if (!fs.existsSync(file)) return null;
      const cache = JSON.parse(fs.readFileSync(file, "utf-8")) as ReleasesCache;
      return Array.isArray(cache.releases) && typeof cache.fetchedAt === "number" ? cache : null;
    },
    writeCache: (cache) => {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, file);
    },
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

/** Keep only the fields the app uses (the API sends much more). */
function record(r: ReleaseRecord): ReleaseRecord {
  return {
    tag_name: r.tag_name,
    name: r.name,
    prerelease: r.prerelease,
    published_at: r.published_at,
    body: r.body,
    html_url: r.html_url,
  };
}
