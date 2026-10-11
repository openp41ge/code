/**
 * repository-states.ts — this window's copy of each workspace repository's
 * state (uncommitted files, unpushed commits), behind
 * `context.repositoryStates`.
 *
 * A repo is queried once when it is first tracked, and again whenever the
 * platform reports a change in it (its files or its git refs). One query runs
 * at a time per repo; a change during it queues exactly one more. Each result
 * calls `changed`, which re-resolves the mounted surfaces' context.
 */

import type { RepositoryState } from "openp41ge-sdk";

export class RepositoryStates {
  private readonly _states = new Map<string, RepositoryState>();
  private readonly _tracked = new Set<string>();
  private readonly _running = new Set<string>();
  private readonly _again = new Set<string>();

  constructor(
    private readonly _query: (repoName: string) => Promise<RepositoryState>,
    private readonly _changed: () => void,
  ) {}

  /** Every tracked repo's last known state (repoName → state). */
  snapshot(): Record<string, RepositoryState> {
    return Object.fromEntries(this._states);
  }

  /** Track exactly `repoNames`: query new ones, forget the rest. */
  track(repoNames: readonly string[]): void {
    const wanted = new Set(repoNames);
    for (const name of [...this._tracked]) {
      if (wanted.has(name)) continue;
      this._tracked.delete(name);
      this._states.delete(name);
    }
    for (const name of wanted) {
      if (this._tracked.has(name)) continue;
      this._tracked.add(name);
      this._run(name);
    }
  }

  /** Query a tracked repo again (something in it changed). */
  refresh(repoName: string): void {
    if (this._tracked.has(repoName)) this._run(repoName);
  }

  private _run(repoName: string): void {
    if (this._running.has(repoName)) {
      this._again.add(repoName);
      return;
    }
    this._running.add(repoName);
    void this._query(repoName)
      .then(
        (state) => {
          if (!this._tracked.has(repoName)) return;
          this._states.set(repoName, state);
          this._changed();
        },
        () => undefined, // the query reports failures in `error`; a reject is a lost window
      )
      .finally(() => {
        this._running.delete(repoName);
        if (this._again.delete(repoName)) this._run(repoName);
      });
  }
}
