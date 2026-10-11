/**
 * pending-migrations.ts — which instruction sets still have to run, and the
 * journal that remembers the ones that have.
 *
 * The journal (`<data>/migrations/journal.json`) records each applied set
 * (id, time, what it did) and the last failure; the data version
 * (`<data>/data-version`) records the app version the data was last brought
 * up to. Pending sets run in id order
 * (ids are date-prefixed); a failure stops the run — later sets may depend on
 * it — and the failed set runs again next time. A set that does not pass
 * `parseInstructionSet` counts as a failure.
 */

import fs from "fs";
import path from "path";
import { parseInstructionSet } from "./instruction-set.js";
import { runInstructionSet } from "./migration-runner.js";
import { writeAtomic } from "./operations.js";
import { compareVersions } from "./versions.js";

/** A set as found (downloaded, or read from a folder), not yet checked. */
export interface SourcedSet {
  readonly id: string;
  /** The parsed JSON, or undefined when it could not be read. */
  readonly raw: unknown;
  /** Why it could not be read. */
  readonly error?: string;
}

export interface MigrationJournal {
  readonly applied: ReadonlyArray<{
    readonly id: string;
    /** The set's description (entries from before it was recorded have none). */
    readonly description?: string;
    readonly at: string;
    readonly done: readonly string[];
  }>;
  /** The last run's failure, until that set runs. */
  readonly failed?: { readonly id: string; readonly at: string; readonly error: string };
}

const journalFile = (root: string) => path.join(root, "migrations", "journal.json");

/** The journal of the data folder `root` (empty when there is none). */
export function readJournal(root: string): MigrationJournal {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalFile(root), "utf-8")) as MigrationJournal;
    return { ...parsed, applied: Array.isArray(parsed.applied) ? parsed.applied : [] };
  } catch {
    return { applied: [] };
  }
}

function writeJournal(root: string, journal: MigrationJournal): void {
  fs.mkdirSync(path.dirname(journalFile(root)), { recursive: true });
  writeAtomic(journalFile(root), JSON.stringify(journal, null, 2));
}

/**
 * The data version: the app version the data folder was last brought up to,
 * in a file of its own at the top of the data folder (`data-version`). It
 * lives with the data, not the app, so a reinstalled app — or a much newer
 * one — knows which releases' migrations the data still needs.
 */
const dataVersionFile = (root: string) => path.join(root, "data-version");

/** The data version, or undefined when none was recorded. */
export function readDataVersion(root: string): string | undefined {
  try {
    return fs.readFileSync(dataVersionFile(root), "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Record that the data has been brought up to `version`. */
export function writeDataVersion(root: string, version: string): void {
  fs.mkdirSync(root, { recursive: true });
  writeAtomic(dataVersionFile(root), `${version}\n`);
}

/**
 * The versions whose migrations this install still needs, running `version`:
 * after the one the data was brought up to, through `version`. Null when
 * there are none. A fresh install (no workspaces yet) starts at `version`;
 * data from before the journal starts at the beginning (sets are written to
 * be safe to run again).
 */
export function migrationRange(root: string, version: string): { from: string; to: string } | null {
  let from = readDataVersion(root);
  if (!from) {
    let fresh = true;
    try {
      fresh = fs.readdirSync(path.join(root, "workspaces")).length === 0;
    } catch {
      // no workspaces folder: nothing to migrate
    }
    if (fresh) {
      writeDataVersion(root, version);
      return null;
    }
    from = "0.0.0";
  }
  return compareVersions(version, from) > 0 ? { from, to: version } : null;
}

/** The sets in a folder (`*.json`), e.g. the repo's `migrations/` in dev. */
export function readSetsFromFolder(dir: string): SourcedSet[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names.map((name) => {
    const stem = name.replace(/\.json$/, "");
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      const id = (raw as { id?: unknown })?.id;
      return { id: typeof id === "string" && id ? id : stem, raw };
    } catch (err) {
      return { id: stem, raw: undefined, error: `${name}: ${String(err)}` };
    }
  });
}

/** The sets the journal has not recorded as applied, in id order. */
export function pendingMigrations(root: string, sets: readonly SourcedSet[]): SourcedSet[] {
  const done = new Set(readJournal(root).applied.map((a) => a.id));
  return [...sets].filter((s) => !done.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Check and run one set, recording it in the journal as applied (clearing a
 * recorded failure) or as the failure. Never throws.
 */
export function applyMigration(root: string, sourced: SourcedSet): { ok: boolean; error?: string } {
  const journal = readJournal(root);
  const at = new Date().toISOString();
  let error = sourced.error;
  if (!error) {
    try {
      const set = parseInstructionSet(sourced.raw);
      const run = runInstructionSet(set, { root });
      if (run.ok) {
        const { failed: _cleared, ...rest } = journal;
        writeJournal(root, {
          ...rest,
          applied: [
            ...journal.applied,
            { id: sourced.id, description: set.description, at, done: run.done },
          ],
        });
        return { ok: true };
      }
      error = run.error;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const failed = { id: sourced.id, at, error: error ?? "failed" };
  writeJournal(root, { ...journal, failed });
  return { ok: false, error: failed.error };
}

/**
 * Run the sets the journal has not recorded, in id order, recording each; a
 * failure stops the run. Never throws.
 */
export function runPendingMigrations(options: {
  readonly root: string;
  readonly sets: readonly SourcedSet[];
}): { applied: string[]; failed?: { id: string; error: string } } {
  const applied: string[] = [];
  for (const set of pendingMigrations(options.root, options.sets)) {
    const result = applyMigration(options.root, set);
    if (!result.ok) return { applied, failed: { id: set.id, error: result.error ?? "failed" } };
    applied.push(set.id);
  }
  return { applied };
}
