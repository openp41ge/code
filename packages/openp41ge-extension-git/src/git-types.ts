/**
 * git-types.ts — the git data the extension's queries return (commit log,
 * branches, diff stats, commit search). The extension's own types: core
 * libraries are not shared with extensions (AGENTS.md §3).
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
