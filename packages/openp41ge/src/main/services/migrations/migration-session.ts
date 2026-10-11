/**
 * migration-session.ts — the pending instruction sets being run while the
 * migration window shows: one row per set (pending → running → done /
 * failed). A failure stops the run; `run()` again (Retry) continues from it.
 * Each change is reported to `onState` (the window).
 */

import type { SourcedSet } from "./pending-migrations.js";

export type MigrationRowState = "pending" | "running" | "done" | "failed";

export interface MigrationRow {
  readonly id: string;
  readonly description: string;
  readonly state: MigrationRowState;
  readonly error?: string;
}

export interface MigrationSessionState {
  readonly phase: "running" | "done" | "failed";
  readonly rows: readonly MigrationRow[];
}

/** Let the window repaint between sets (a set runs synchronously). */
const yieldToEvents = () => new Promise<void>((resolve) => setImmediate(resolve));

export class MigrationSession {
  private _rows: MigrationRow[];
  private _phase: MigrationSessionState["phase"] = "running";

  constructor(
    private readonly _sets: readonly SourcedSet[],
    private readonly _apply: (set: SourcedSet) => { ok: boolean; error?: string },
    private readonly _onState: (state: MigrationSessionState) => void,
  ) {
    this._rows = _sets.map((s) => {
      const description = (s.raw as { description?: unknown } | undefined)?.description;
      return {
        id: s.id,
        description: typeof description === "string" ? description : s.id,
        state: "pending",
      };
    });
  }

  state(): MigrationSessionState {
    return { phase: this._phase, rows: this._rows };
  }

  /** Run the sets not yet done; resolves whether all are done. */
  async run(): Promise<boolean> {
    this._phase = "running";
    for (let i = 0; i < this._sets.length; i++) {
      if (this._rows[i].state === "done") continue;
      this._set(i, { state: "running", error: undefined });
      await yieldToEvents();
      const result = this._apply(this._sets[i]);
      if (!result.ok) {
        this._phase = "failed";
        this._set(i, { state: "failed", error: result.error ?? "failed" });
        return false;
      }
      if (i === this._sets.length - 1) this._phase = "done";
      this._set(i, { state: "done", error: undefined });
    }
    if (this._phase !== "done") {
      this._phase = "done";
      this._onState(this.state());
    }
    return true;
  }

  private _set(i: number, change: Partial<MigrationRow>): void {
    const { error: _old, ...row } = this._rows[i];
    const next = { ...row, ...change };
    if (next.error === undefined) delete (next as { error?: string }).error;
    this._rows = this._rows.map((r, k) => (k === i ? next : r));
    this._onState(this.state());
  }
}
