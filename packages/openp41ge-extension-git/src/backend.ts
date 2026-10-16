/**
 * backend.ts — the git extension's backend commands (git extension plan,
 * phase 4): the queries of `GitQueries`, run through the platform's
 * `ctx.git`, so git runs in a repository of the calling window's workspace
 * named by `repo` (`<host>/<org>/<repo>`). Every command answers
 * `{ ok: true, result }` or `{ ok: false, error }`; none throws.
 *
 *   commit-log      { repo, branch, maxCount?, skip? }   → CommitEntry[]
 *   branches        { repo }                             → BranchEntry[]
 *   commit          { repo, hash }                       → CommitEntry | null
 *   diff-stat       { repo, commit? , worktree? }        → DiffStatEntry[]
 *                   (no commit: the worktree's uncommitted changes)
 *   untracked-files { repo, worktree }                   → string[]
 *   uncommitted-files { repo, worktree }                 → DiffStatEntry[]
 *                   (changed against HEAD, then untracked; not ignored)
 *   file-hunks      { repo, hash, path, query?, regex?, caseSensitive? } → SearchHunk[]
 *   file-content    { repo, hash, path }                 → string | null
 *   file-diff       { repo, path, hash?, worktree? }     → InlineDiffFile | null
 *                   (no hash: the worktree's file against HEAD)
 *   search-commits-window { repo, start, size, ...CommitSearchOptions }
 *                   → { commits, walked } (one window of the history)
 *   match-context   { repo, hash, query, regex?, caseSensitive?, content? }
 *                   → where it matched (body / changed line) | null
 *   delete-branch   { repo, branch, force? }             → null
 */

import type { HandlerContext, HandlerFn, HandlerPayload } from "openp41ge-sdk";
import { GitQueries, type CommitSearchOptions } from "openp41ge-sdk-git";

type Answer = { ok: true; result: unknown } | { ok: false; error: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Queries whose git runs through `ctx.git`. */
function queriesFor(ctx: HandlerContext): GitQueries {
  return new GitQueries(async (repo, args, worktree, okExitCodes) => {
    const res = await ctx.git({ repo, args, ...(worktree ? { worktree } : {}) });
    if (!res.ok && !(res.exitCode !== null && okExitCodes?.includes(res.exitCode)))
      throw new Error(res.error ?? (res.stderr.trim() || "git failed"));
    return res.stdout.trimEnd();
  });
}

/** A command over the payload's repo: its answer envelope, never a throw. */
function command(
  run: (q: GitQueries, repo: string, payload: HandlerPayload) => Promise<unknown>,
): HandlerFn {
  return async (payload, ctx): Promise<Answer> => {
    const repo = str(payload.repo);
    if (!repo) return { ok: false, error: "a repo (its name) is required" };
    if (!ctx) return { ok: false, error: "no handler context" };
    try {
      return { ok: true, result: (await run(queriesFor(ctx), repo, payload)) ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export const GIT_COMMANDS = {
  "commit-log": command((q, repo, p) =>
    q.getCommitLog(repo, str(p.branch) ?? "HEAD", {
      ...(num(p.maxCount) !== undefined ? { maxCount: num(p.maxCount) } : {}),
      ...(num(p.skip) !== undefined ? { skip: num(p.skip) } : {}),
    }),
  ),
  branches: command((q, repo) => q.getBranches(repo)),
  commit: command((q, repo, p) => q.getCommitMessage(repo, str(p.hash) ?? "")),
  "diff-stat": command((q, repo, p) => q.getDiffStat(repo, str(p.commit), str(p.worktree))),
  "untracked-files": command((q, repo, p) => q.getUntrackedFiles(repo, str(p.worktree))),
  "uncommitted-files": command((q, repo, p) => q.getUncommittedFiles(repo, str(p.worktree) ?? "")),
  "file-hunks": command((q, repo, p) =>
    q.getCommitFileHunks(repo, str(p.hash) ?? "", str(p.path) ?? "", str(p.query) ?? "", {
      regex: p.regex === true,
      caseSensitive: p.caseSensitive === true,
    }),
  ),
  "file-content": command((q, repo, p) =>
    q.getCommitFileContent(repo, str(p.hash) ?? "", str(p.path) ?? ""),
  ),
  "file-diff": command((q, repo, p) =>
    q.getFileDiff(repo, str(p.path) ?? "", {
      ...(str(p.hash) ? { hash: str(p.hash) } : {}),
      ...(str(p.worktree) ? { worktree: str(p.worktree) } : {}),
    }),
  ),
  "search-commits-window": command((q, repo, p) =>
    q.searchCommitWindow(
      repo,
      p as unknown as CommitSearchOptions,
      Math.max(0, num(p.start) ?? 0),
      Math.max(1, num(p.size) ?? 500),
    ),
  ),
  "match-context": command((q, repo, p) =>
    q.getMatchContext(repo, str(p.hash) ?? "", str(p.query) ?? "", {
      regex: p.regex === true,
      caseSensitive: p.caseSensitive === true,
      content: p.content === true,
    }),
  ),
  "delete-branch": command((q, repo, p) =>
    q.deleteLocalBranch(repo, str(p.branch) ?? "", p.force === true),
  ),
} satisfies Record<string, HandlerFn>;
