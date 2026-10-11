/**
 * release-migrations.ts — downloading the data migrations of every release
 * an install has not migrated through yet.
 *
 * Each GitHub release may carry one `migrations.json` (`{ release, sets }`:
 * every instruction set for that release, merged by the release pipeline)
 * and its signature, `migrations.json.sig`. An install brought up to `from`
 * that now runs `to` needs the files of every published release after `from`
 * through `to` — on every channel, so a stable install that skipped an alpha
 * still gets its migrations. A file whose signature does not check fails the
 * whole download: none of its sets, or any later release's, are used.
 */

import { compareVersions } from "./versions.js";
import { verifySignature } from "./signature.js";
import type { SourcedSet } from "./pending-migrations.js";

/** The app's releases (as the manager window's Releases tab). */
const RELEASES_REPO = "openp41ge/code";
const MIGRATIONS_ASSET = "migrations.json";

/** The parts of a GitHub release this reads. */
export interface GithubReleaseInfo {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly assets?: ReadonlyArray<{ readonly name: string; readonly browser_download_url: string }>;
}

/** The published releases after `from`, through `to`, oldest first. */
export function releasesBetween<R extends GithubReleaseInfo>(
  releases: readonly R[],
  from: string,
  to: string,
): R[] {
  return releases
    .filter(
      (r) =>
        !r.draft && compareVersions(r.tag_name, from) > 0 && compareVersions(r.tag_name, to) <= 0,
    )
    .sort((a, b) => compareVersions(a.tag_name, b.tag_name));
}

export interface FetchReleaseMigrationsOptions {
  /** The version the data was last brought up to. */
  readonly from: string;
  /** The running version. */
  readonly to: string;
  /** The public key (PEM) the files must be signed with. */
  readonly publicKey: string;
  /** GET a URL as text (throws on failure). */
  readonly fetchText: (url: string) => Promise<string>;
  readonly repo?: string;
}

/** The sets of every release in the range, in release then id order. */
export async function fetchReleaseMigrations(
  options: FetchReleaseMigrationsOptions,
): Promise<{ ok: boolean; sets: SourcedSet[]; error?: string }> {
  const repo = options.repo ?? RELEASES_REPO;
  try {
    const releases: GithubReleaseInfo[] = [];
    for (let page = 1; ; page++) {
      const batch = JSON.parse(
        await options.fetchText(
          `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
        ),
      ) as GithubReleaseInfo[];
      releases.push(...batch);
      if (batch.length < 100) break;
    }
    const sets: SourcedSet[] = [];
    for (const rel of releasesBetween(releases, options.from, options.to)) {
      const file = rel.assets?.find((a) => a.name === MIGRATIONS_ASSET);
      const sig = rel.assets?.find((a) => a.name === `${MIGRATIONS_ASSET}.sig`);
      if (!file) continue; // this release changes no data
      if (!sig)
        return { ok: false, sets: [], error: `${rel.tag_name}: ${MIGRATIONS_ASSET} is not signed` };
      const text = await options.fetchText(file.browser_download_url);
      const signature = await options.fetchText(sig.browser_download_url);
      if (!verifySignature(Buffer.from(text, "utf-8"), signature, options.publicKey)) {
        return {
          ok: false,
          sets: [],
          error: `${rel.tag_name}: the signature of ${MIGRATIONS_ASSET} does not match`,
        };
      }
      const bundle = JSON.parse(text) as { sets?: unknown };
      const found = Array.isArray(bundle.sets) ? bundle.sets : [];
      const ids = found.map((raw) => {
        const id = (raw as { id?: unknown })?.id;
        return { id: typeof id === "string" ? id : `${rel.tag_name}#?`, raw };
      });
      sets.push(...ids.sort((a, b) => a.id.localeCompare(b.id)));
    }
    return { ok: true, sets };
  } catch (err) {
    return { ok: false, sets: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** GET a URL as text over the network (GitHub API and release downloads). */
export async function httpText(url: string): Promise<string> {
  const api = url.startsWith("https://api.github.com/");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "openp41ge",
      ...(api ? { Accept: "application/vnd.github+json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}
