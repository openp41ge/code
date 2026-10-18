/**
 * A terminal tab's target — its binary and worktree — and the tab's key and
 * title from it.
 */

/** What a terminal tab is for. */
export interface TerminalTarget {
  readonly binary: string;
  readonly repo: string;
  readonly worktree: string;
}

/** The tab's identity: one per binary and worktree. */
export function terminalTabKey(t: TerminalTarget): string {
  return `terminal:${t.binary}:${t.repo}@${t.worktree}`;
}

/** The tab's title: the binary and the worktree's branch. */
export function terminalTabTitle(t: TerminalTarget): string {
  return `${t.binary} · ${t.worktree}`;
}
