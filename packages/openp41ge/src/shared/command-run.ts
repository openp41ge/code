/**
 * command-run.ts — a run of the scoped terminal, as the main process records
 * it (`CommandService`) and the terminal tab shows it.
 */

/** A recorded run. */
export interface CommandRun {
  readonly runId: string;
  readonly binary: string;
  readonly args: readonly string[];
  readonly repo: string;
  readonly worktree: string;
  /** Who ran it: an extension's id, or `"you"` (the terminal's prompt). */
  readonly by: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly state: "running" | "done";
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
  readonly error?: string;
}
