/**
 * tools/git.ts — the agent's git tools: git_log, git_show, git_diff,
 * git_blame, git_branches.
 *
 * They read a connected repository's history and changes, never change it,
 * and never reach the network. Git runs through the platform (the context's
 * `git`: the chat's workspace, a repository by name, no shell), with the
 * queries and parsing of `openp41ge-sdk-git`. Each tool builds git's
 * arguments itself; a ref or path that reads as an option is refused. Output
 * is compact text, cut with a note on how to narrow it when large. Errors
 * are reported in-band.
 */

import { GitQueries, type GitRunner } from "openp41ge-sdk-git";
import type {
  AgentTool,
  AgentToolRegistry,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types.js";

/** The most a result holds (characters). */
const MAX_OUTPUT = 40_000;
/** The most lines of one file's diff. */
const MAX_FILE_DIFF_LINES = 400;
/** The most lines git_blame covers. */
const MAX_BLAME_LINES = 200;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;

const REPO_PARAM = {
  type: "string",
  description: "The repository, as in the connected-repositories list (e.g. github.com/org/repo).",
};

/** Run git through the context's `git`, as `GitQueries` expects. */
function runnerOf(ctx: ToolExecutionContext): GitRunner | null {
  const git = ctx.git;
  if (!git) return null;
  return async (repo, args, worktree, okExitCodes) => {
    const result = await git({ repo, args, ...(worktree ? { worktree } : {}) });
    if (result.ok || (result.exitCode !== null && okExitCodes?.includes(result.exitCode))) {
      return result.stdout.trimEnd();
    }
    throw new Error(result.error || result.stderr.trim() || "git failed");
  };
}

/** Cut `out` to the most a result holds, saying how to narrow it. */
function capped(out: string, narrow: string): string {
  if (out.length <= MAX_OUTPUT) return out;
  return `${out.slice(0, MAX_OUTPUT)}\n… [output cut at ${MAX_OUTPUT} characters; ${narrow}]`;
}

/** Cut each file's part of a unified patch to `MAX_FILE_DIFF_LINES` lines. */
function cutPatch(patch: string): string {
  return patch
    .split(/(?=^diff --git )/m)
    .map((part) => {
      const lines = part.split("\n");
      if (lines.length <= MAX_FILE_DIFF_LINES) return part;
      const rest = lines.length - MAX_FILE_DIFF_LINES;
      return `${lines.slice(0, MAX_FILE_DIFF_LINES).join("\n")}\n… [${rest} more lines of this file cut; pass its path to see one file]\n`;
    })
    .join("");
}

const day = (iso: string): string => iso.slice(0, 10);

/**
 * A tool body: the repo and the queries ready, or an in-band error. A thrown
 * error (git's, or a refused value) becomes the tool's error.
 */
function gitTool(
  name: string,
  body: (repo: string, q: GitQueries, args: Record<string, unknown>) => Promise<string>,
): AgentTool["execute"] {
  return async (args, ctx): Promise<ToolExecutionResult> => {
    const run = runnerOf(ctx);
    if (!run) return { content: "", error: `${name}: no workspace to read git in` };
    const repo = text(args.repo);
    if (!repo) return { content: "", error: `${name}: a repo is required` };
    try {
      return { content: await body(repo, new GitQueries(run), args) };
    } catch (err) {
      return { content: "", error: `${name}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
}

const gitLog: AgentTool = {
  name: "git_log",
  description:
    "List a repository's commits, newest first, one line each (hash, date, author, subject). " +
    "Filter by ref (branch, tag or commit; default HEAD), path, author, date, or search the " +
    "messages (search_in: message) or the code added or removed (code; code_regex for a regex). " +
    "Use git_show for a commit's details.",
  parameters: {
    type: "object",
    properties: {
      repo: REPO_PARAM,
      ref: { type: "string", description: "Whose history (default HEAD)." },
      path: { type: "string", description: "Only commits changing this path (in the repository)." },
      author: { type: "string", description: "Author name or email (part of it)." },
      since: {
        type: "string",
        description: "Only after this date (e.g. 2026-01-31, 2 weeks ago).",
      },
      until: { type: "string", description: "Only before this date." },
      search: { type: "string", description: "Text to look for (see search_in)." },
      search_in: {
        type: "string",
        enum: ["message", "code", "code_regex"],
        description:
          "Where search looks: message (default), code added or removed, or a regex over changed lines.",
      },
      limit: { type: "number", description: "How many commits (default 30, at most 200)." },
      skip: { type: "number", description: "Skip this many first (for the next page)." },
    },
    required: ["repo"],
    additionalProperties: false,
  },
  execute: gitTool("git_log", async (repo, q, args) => {
    const limit = Math.max(1, Math.min(int(args.limit, 30), 200));
    const skip = Math.max(0, int(args.skip, 0));
    const searchIn = text(args.search_in);
    const commits = await q.findCommits(repo, {
      ...(text(args.ref) ? { ref: text(args.ref) } : {}),
      ...(text(args.path) ? { path: text(args.path) } : {}),
      ...(text(args.author) ? { author: text(args.author) } : {}),
      ...(text(args.since) ? { since: text(args.since) } : {}),
      ...(text(args.until) ? { until: text(args.until) } : {}),
      ...(text(args.search) ? { search: text(args.search) } : {}),
      ...(searchIn === "code" || searchIn === "code_regex" || searchIn === "message"
        ? { searchIn }
        : {}),
      maxCount: limit,
      skip,
    });
    if (commits.length === 0) return "No commits match.";
    const lines = commits.map((c) => {
      const refs = c.refs.length > 0 ? ` (${c.refs.join(", ")})` : "";
      return `${c.shortHash} ${day(c.date)} ${c.authorName}  ${c.message}${refs}`;
    });
    const more = commits.length === limit ? `\n(More may follow: pass skip: ${skip + limit}.)` : "";
    return capped(`${lines.join("\n")}${more}`, "pass a smaller limit");
  }),
};

const gitShow: AgentTool = {
  name: "git_show",
  description:
    "Show a commit: author, date, full message, the files it changed (+/− lines) and its diff " +
    "(only path's, when given; none with stat_only). With file_content and a path, show the " +
    "file as it was at ref instead.",
  parameters: {
    type: "object",
    properties: {
      repo: REPO_PARAM,
      ref: { type: "string", description: "The commit (hash, branch, tag, HEAD~2…)." },
      path: { type: "string", description: "Only this file's diff, or the file to show." },
      stat_only: { type: "boolean", description: "Only the message and the changed files." },
      file_content: { type: "boolean", description: "Show path's content at ref, not the commit." },
    },
    required: ["repo", "ref"],
    additionalProperties: false,
  },
  execute: gitTool("git_show", async (repo, q, args) => {
    const ref = text(args.ref);
    if (!ref) throw new Error("a ref is required");
    const path = text(args.path);
    if (args.file_content === true) {
      if (!path) throw new Error("file_content needs a path");
      if (ref.startsWith("-")) throw new Error(`'${ref}' is not a ref`);
      const content = await q.getCommitFileContent(repo, ref, path);
      if (content === null) throw new Error(`${path} is not in ${ref}`);
      return capped(content, "use read_file on a worktree, or git_blame for a range of lines");
    }
    const [commit] = await q.findCommits(repo, { ref, maxCount: 1 });
    if (!commit) throw new Error(`no commit ${ref}`);
    const files = await q.getDiffStat(repo, commit.hash);
    const head = [
      `commit ${commit.hash}${commit.refs.length ? ` (${commit.refs.join(", ")})` : ""}`,
      `Author: ${commit.authorName} <${commit.authorEmail}>`,
      `Date:   ${commit.date}`,
      ...(commit.parents.length > 1 ? [`Merge:  ${commit.parents.join(" ")}`] : []),
      "",
      commit.fullMessage
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
      "",
      `Files (${files.length}):`,
      ...files.map((f) => `  ${f.status.padEnd(8)} ${f.filePath} +${f.added} -${f.deleted}`),
    ].join("\n");
    if (args.stat_only === true) return capped(head, "pass a path");
    const patch = await q.getPatch(repo, { commit: commit.hash, ...(path ? { path } : {}) });
    return capped(`${head}\n\n${cutPatch(patch)}`, "pass a path, or stat_only");
  }),
};

const gitDiff: AgentTool = {
  name: "git_diff",
  description:
    "Show changes: a worktree's uncommitted changes (branch: the worktree's branch; unstaged, " +
    "or staged with staged: true), or the difference between two refs (from, to). files_only " +
    "lists the changed files (for a worktree, untracked files too). Only path's, when given.",
  parameters: {
    type: "object",
    properties: {
      repo: REPO_PARAM,
      branch: { type: "string", description: "The worktree (its branch) whose changes to show." },
      staged: { type: "boolean", description: "The worktree's staged changes, not the unstaged." },
      from: { type: "string", description: "Diff from this ref (with to; default HEAD)." },
      to: { type: "string", description: "Diff to this ref (default HEAD)." },
      path: { type: "string", description: "Only this path." },
      files_only: { type: "boolean", description: "Only the changed files." },
    },
    required: ["repo"],
    additionalProperties: false,
  },
  execute: gitTool("git_diff", async (repo, q, args) => {
    const branch = text(args.branch);
    const from = text(args.from);
    const to = text(args.to);
    const path = text(args.path);
    const filesOnly = args.files_only === true;
    if (from || to) {
      const out = await q.getPatch(repo, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(path ? { path } : {}),
        namesOnly: filesOnly,
      });
      if (!out) return "No differences.";
      return capped(filesOnly ? out : cutPatch(out), "pass a path, or files_only");
    }
    if (!branch) throw new Error("pass the worktree's branch, or from / to refs");
    if (filesOnly) {
      const files = await q.getUncommittedFiles(repo, branch);
      if (files.length === 0) return `No uncommitted changes in ${branch}.`;
      const lines = files.map((f) =>
        f.added === 0 && f.deleted === 0 && f.status === "added"
          ? `  untracked ${f.filePath}`
          : `  ${f.status.padEnd(9)} ${f.filePath} +${f.added} -${f.deleted}`,
      );
      return capped(`Uncommitted in ${branch}:\n${lines.join("\n")}`, "pass a path");
    }
    const out = await q.getPatch(repo, {
      worktree: branch,
      staged: args.staged === true,
      ...(path ? { path } : {}),
    });
    if (!out) {
      return args.staged === true
        ? `Nothing staged in ${branch}.`
        : `No unstaged changes in ${branch} (files_only lists untracked files).`;
    }
    return capped(cutPatch(out), "pass a path, or files_only");
  }),
};

const gitBlame: AgentTool = {
  name: "git_blame",
  description:
    "Show who last changed each line of a range of a file, and in which commit: at ref " +
    "(default HEAD), or in a worktree (branch) with its uncommitted lines. At most " +
    `${MAX_BLAME_LINES} lines.`,
  parameters: {
    type: "object",
    properties: {
      repo: REPO_PARAM,
      path: { type: "string", description: "The file, in the repository." },
      start_line: { type: "number", description: "First line (1-based)." },
      end_line: { type: "number", description: "Last line." },
      ref: { type: "string", description: "Blame the file at this ref (default HEAD)." },
      branch: { type: "string", description: "Blame the worktree of this branch instead." },
    },
    required: ["repo", "path", "start_line", "end_line"],
    additionalProperties: false,
  },
  execute: gitTool("git_blame", async (repo, q, args) => {
    const path = text(args.path);
    if (!path) throw new Error("a path is required");
    const start = Math.max(1, int(args.start_line, 1));
    const end = int(args.end_line, start);
    if (end < start) throw new Error("end_line is before start_line");
    if (end - start + 1 > MAX_BLAME_LINES) {
      throw new Error(`at most ${MAX_BLAME_LINES} lines at a time`);
    }
    const branch = text(args.branch);
    const ref = text(args.ref);
    const lines = await q.getBlame(repo, path, {
      start,
      end,
      ...(branch ? { worktree: branch } : ref ? { ref } : {}),
    });
    const width = String(end).length;
    return lines
      .map((l) =>
        l.uncommitted
          ? `${String(l.line).padStart(width)} uncommitted  ${l.text}`
          : `${String(l.line).padStart(width)} ${l.shortHash} ${day(l.date)} ${l.author}  ${l.text}`,
      )
      .join("\n");
  }),
};

const gitBranches: AgentTool = {
  name: "git_branches",
  description:
    "List a repository's local branches (upstream, commits ahead / behind it, last commit) and " +
    "its remote branches as last fetched.",
  parameters: {
    type: "object",
    properties: { repo: REPO_PARAM },
    required: ["repo"],
    additionalProperties: false,
  },
  execute: gitTool("git_branches", async (repo, q) => {
    const [local, remote] = await Promise.all([
      q.getLocalBranches(repo),
      q.getRemoteBranches(repo),
    ]);
    const track = (b: (typeof local)[number]): string => {
      if (!b.upstream) return " (no upstream)";
      if (b.upstreamGone) return ` → ${b.upstream} (gone from the remote)`;
      const parts = [b.ahead ? `${b.ahead} ahead` : "", b.behind ? `${b.behind} behind` : ""];
      const state = parts.filter(Boolean).join(", ") || "up to date";
      return ` → ${b.upstream} (${state})`;
    };
    const lines = [
      "Local:",
      ...local.map(
        (b) =>
          `  ${b.name}${track(b)} — ${b.lastCommit.shortHash} ${day(b.lastCommit.date)} ${b.lastCommit.message}`,
      ),
      "Remote:",
      ...(remote.length ? remote.map((r) => `  ${r}`) : ["  (none fetched)"]),
    ];
    return capped(lines.join("\n"), "the list is long; use git_log with a ref");
  }),
};

/** The git tools, in the order they are offered. */
export const GIT_TOOLS: readonly AgentTool[] = [gitLog, gitShow, gitDiff, gitBlame, gitBranches];

export function register(registry: AgentToolRegistry): void {
  for (const tool of GIT_TOOLS) registry.register(tool);
}
