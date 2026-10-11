/**
 * cleanup-scheduler.ts — when the repository cleanup runs: once shortly
 * after startup, and again once workspace files have stopped changing for a
 * while (a save or delete, which can come in bursts).
 */

export interface CleanupSchedule {
  /** Delay before the startup run. */
  readonly startupDelayMs: number;
  /** Quiet time after the last workspace change before running. */
  readonly settleMs: number;
}

export class CleanupScheduler {
  private _startup: ReturnType<typeof setTimeout> | null = null;
  private _settle: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;

  constructor(
    private readonly _run: () => void,
    private readonly _schedule: CleanupSchedule,
  ) {}

  /** Schedule the startup run. */
  start(): void {
    if (this._stopped || this._startup) return;
    this._startup = setTimeout(() => {
      this._startup = null;
      this._run();
    }, this._schedule.startupDelayMs);
  }

  /** A workspace file was saved or deleted. */
  workspacesChanged(): void {
    if (this._stopped) return;
    if (this._settle) clearTimeout(this._settle);
    this._settle = setTimeout(() => {
      this._settle = null;
      this._run();
    }, this._schedule.settleMs);
  }

  stop(): void {
    this._stopped = true;
    if (this._startup) clearTimeout(this._startup);
    if (this._settle) clearTimeout(this._settle);
    this._startup = this._settle = null;
  }
}
