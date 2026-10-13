/**
 * startup-migrations.ts — what startup does about data migrations, decided
 * before the app reads any data:
 *   - `none`: nothing to run (fresh install, up to date, or every set in the
 *     range already applied — the new version is then recorded);
 *   - `run`: these sets, in the migration window;
 *   - `offline`: a set this version requires is not applied and the
 *     download failed — the window's offline state (what the download needs,
 *     then Continue / Quit);
 *   - `missing`: the download worked but the releases do not carry a set
 *     this version requires — nothing the user can fix here: the window's
 *     failed state (download the app again / Quit);
 *   - `deferred`: the download failed but every required set is applied —
 *     start now and look again next time;
 *   - `newer`: the data was last used by a newer version, whose layout this
 *     one may not understand — never opened (there are no reverse
 *     migrations);
 *   - `error`: the check itself failed — never opened on data that may need
 *     migrating (Retry / Quit).
 * Dev builds run the repo's `migrations/` folder instead of downloading.
 */

import { compareVersions } from "./versions.js";
import {
  readDataVersion,
  writeDataVersion,
  migrationRange,
  pendingMigrations,
  readJournal,
  type SourcedSet,
} from "./pending-migrations.js";

export type StartupPlan =
  | { readonly kind: "none" }
  | { readonly kind: "run"; readonly sets: readonly SourcedSet[] }
  | { readonly kind: "offline"; readonly error: string }
  | { readonly kind: "missing"; readonly error: string }
  | { readonly kind: "deferred" }
  | { readonly kind: "newer"; readonly dataVersion: string }
  | { readonly kind: "error"; readonly error: string };

export interface StartupMigrationsOptions {
  /** The app data folder. */
  readonly root: string;
  /** The running version. */
  readonly version: string;
  /** A release build (downloads) or a dev build (reads `localSets`). */
  readonly packaged: boolean;
  /** Dev builds: the repo's `migrations/` folder. */
  readonly localSets?: () => readonly SourcedSet[];
  /** Release builds: the verified sets of the releases in a range. */
  readonly download: (
    from: string,
    to: string,
  ) => Promise<{ ok: boolean; sets: readonly SourcedSet[]; error?: string }>;
  /** The set ids this version needs applied (`REQUIRED_MIGRATIONS`). */
  readonly required: readonly string[];
}

/** Never rejects: a failure is the `error` plan. */
export async function planStartupMigrations(
  options: StartupMigrationsOptions,
): Promise<StartupPlan> {
  try {
    return await plan(options);
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

async function plan(options: StartupMigrationsOptions): Promise<StartupPlan> {
  const { root } = options;
  if (!options.packaged) {
    const pending = pendingMigrations(root, options.localSets?.() ?? []);
    return pending.length > 0 ? { kind: "run", sets: pending } : { kind: "none" };
  }
  const dataVersion = readDataVersion(root);
  if (dataVersion && compareVersions(dataVersion, options.version) > 0) {
    return { kind: "newer", dataVersion };
  }
  const range = migrationRange(root, options.version);
  if (!range) return { kind: "none" };
  const fetched = await options.download(range.from, range.to);
  const applied = new Set(readJournal(root).applied.map((a) => a.id));
  if (fetched.ok) {
    // A required set that is neither applied nor downloaded: the releases do
    // not carry it (e.g. its `release` does not match the version released).
    // Never open on the old layout.
    const available = new Set([...applied, ...fetched.sets.map((s) => s.id)]);
    const absent = options.required.filter((id) => !available.has(id));
    if (absent.length > 0) {
      return {
        kind: "missing",
        error: `This version needs data updates its release does not include: ${absent.join(", ")}`,
      };
    }
    const pending = pendingMigrations(root, fetched.sets);
    if (pending.length > 0) return { kind: "run", sets: pending };
    writeDataVersion(root, options.version);
    return { kind: "none" };
  }
  const missing = options.required.filter((id) => !applied.has(id));
  return missing.length > 0
    ? { kind: "offline", error: fetched.error ?? "the update could not be downloaded" }
    : { kind: "deferred" };
}
