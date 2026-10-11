/**
 * git-queries.ts — the git extension's queries: commit log, branches, diff
 * stats, a single commit, commit search, a file's hunks / content at a
 * commit, untracked files, deleting a branch.
 *
 * Moved from the platform (`NodeGitCommitService`, git extension plan phase
 * 4). Git itself runs through a `GitRunner` — in the backend, the platform's
 * `ctx.git`, scoped to the calling window's workspace — so this holds only
 * the commands and the parsing.
 */

import { buildInlineDiffFile, type InlineDiffFile } from "./build-inline-diff-file.js";
import type {
  BranchEntry,
  CommitEntry,
  CommitSearchOptions,
  DiffStatEntry,
  SearchHunk,
  SearchResultCommit,
} from "./git-types.js";

/** Run git in a repository (or one of its worktrees): stdout (trailing
 *  whitespace trimmed), or a rejection with git's error. An exit code in
 *  `okExitCodes` (e.g. `diff --no-index`'s 1, "they differ") is not an error. */
export type GitRunner = (
  repoName: string,
  args: string[],
  worktree?: string,
  okExitCodes?: readonly number[],
) => Promise<string>;

/** How a query matches text. */
export interface MatchOptions {
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  /** Also look in changed lines (match context). */
  readonly content: boolean;
}

/** A test of text against the query, or null for an invalid regex. */
function textMatcher(query: string, opts: MatchOptions): ((text: string) => boolean) | null {
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, opts.caseSensitive ? "" : "i");
    } catch {
      return null;
    }
    return (text) => re.test(text);
  }
  const q = opts.caseSensitive ? query : query.toLowerCase();
  return (text) => (opts.caseSensitive ? text : text.toLowerCase()).includes(q);
}

/** Context lines for a whole-file diff: every line of any real file. */
const WHOLE_FILE = "--unified=1000000";

/** Failures here are expected and handled (a missing branch, no HEAD, …);
 *  nothing is logged from the queries themselves. */
const log = { debug: (..._details: unknown[]): void => undefined };

export class GitQueries {
  constructor(private readonly _run: GitRunner) {}

  /** Run git in `repoName` (or its `worktree`); stdout, or throws git's error. */
  private _execGit(args: string[], repoName: string, worktree?: string): Promise<string> {
    return this._run(repoName, args, worktree);
  }

  /**
   * Get commit log with hash-based pagination.
   * First page: runs `git log <branch>` with max-count.
   * Next pages: uses `<after>..HEAD` as revision range so git walks from HEAD
   * and stops at the given boundary — O(log n) instead of the O(n) --skip.
   */
  async getCommitLog(
    repoName: string,
    branch: string,
    options?: { maxCount?: number; skip?: number },
  ): Promise<CommitEntry[]> {
    const maxCount = options?.maxCount ?? 50;
    const skip = options?.skip ?? 0;

    const tryGetLog = async (): Promise<string> => {
      return this._execGit(
        [
          "log",
          branch,
          `--max-count=${maxCount}`,
          `--skip=${skip}`,
          `--format=%H|%h|%an|%ae|%aI|%ar|%s%n%b%n---BODY_END---%n%P%n%D%n---ENTRY_END---`,
        ],
        repoName,
      );
    };

    let output: string;
    try {
      output = await tryGetLog();
    } catch (err) {
      log.debug("getCommitLog failed; trying remote fetch fallback:", repoName, branch, err);
      // If the branch is a remote ref that doesn't exist locally (e.g., listed
      // via git ls-remote but never fetched), fetch the remote ref first.
      if (branch.includes("/")) {
        const slashIdx = branch.indexOf("/");
        const remoteName = branch.slice(0, slashIdx);
        const remoteBranch = branch.slice(slashIdx + 1);
        try {
          await this._execGit(
            [
              "fetch",
              remoteName,
              `+refs/heads/${remoteBranch}:refs/remotes/${remoteName}/${remoteBranch}`,
              "--no-tags",
            ],
            repoName,
          );
          output = await tryGetLog();
        } catch {
          throw new Error(`Branch "${branch}" not found locally or on remote`);
        }
      } else {
        throw new Error(`Branch "${branch}" not found locally`);
      }
    }

    if (!output) return [];
    return this._parseCommitLog(output);
  }

  private _parseCommitLog(output: string): CommitEntry[] {
    const entries: CommitEntry[] = [];

    // Split by the entry-end marker to get individual commit entries
    const rawEntries = output.split("\n---ENTRY_END---\n");

    for (const raw of rawEntries) {
      if (!raw.trim()) continue;

      // Split each entry into header+body and footer using the body-end marker
      const bodyEndIdx = raw.indexOf("\n---BODY_END---\n");
      if (bodyEndIdx === -1) continue;

      const headerBody = raw.slice(0, bodyEndIdx);
      const footer = raw.slice(bodyEndIdx + "\n---BODY_END---\n".length);

      // Parse header line (first line of headerBody)
      const firstLine = headerBody.split("\n")[0];
      const parts = firstLine.split("|");
      if (parts.length < 7) continue;

      const hash = parts[0];
      const shortHash = parts[1];
      const authorName = parts[2];
      const authorEmail = parts[3];
      const date = parts[4];
      const relativeDate = parts[5];
      // The subject is the rest of the header line (it may contain `|`).
      const message = parts.slice(6).join("|");

      // The body is the lines after the header line. The full message is the
      // subject, then the body (as `%B` gives it).
      const body = headerBody.split("\n").slice(1).join("\n").trim();
      const fullMessage = body ? `${message}\n\n${body}` : message;

      // Parse footer: first line = parents, second line = refs
      const footerLines = footer.trimEnd().split("\n");
      const parents = footerLines.length > 0 && footerLines[0] ? footerLines[0].split(" ") : [];
      const refsStr = footerLines.length > 1 ? footerLines[1] || "" : "";

      // Parse refs
      const refs: string[] = [];
      if (refsStr) {
        for (const ref of refsStr.split(", ")) {
          const trimmed = ref.trim();
          if (trimmed) refs.push(trimmed);
        }
      }

      entries.push({
        hash,
        shortHash,
        authorName,
        authorEmail,
        date,
        relativeDate,
        message,
        fullMessage,
        refs,
        parents,
      });
    }

    return entries;
  }

  /**
   * Get a single commit by hash, or null when it is not reachable.
   *
   * Uses a newline-separated format (one field per line) so message bodies
   * containing `|` or other delimiters survive round-tripping unchanged: the
   * whole `%B` (subject + body) spans until the `---ENDBODY---` marker.
   */
  async getCommitMessage(repoName: string, hash: string): Promise<CommitEntry | null> {
    let output: string;
    try {
      output = await this._execGit(
        [
          "log",
          "-1",
          hash,
          "--format=%H%n%h%n%an%n%ae%n%aI%n%ar%n%B%n---ENDBODY---%n%P%n%D%n---ENDENTRY---",
        ],
        repoName,
      );
    } catch (err) {
      // Bad or unreachable hash (or the repo is missing) — no such commit.
      log.debug("getCommit failed; no such commit:", repoName, hash, err);
      return null;
    }
    if (!output.trim()) return null;
    return this._parseSingleCommit(output);
  }

  private _parseSingleCommit(raw: string): CommitEntry | null {
    const bodyEnd = raw.indexOf("\n---ENDBODY---\n");
    if (bodyEnd === -1) return null;

    const header = raw.slice(0, bodyEnd);
    const footer = raw.slice(bodyEnd + "\n---ENDBODY---\n".length);
    const lines = header.split("\n");
    if (lines.length < 6) return null;

    const [hash, shortHash = "", authorName = "", authorEmail = "", date = "", relativeDate = ""] =
      lines;
    // %B is raw (subject + body); fields after the five header lines are the
    // full message. Trim trailing whitespace so the message ends cleanly.
    const fullMessage = lines.slice(6).join("\n").trim();
    const message = fullMessage.split("\n")[0] ?? "";

    const footerLines = footer.trimEnd().split("\n");
    const parents = footerLines.length > 0 && footerLines[0] ? footerLines[0].split(" ") : [];
    // Second footer line: the refs pointing at it (%D), ", "-separated.
    const refsLine = footerLines[1] && footerLines[1] !== "---ENDENTRY---" ? footerLines[1] : "";
    const refs = refsLine
      .split(", ")
      .map((r) => r.trim())
      .filter(Boolean);

    return {
      hash,
      shortHash,
      authorName,
      authorEmail,
      date,
      relativeDate,
      message,
      fullMessage,
      refs,
      parents,
    };
  }

  async getBranches(repoName: string): Promise<BranchEntry[]> {
    // Get current branch (checked out HEAD)
    let currentBranch = "";
    try {
      currentBranch = (await this._execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoName)).trim();
    } catch (err) {
      // Detached HEAD or bare repo
      log.debug("getBranches rev-parse HEAD failed (detached/bare):", repoName, err);
    }

    // Get local branches with upstream and last commit info
    const localOutput = await this._execGit(
      [
        "for-each-ref",
        "--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)",
        "refs/heads/",
      ],
      repoName,
    );

    // Get remote branches — first try local remote-tracking refs, then
    // fall back to querying the remote directly (in case the old fetch
    // command bypassed refs/remotes/origin/*).
    let remoteOutput = "";
    try {
      remoteOutput = await this._execGit(
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"],
        repoName,
      );
    } catch (err) {
      // No remote branches via refs
      log.debug("getBranches no remote-tracking refs:", repoName, err);
    }

    if (!remoteOutput.trim()) {
      try {
        const lsRemote = await this._execGit(
          ["ls-remote", "--heads", "--refs", "origin"],
          repoName,
        );
        remoteOutput = lsRemote
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const match = line.match(/^[a-f0-9]+\s+refs\/heads\/(.+)$/);
            return match ? `origin/${match[1]}` : "";
          })
          .join("\n");
      } catch (err) {
        // No remote branches via ls-remote either
        log.debug("getBranches ls-remote failed:", repoName, err);
      }
    }

    // Build a map of local branches
    const localBranches = new Map<string, { shortHash: string; upstream: string; track: string }>();

    for (const line of localOutput.split("\n")) {
      if (!line.trim()) continue;
      const [ref, shortHash, upstream, track] = line.split("\0");
      if (!ref) continue;
      const name = ref.replace("refs/heads/", "");
      localBranches.set(name, {
        shortHash: shortHash || "",
        upstream: upstream || "",
        track: track || "",
      });
    }

    // Parse remote branches
    const remoteBranches = new Set<string>();
    for (const line of remoteOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const name = trimmed.replace(/^origin\//, "");
      if (name !== "HEAD") remoteBranches.add(name);
    }

    // Get current branch (checked out as a worktree)
    // For bare repos, there's no HEAD branch — we list worktrees instead
    // We can check branch names against existing worktrees

    const branches: BranchEntry[] = [];

    // Add local branches
    for (const [name, info] of localBranches) {
      const { shortHash, upstream, track } = info;

      // Parse ahead/behind from track string (e.g., "[ahead 3, behind 1]")
      let ahead = 0;
      let behind = 0;
      if (track) {
        const aheadMatch = track.match(/ahead (\d+)/);
        const behindMatch = track.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
      }

      let lastCommit: CommitEntry | null = null;
      if (shortHash) {
        // Get the last commit for this branch
        try {
          const logs = await this.getCommitLog(repoName, name, { maxCount: 1 });
          if (logs.length > 0) lastCommit = logs[0];
        } catch (err) {
          log.debug("getBranches last-commit lookup failed:", repoName, name, err);
        }
      }

      branches.push({
        name,
        shortName: name,
        isLocal: true,
        isCurrent: name === currentBranch,
        tracking: upstream || undefined,
        ahead,
        behind,
        lastCommit,
      });
    }

    // Add all remote branches (renderer groups local+remote by shortName)
    for (const remoteName of remoteBranches) {
      if (remoteName === "HEAD") continue;
      branches.push({
        name: `origin/${remoteName}`,
        shortName: remoteName,
        isLocal: false,
        isCurrent: false,
        lastCommit: null,
        ahead: 0,
        behind: 0,
      });
    }

    // Sort: current branch first, then local, then remote
    branches.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      if (a.isLocal && !b.isLocal) return -1;
      if (!a.isLocal && b.isLocal) return 1;
      return a.name.localeCompare(b.name);
    });

    return branches;
  }

  /**
   * A commit's diff stat; without `commitHash`, the uncommitted changes of
   * `worktree` (staged + unstaged, against HEAD).
   */
  async getDiffStat(
    repoName: string,
    commitHash?: string,
    worktree?: string,
  ): Promise<DiffStatEntry[]> {
    let output: string;

    if (commitHash) {
      // Diff for a specific commit
      output = await this._execGit(
        ["diff-tree", "--no-commit-id", "-r", "--numstat", commitHash],
        repoName,
      );
    } else {
      // Working tree diff (unstaged + staged changes)
      try {
        output = await this._execGit(["diff", "HEAD", "--numstat"], repoName, worktree);
      } catch (err) {
        // No HEAD (empty repo)
        log.debug("getDiffStat no HEAD (empty repo):", repoName, err);
        return [];
      }
    }

    if (!output) return [];

    const entries: DiffStatEntry[] = [];
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;

      const added = parseInt(parts[0], 10);
      const deleted = parseInt(parts[1], 10);
      const filePath = parts[2];

      let status: DiffStatEntry["status"] = "modified";
      if (added > 0 && deleted === 0) {
        // Check if file is new (git diff-tree shows "0\t0" for new files with --numstat? No, it shows "-\t-")
        // Actually, for new files git shows the actual counts. Let me check the status differently.
        // For --numstat, new files show added+deleted counts. We can't distinguish from modified.
        // We'll use the --diff-filter approach or just mark as modified unless we use -r --name-status
        status = "modified";
      }

      entries.push({ filePath, added, deleted, status });
    }

    // Get file statuses for accuracy
    if (commitHash) {
      try {
        const statusOutput = await this._execGit(
          ["diff-tree", "--no-commit-id", "-r", "--name-status", commitHash],
          repoName,
        );
        this._applyFileStatuses(entries, statusOutput);
      } catch (err) {
        log.debug("getDiffStat file-statuses failed:", repoName, commitHash, err);
      }
    } else {
      try {
        const statusOutput = await this._execGit(
          ["diff", "HEAD", "--name-status"],
          repoName,
          worktree,
        );
        this._applyFileStatuses(entries, statusOutput);
      } catch (err) {
        log.debug("getDiffStat working-tree statuses failed:", repoName, err);
      }
    }

    return entries;
  }

  /**
   * A worktree's uncommitted files: its changes against HEAD (staged or not),
   * then its untracked files (as added, without line counts). Ignored files
   * are not uncommitted work.
   */
  async getUncommittedFiles(repoName: string, worktree: string): Promise<DiffStatEntry[]> {
    const [changed, untracked] = await Promise.all([
      this.getDiffStat(repoName, undefined, worktree),
      this._execGit(["ls-files", "--others", "--exclude-standard"], repoName, worktree),
    ]);
    const added = untracked
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((filePath): DiffStatEntry => ({ filePath, added: 0, deleted: 0, status: "added" }));
    return [...changed, ...added];
  }

  /** Files git does not track in `worktree` (untracked and gitignored). */
  async getUntrackedFiles(repoName: string, worktree?: string): Promise<string[]> {
    const allPaths = new Set<string>();

    // Untracked non-ignored files (new files not yet staged)
    try {
      const output = await this._execGit(
        ["ls-files", "--others", "--exclude-standard"],
        repoName,
        worktree,
      );
      if (output) {
        for (const p of output.split("\n")) {
          const t = p.trim();
          if (t) allPaths.add(t);
        }
      }
    } catch (err) {
      log.debug("getUntrackedFiles ls-files failed (non-fatal):", repoName, err);
    }

    // Untracked gitignored files (e.g. *.tsbuildinfo, .env, build artifacts)
    try {
      const output = await this._execGit(
        ["ls-files", "--others", "--ignored", "--exclude-standard"],
        repoName,
        worktree,
      );
      if (output) {
        for (const p of output.split("\n")) {
          const t = p.trim();
          if (t) allPaths.add(t);
        }
      }
    } catch (err) {
      log.debug("getUntrackedFiles ls-files ignored failed (non-fatal):", repoName, err);
    }

    return [...allPaths];
  }

  async deleteLocalBranch(repoName: string, branchName: string, force?: boolean): Promise<void> {
    const flag = force ? "-D" : "-d";
    await this._execGit(["branch", flag, branchName], repoName);
  }

  // ─── Commit search (the History search) ────────────────────────────────

  /** ASCII record-separator prefix on every commit-format line (0x1E can't
   * appear in real git data, so it is an unambiguous record boundary). */
  private static readonly _SEARCH_RECORD_SEP = "\x1e";

  /**
   * Where the query matched a commit, beyond its subject and paths: the
   * first matching line of its message body, else (with `content`) the first
   * matching changed line. Null when neither (or git fails); never throws.
   */
  async getMatchContext(
    repoName: string,
    hash: string,
    query: string,
    opts: MatchOptions,
  ): Promise<SearchResultCommit["matched"] | null> {
    const matches = textMatcher(query, opts);
    if (!matches || !hash) return null;
    try {
      const body = await this._execGit(["log", "-1", "--format=%b", hash], repoName);
      const line = body.split("\n").find((l) => matches(l));
      if (line) return { text: line.trim(), in: "body" };
      if (!opts.content) return null;
      const diff = await this._execGit(["show", hash, "--format=", "--unified=0"], repoName);
      let path: string | undefined;
      for (const l of diff.split("\n")) {
        if (l.startsWith("+++ ")) path = l.slice(4).replace(/^b\//, "");
        else if (l.startsWith("--- ")) continue;
        else if ((l.startsWith("+") || l.startsWith("-")) && matches(l.slice(1))) {
          return { text: l.slice(1).trim(), in: "line", ...(path ? { path } : {}) };
        }
      }
    } catch (err) {
      log.debug("commit-search match context failed (best-effort):", repoName, hash, err);
    }
    return null;
  }

  /**
   * Search one window of a repo's history — the commits at positions
   * `start`..`start + size` of its newest-first walk (`--all --date-order`),
   * named by hash so the window is exact — by message, file paths and (with
   * `content`) changed lines. Results are in walk order, without match lines
   * (`getMatchContext` finds those on demand); `walked` is how many commits
   * the window held (fewer than `size`: the history ended).
   */
  async searchCommitWindow(
    repoName: string,
    options: CommitSearchOptions,
    start: number,
    size: number,
  ): Promise<{ commits: SearchResultCommit[]; walked: number }> {
    const query = (options.query ?? "").trim();
    const raw = await this._execGit(
      ["log", "--all", "--date-order", `--skip=${start}`, `--max-count=${size}`, "--format=%H"],
      repoName,
    );
    const hashes = raw ? raw.split(/\s+/).filter(Boolean) : [];
    if (!query || hashes.length === 0) return { commits: [], walked: hashes.length };
    const regexMode = options.regex ?? false;
    const caseSensitive = options.caseSensitive ?? false;
    const inMode = options.in ?? "message";
    const format = `%x1e%H|%h|%an|%aI|%ar|%s`;
    const these = ["log", "--no-walk=unsorted", ...hashes];
    const parse = (out: string): SearchResultCommit[] =>
      out ? this._parseSearchLog(out).map((c) => this._toSearchResultCommit(repoName, c)) : [];
    const found = new Map<string, SearchResultCommit>();
    const add = (commits: SearchResultCommit[]) => {
      for (const c of commits) if (!found.has(c.hash)) found.set(c.hash, c);
    };

    if (inMode === "message" || inMode === "all") {
      add(
        parse(
          await this._execGit(
            [
              ...these,
              ...(regexMode ? [] : ["--fixed-strings"]),
              ...(caseSensitive ? [] : ["--regexp-ignore-case"]),
              `--grep=${query}`,
              `--format=${format}`,
              "--numstat",
            ],
            repoName,
          ),
        ),
      );
    }
    if (inMode === "files" || inMode === "all") {
      const pathMatches = textMatcher(query, { regex: regexMode, caseSensitive, content: false });
      if (pathMatches) {
        add(
          parse(
            await this._execGit([...these, `--format=${format}`, "--numstat"], repoName),
          ).filter((c) => c.files.some((f) => pathMatches(f.path))),
        );
      }
    }
    if (options.content) {
      const pat = regexMode ? query : GitQueries._escapeRegex(query);
      try {
        add(
          parse(
            await this._execGit(
              [
                ...these,
                `-G${pat}`,
                ...(caseSensitive ? [] : ["-i"]),
                `--format=${format}`,
                "--numstat",
              ],
              repoName,
            ),
          ),
        );
      } catch (err) {
        // Content match is best-effort (e.g. a pattern git rejects).
        log.debug("commit-search window content match failed:", repoName, err);
      }
    }

    const order = new Map(hashes.map((h, i) => [h, i]));
    const commits = [...found.values()].sort(
      (a, b) => (order.get(a.hash) ?? 0) - (order.get(b.hash) ?? 0),
    );
    if (options.worktrees?.length && commits.length) {
      await this._nameWorktrees(repoName, commits, options.worktrees);
    }
    return { commits, walked: hashes.length };
  }

  /**
   * Set each result's `worktree`: the branch of `worktrees` it is on (git
   * name-rev picks the nearest; `main~3` is on main). Best-effort.
   */
  private async _nameWorktrees(
    repoName: string,
    results: SearchResultCommit[],
    worktrees: readonly string[],
  ): Promise<void> {
    try {
      const out = await this._execGit(
        [
          "name-rev",
          "--name-only",
          ...worktrees.map((b) => `--refs=refs/heads/${b}`),
          ...results.map((r) => r.hash),
        ],
        repoName,
      );
      const names = out.split("\n");
      results.forEach((r, i) => {
        const name = (names[i] ?? "").trim().replace(/[~^].*$/, "");
        if (name && name !== "undefined" && worktrees.includes(name)) r.worktree = name;
      });
    } catch (err) {
      log.debug("commit-search worktree names failed (best-effort):", repoName, err);
    }
  }

  private _parseSearchLog(output: string): Array<{
    header: string;
    files: Array<{ path: string; additions: number; deletions: number }>;
  }> {
    const commits: Array<{
      header: string;
      files: Array<{ path: string; additions: number; deletions: number }>;
    }> = [];
    let cur: {
      header: string;
      files: Array<{ path: string; additions: number; deletions: number }>;
    } | null = null;

    for (const rawLine of output.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith(GitQueries._SEARCH_RECORD_SEP)) {
        cur = { header: line.slice(GitQueries._SEARCH_RECORD_SEP.length), files: [] };
        commits.push(cur);
        continue;
      }
      if (!cur) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const add = parts[0].trim();
      const del = parts[1].trim();
      cur.files.push({
        path: parts.slice(2).join("\t"),
        additions: add === "-" ? 0 : parseInt(add, 10) || 0,
        deletions: del === "-" ? 0 : parseInt(del, 10) || 0,
      });
    }
    return commits;
  }

  private _toSearchResultCommit(
    repoName: string,
    c: {
      header: string;
      files: Array<{ path: string; additions: number; deletions: number }>;
    },
  ): SearchResultCommit {
    const [hash, shortHash, author, date, relativeDate, ...messageParts] = c.header.split("|");
    return {
      repoName,
      hash: hash ?? "",
      shortHash: shortHash ?? "",
      message: messageParts.join("|") ?? "",
      author: author ?? "",
      date: date ?? "",
      relativeDate: relativeDate ?? "",
      files: c.files,
    };
  }

  /** Escape a literal query so it can be passed to git -G as a fixed pattern. */
  private static _escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Lazy diff helper: the hunks of ONE commit+file, best-effort. Returns []
   * for unknown commit/file or any git error; with a non-empty query only the
   * hunks whose lines contain the query are kept. An empty/whitespace query
   * returns ALL hunks (the commit-file diff viewer asks for the full diff).
   */
  async getCommitFileHunks(
    repoName: string,
    hash: string,
    path: string,
    query: string,
    options: Pick<CommitSearchOptions, "regex" | "caseSensitive">,
  ): Promise<SearchHunk[]> {
    const q = (query ?? "").trim();
    if (!hash || !path) return [];
    const regexMode = options?.regex ?? false;
    const caseSensitive = options?.caseSensitive ?? false;
    const qLower = q.toLowerCase();
    const matches = (text: string): boolean => {
      if (!q) return true; // no query → keep everything
      if (regexMode) {
        try {
          return new RegExp(q, caseSensitive ? "" : "i").test(text);
        } catch (err) {
          log.debug("getCommitFileHunks invalid regex in filter:", q, err);
          return false;
        }
      }
      return caseSensitive ? text.includes(q) : text.toLowerCase().includes(qLower);
    };
    try {
      const out = await this._execGit(
        ["show", hash, "--format=", "--unified=3", "--", path],
        repoName,
      );
      if (!out) return [];
      return this._parseHunks(out).filter((h) => h.lines.some((l) => matches(l.text)));
    } catch (err) {
      log.debug("getCommitFileHunks failed; no hunks:", repoName, hash, path, err);
      return [];
    }
  }

  /**
   * Parse `git show <hash> --format= -- <path>` patch output into hunks. */
  private _parseHunks(output: string): SearchHunk[] {
    const hunks: SearchHunk[] = [];
    let cur: SearchHunk | null = null;
    for (const rawLine of output.split("\n")) {
      const line = rawLine;
      if (line.startsWith("@@")) {
        cur = { header: line, lines: [] };
        hunks.push(cur);
        continue;
      }
      if (!cur) continue;
      // "\ No newline at end of file" marks the line before it; not a line.
      if (line.startsWith("\\")) continue;
      if (line.startsWith("+")) cur.lines.push({ type: "+", text: line.slice(1) });
      else if (line.startsWith("-")) cur.lines.push({ type: "-", text: line.slice(1) });
      else cur.lines.push({ type: " ", text: line.startsWith(" ") ? line.slice(1) : line });
    }
    return hunks;
  }

  /**
   * Full content of `path` at `hash` (git show <hash>:<path>), or null for an
   * unknown commit/file. Best-effort — errors resolve null, never throw.
   */
  async getCommitFileContent(repoName: string, hash: string, path: string): Promise<string | null> {
    if (!hash || !path) return null;
    try {
      return await this._execGit(["show", `${hash}:${path}`], repoName);
    } catch (err) {
      log.debug("getCommitFileContent failed; no content:", repoName, hash, path, err);
      return null;
    }
  }

  /**
   * One file as an inline diff document (the whole file, removed lines
   * spliced in): at `hash` (that commit's change), else in `worktree` against
   * HEAD — changed, untracked (all added), deleted (all removed), or
   * unchanged (itself). Null when the file is in neither.
   */
  async getFileDiff(
    repoName: string,
    path: string,
    at: { readonly hash?: string; readonly worktree?: string },
  ): Promise<InlineDiffFile | null> {
    if (!path) return null;
    if (at.hash) {
      const [content, hunks] = await Promise.all([
        this.getCommitFileContent(repoName, at.hash, path),
        this.getCommitFileHunks(repoName, at.hash, path, "", {}),
      ]);
      return content === null && hunks.length === 0 ? null : buildInlineDiffFile(content, hunks);
    }
    const wt = at.worktree;
    const changed = await this._execGit(["diff", "HEAD", WHOLE_FILE, "--", path], repoName, wt);
    if (changed) return GitQueries._wholeFileDiff(this._parseHunks(changed));
    const untracked = await this._execGit(
      ["ls-files", "--others", "--exclude-standard", "--", path],
      repoName,
      wt,
    );
    if (untracked) {
      const added = await this._run(
        repoName,
        ["diff", "--no-index", WHOLE_FILE, "--", "/dev/null", path],
        wt,
        [1],
      );
      return GitQueries._wholeFileDiff(this._parseHunks(added));
    }
    const content = await this.getCommitFileContent(repoName, "HEAD", path);
    return content === null ? null : buildInlineDiffFile(content, []);
  }

  /** A whole-file diff's document: its new side is the context and added lines. */
  private static _wholeFileDiff(hunks: SearchHunk[]): InlineDiffFile {
    const newSide = hunks.flatMap((h) => h.lines.filter((l) => l.type !== "-").map((l) => l.text));
    return buildInlineDiffFile(newSide.join("\n"), hunks);
  }

  private _applyFileStatuses(entries: DiffStatEntry[], statusOutput: string): void {
    const statusMap = new Map<string, DiffStatEntry["status"]>();
    for (const line of statusOutput.split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^([ARMDTUX])\d*\s+(.+)$/);
      if (!match) continue;
      const code = match[1];
      const filePath = match[2].trim();

      let status: DiffStatEntry["status"];
      switch (code) {
        case "A":
          status = "added";
          break;
        case "D":
          status = "deleted";
          break;
        case "R":
          status = "renamed";
          // Handle "R100\toldpath\tnewpath"
          const parts = match[2].split("\t");
          statusMap.set(parts[parts.length - 1], "renamed");
          continue;
        case "M":
        default:
          status = "modified";
          break;
      }
      statusMap.set(filePath, status);
    }

    for (const entry of entries) {
      if (statusMap.has(entry.filePath)) {
        entry.status = statusMap.get(entry.filePath)!;
      }
    }
  }
}
