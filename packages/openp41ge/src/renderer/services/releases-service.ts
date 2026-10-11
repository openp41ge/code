/**
 * Renderer-side GitHub releases service for the management window's Releases
 * tab.
 *
 * Fetches the app's published releases from the GitHub REST API and exposes a
 * pure filter that hides prerelease builds unless the user's configured update
 * channel opts in ("alpha"/"beta"/"rc").
 *
 * `api.github.com` is a public endpoint for a public repo: no credentials are
 * sent and the response is CORS-enabled, so a plain renderer `fetch` works.
 * Release `body` text is untrusted — callers must render it as text (never
 * via `unsafeHTML`).
 */

export interface GithubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  published_at: string | null;
  body: string | null;
  html_url: string | null;
}

/** The repository whose releases the manager shows. */
export const RELEASES_REPO = "openp41ge/code";

export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=100`;

/** Fetch published releases for the app repo, newest first (GitHub orders the
 *  list by creation date). Throws on network/HTTP failure — callers catch to
 *  surface an error state rather than crashing. */
export async function fetchReleases(
  url: string = RELEASES_API,
  signal?: AbortSignal,
): Promise<GithubRelease[]> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GitHub releases request failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as GithubRelease[]) : [];
}

/** The channels a release can belong to, least → most stable. */
export type ReleaseChannel = "alpha" | "beta" | "rc" | "stable";

export const CHANNEL_ORDER: readonly ReleaseChannel[] = ["alpha", "beta", "rc", "stable"];

/** Derive the channel encoded in a release tag, e.g. "alpha" from
 *  "v0.1.0-alpha.4", or "stable" when no prerelease segment is present. */
export function channelFromTag(tag: string): ReleaseChannel {
  const pre = /-(alpha|beta|rc)\./i.exec(tag);
  return pre ? (pre[1].toLowerCase() as ReleaseChannel) : "stable";
}

/**
 * The visibility window for a configured `updateChannel`: the configured
 * channel plus every MORE-stable channel. Config value "latest" maps to the
 * stable-only window (least stable → most stable).
 *
 *   updateChannel → shown channels
 *   "latest"      → [stable]
 *   "rc"          → [rc, stable]
 *   "beta"        → [beta, rc, stable]
 *   "alpha"       → [alpha, beta, rc, stable]
 */
export function channelsForUpdateChannel(updateChannel: string): ReleaseChannel[] {
  const base = updateChannel === "latest" ? "stable" : updateChannel;
  const idx = (CHANNEL_ORDER as readonly string[]).indexOf(base);
  if (idx < 0) return ["stable"];
  return CHANNEL_ORDER.slice(idx);
}

/** Parse a release tag ("v1.2.3", "v1.2.3-alpha.4") into comparable parts. */
function parseTag(tag: string): {
  major: number;
  minor: number;
  patch: number;
  pre: ReleaseChannel | null;
  preNum: number;
} | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/i.exec(tag.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? (m[4].toLowerCase() as ReleaseChannel) : null,
    preNum: m[5] ? Number(m[5]) : 0,
  };
}

const PRE_RANK: Record<ReleaseChannel, number> = { alpha: 0, beta: 1, rc: 2, stable: 3 };

/** Numerically compare two release tags (same channel semantics). >0 means a is newer. */
export function compareTags(a: string, b: string): number {
  const pa = parseTag(a);
  const pb = parseTag(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.pre !== pb.pre) {
    // A stable release (no prerelease segment) outranks any same-core prerelease.
    const ra = pa.pre ? PRE_RANK[pa.pre] : Number.MAX_SAFE_INTEGER;
    const rb = pb.pre ? PRE_RANK[pb.pre] : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  }
  return pa.preNum - pb.preNum;
}

/**
 * Take the LATEST release of each channel in the visibility window, dropping
 * every historical release older than the per-channel latest. Returns newest
 * published first. This is the top-level catalog: one row per channel.
 */
export function selectLatestPerChannel(
  updateChannel: string,
  releases: GithubRelease[],
): GithubRelease[] {
  const included = new Set<ReleaseChannel>(channelsForUpdateChannel(updateChannel));
  const byChannel = new Map<ReleaseChannel, GithubRelease>();
  for (const r of releases) {
    const c = channelFromTag(r.tag_name);
    if (!included.has(c)) continue;
    const cur = byChannel.get(c);
    if (!cur || compareTags(r.tag_name, cur.tag_name) > 0) byChannel.set(c, r);
  }
  return [...byChannel.values()].sort((a, b) => {
    const d = (b.published_at ?? "").localeCompare(a.published_at ?? "");
    if (d !== 0) return d;
    return compareTags(b.tag_name, a.tag_name);
  });
}

/**
 * Fetch a single page of releases (for lazy history loading in the drawer).
 * GitHub's list endpoint returns up to `per_page` releases newest-first. An
 * empty array is returned when the page is beyond the available data.
 */
export async function fetchReleasesPage(
  page: number,
  url: string = RELEASES_API,
  signal?: AbortSignal,
): Promise<GithubRelease[]> {
  const separator = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${separator}page=${page}`, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub releases request failed (${res.status})`);
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as GithubRelease[]) : [];
}

/** Format an ISO timestamp as a short localized date (e.g. "Sep 29, 2026"). */
export function formatReleaseDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
