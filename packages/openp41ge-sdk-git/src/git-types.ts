/**
 * git-types.ts — the git data `GitQueries` returns (commit log, branches,
 * diff stats, commit search, history: filtered commits, patches, blame,
 * local branches).
 */

export interface CommitEntry {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  relativeDate: string;
  message: string;
  fullMessage: string;
  refs: string[];
  parents: string[];
}

export interface BranchEntry {
  name: string;
  shortName: string;
  isLocal: boolean;
  isCurrent: boolean;
  tracking?: string;
  ahead: number;
  behind: number;
  lastCommit: CommitEntry | null;
}

export interface DiffStatEntry {
  filePath: string;
  added: number;
  deleted: number;
  status: "added" | "modified" | "deleted" | "renamed";
}

/** One hunk of a file's diff. */
export interface SearchHunk {
  /** The raw `@@ -oldStart,count +newStart,count @@` header (with suffix). */
  header: string;
  lines: Array<{ type: "+" | "-" | " "; text: string }>;
}

export interface SearchResultFile {
  path: string;
  additions: number;
  deletions: number;
  /** Matching changed hunks, populated lazily on request (content search). */
  hunks?: SearchHunk[];
}

/** A commit matched by commit search, with its changed files. */
export interface SearchResultCommit {
  repoName: string;
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  relativeDate: string;
  files: SearchResultFile[];
  /** The worktree branch (of `CommitSearchOptions.worktrees`) it is on. */
  worktree?: string;
  /**
   * Where the query matched, when neither the subject nor a changed file's
   * path did: a line of the message body, or a changed line (of `path`).
   */
  matched?: { text: string; in: "body" | "line"; path?: string };
}

/** What part of the commit history to match against. */
export type CommitSearchScope = "message" | "files" | "all";

export interface CommitSearchOptions {
  query: string;
  in: CommitSearchScope;
  /** Match case-sensitive (default false = case-insensitive). */
  caseSensitive?: boolean;
  /** Treat the query as a regular expression (default false = literal). */
  regex?: boolean;
  /**
   * Also match commits whose changed lines contain the query (git -G
   * pickaxe). Literal queries are regex-escaped.
   */
  content?: boolean;
  /**
   * The workspace's worktree branches of this repo: each result names the
   * one it is on (`worktree`), when it is on one.
   */
  worktrees?: readonly string[];
}

/** Which commits `findCommits` lists. */
export interface CommitFilter {
  /** Whose history (default HEAD). */
  readonly ref?: string;
  /** Only commits that change this path. */
  readonly path?: string;
  /** Author name or email (a substring, any case). */
  readonly author?: string;
  /** Dates as git reads them (`2026-01-31`, `2 weeks ago`). */
  readonly since?: string;
  readonly until?: string;
  readonly search?: string;
  /** Where `search` looks: the message (default), code added or removed
   *  (`code`), or added / removed lines matching a regex (`code_regex`). */
  readonly searchIn?: "message" | "code" | "code_regex";
  readonly maxCount?: number;
  readonly skip?: number;
}

/** What `getPatch` diffs: a commit, a range, or a worktree's changes. */
export interface PatchRequest {
  readonly commit?: string;
  readonly from?: string;
  readonly to?: string;
  /** A worktree (its branch): its uncommitted changes. */
  readonly worktree?: string;
  /** With `worktree`: the staged changes, not the unstaged ones. */
  readonly staged?: boolean;
  readonly path?: string;
  /** `<status>\t<path>` lines instead of the patch. */
  readonly namesOnly?: boolean;
}

/** One line of `getBlame`. */
export interface BlameLine {
  readonly line: number;
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  /** ISO date of the author's change. */
  readonly date: string;
  /** The commit's subject. */
  readonly summary: string;
  readonly text: string;
  /** Not committed yet (a worktree's own change). */
  readonly uncommitted?: true;
}

/** A local branch (`getLocalBranches`). */
export interface LocalBranch {
  readonly name: string;
  readonly upstream?: string;
  /** Its upstream branch no longer exists on the remote. */
  readonly upstreamGone: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly lastCommit: {
    readonly hash: string;
    readonly shortHash: string;
    readonly authorName: string;
    readonly date: string;
    readonly message: string;
  };
}
