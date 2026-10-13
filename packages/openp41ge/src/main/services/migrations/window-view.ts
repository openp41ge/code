/**
 * window-view.ts — what the user is shown about the data updates: the
 * migration window's phase and how many are done of how many, and the
 * manager window's Migrations tab summary. The updates' descriptions, what
 * they did and their errors are not shown; they stay in the journal and the
 * logs.
 */

import type { MigrationRow } from "./migration-session.js";
import type { MigrationJournal } from "./pending-migrations.js";

/** The window's state in the main process (see migration-window.ts). */
export interface WindowStateLike {
  readonly phase: MigrationWindowView["phase"];
  readonly rows: readonly MigrationRow[];
  readonly dataVersion?: string;
}

/** What the window shows (mirrored by the renderer's `MigrationsViewState`). */
export interface MigrationWindowView {
  /**
   * `checking`: downloading the updates; `offline`: they could not be;
   * `newer`: the data was last used by a newer version (never opened);
   * `error`: the check itself failed.
   */
  readonly phase: "checking" | "offline" | "newer" | "error" | "running" | "done" | "failed";
  readonly completed: number;
  readonly total: number;
  /** The version that last used the data (`newer`). */
  readonly dataVersion?: string;
}

export function toWindowView(state: WindowStateLike): MigrationWindowView {
  return {
    phase: state.phase,
    completed: state.rows.filter((r) => r.state === "done").length,
    total: state.rows.length,
    ...(state.dataVersion !== undefined ? { dataVersion: state.dataVersion } : {}),
  };
}

/** The Migrations tab's summary (mirrored in the renderer's global.d.ts). */
export interface MigrationsSummary {
  readonly appVersion: string;
  readonly dataVersion?: string;
  /** How many data updates have run on this data folder. */
  readonly updates: number;
  /** When the last one ran (ISO). */
  readonly lastUpdateAt?: string;
  /** The last run stopped on an update that has not run since. */
  readonly failed: boolean;
}

export function migrationsSummary(
  journal: MigrationJournal,
  appVersion: string,
  dataVersion: string | undefined,
): MigrationsSummary {
  const last = journal.applied.at(-1);
  return {
    appVersion,
    ...(dataVersion ? { dataVersion } : {}),
    updates: journal.applied.length,
    ...(last ? { lastUpdateAt: last.at } : {}),
    failed: journal.failed !== undefined,
  };
}
