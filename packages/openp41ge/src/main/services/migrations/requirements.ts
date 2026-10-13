/**
 * requirements.ts — what downloading the data updates needs, checked while
 * the migration window is offline (its checklist):
 *   - an internet connection;
 *   - GitHub: its API (the release list), github.com and the servers release
 *     files download from all answer, and the API is not refusing this
 *     network for too many requests (about 60 an hour without signing in).
 *     Reading the API's limit does not count against it.
 *
 * The network is behind `RequirementsProbe` (Electron's `net` in the app).
 */

const RATE_LIMIT_URL = "https://api.github.com/rate_limit";
/** Where `browser_download_url`s point, and where they redirect to. */
const DOWNLOAD_HOSTS = ["https://github.com/", "https://release-assets.githubusercontent.com/"];

export interface Requirements {
  readonly internet: boolean;
  readonly github: "ok" | "unreachable" | "rate-limited";
  /** When GitHub takes requests again (epoch ms), if it said. */
  readonly githubResetAt?: number;
}

export interface RequirementsProbe {
  /** The computer has a network connection. */
  isOnline(): boolean;
  /** GET a URL; rejects when it cannot be reached. */
  get(url: string): Promise<{ status: number; text: string }>;
  /** Resolves when a URL answers at all (any status); rejects otherwise. */
  reach(url: string): Promise<void>;
}

export function requirementsMet(r: Requirements): boolean {
  return r.internet && r.github === "ok";
}

export async function checkRequirements(probe: RequirementsProbe): Promise<Requirements> {
  if (!probe.isOnline()) return { internet: false, github: "unreachable" };
  try {
    const [api] = await Promise.all([
      probe.get(RATE_LIMIT_URL),
      ...DOWNLOAD_HOSTS.map((url) => probe.reach(url)),
    ]);
    if (api.status === 403 || api.status === 429) {
      return { internet: true, github: "rate-limited" };
    }
    if (api.status !== 200) return { internet: true, github: "unreachable" };
    const core = rateLimit(api.text);
    if (core && core.remaining <= 0) {
      return { internet: true, github: "rate-limited", githubResetAt: core.reset * 1000 };
    }
    return { internet: true, github: "ok" };
  } catch {
    return { internet: true, github: "unreachable" };
  }
}

function rateLimit(text: string): { remaining: number; reset: number } | null {
  try {
    const core = (JSON.parse(text) as { resources?: { core?: unknown } }).resources?.core as
      { remaining?: unknown; reset?: unknown } | undefined;
    return typeof core?.remaining === "number" && typeof core.reset === "number"
      ? { remaining: core.remaining, reset: core.reset }
      : null;
  } catch {
    return null;
  }
}
