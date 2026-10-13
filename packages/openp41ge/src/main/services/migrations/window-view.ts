/**
 * window-view.ts — what the migration window is sent: its phase and how many
 * updates are done out of how many. The updates' descriptions and errors are
 * not shown to the user; they stay in the journal and the logs.
 */

import type { MigrationRow } from "./migration-session.js";

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
