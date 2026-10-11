/**
 * repository-work.ts — a repository's work that exists nowhere else, as text:
 * one line per branch (never individual files), for the confirmations of
 * repository Delete and the Cleanup tab.
 */

import type { BranchState } from "openp41ge-sdk";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One line per branch with work, e.g. "master: 2 changed, 1 untracked" or
 * "old (no worktree): 1 commit not pushed". Branches without work are left out.
 */
export function branchWorkLines(branches: readonly BranchState[]): string[] {
  return branches.flatMap((b) => {
    const work = [
      b.unstaged ? `${b.unstaged} changed` : "",
      b.staged ? `${b.staged} staged` : "",
      b.untracked ? `${b.untracked} untracked` : "",
      b.unpushed ? `${plural(b.unpushed, "commit", "commits")} not pushed` : "",
    ].filter(Boolean);
    if (work.length === 0) return [];
    return [`${b.branch}${b.worktree ? "" : " (no worktree)"}: ${work.join(", ")}`];
  });
}
