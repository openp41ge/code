/**
 * history-model.ts — the History sidebar's state: the search query and its
 * options, the repos it covers, and the results.
 *
 * Commit messages are always searched; "files" adds changed file paths and
 * "content" changed lines (git -G). Regex / match case apply to all of them.
 * Each repo's history streams in windows of SEARCH_WINDOW commits, up to the
 * depth limit (no cap on results); where a result matched beyond its subject
 * and paths is fetched on demand (`loadMatch`). The search covers the workspace's repos — or, in an advanced search with
 * text in the repo filter, the ones whose name matches it — each searched through the injected
 * `HistoryApi` (the extension's backend), merged newest first. Typing
 * searches after a 250ms pause; Enter at once. A newer search drops an older
 * one's results. No DOM.
 */

import type { CommitSearchOptions, SearchResultCommit } from "./git-types.js";

/** Git, for the search. May reject with git's error. */
export interface HistoryApi {
  /** Search one window of a repo's newest-first history (`start`, `size`
   *  commits): its matches, and how many commits it held. */
  searchWindow(
    repo: string,
    options: CommitSearchOptions,
    start: number,
    size: number,
  ): Promise<{ commits: SearchResultCommit[]; walked: number }>;
  /** Where a commit matched, beyond its subject and paths (body or changed line). */
  matchContext(
    repo: string,
    hash: string,
    query: string,
    opts: { regex: boolean; caseSensitive: boolean; content: boolean },
  ): Promise<SearchResultCommit["matched"] | null>;
}

export type HistoryToggle =
  "files" | "content" | "regex" | "caseSensitive" | "repoFilterRegex" | "repoFilterCase";

/** How many of each repo's newest commits a search walks. */
export const DEPTH_LIMITS = [1000, 2000, 3000, 5000, 10000] as const;

const DEBOUNCE_MS = 250;
/** Commits searched per call: each repo's history streams in windows this size. */
export const SEARCH_WINDOW = 500;

export interface HistoryState {
  readonly query: string;
  readonly files: boolean;
  readonly content: boolean;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  /** Advanced search: the repo filter shows, and applies. */
  readonly advanced: boolean;
  /** Only repos whose name matches this (in an advanced search, when it has text). */
  readonly repoFilterText: string;
  readonly repoFilterRegex: boolean;
  readonly repoFilterCase: boolean;
  readonly maxCount: number;
  /** The workspace's repos. */
  readonly repos: readonly string[];
  readonly searching: boolean;
  /** Commits searched so far (all repos), and how many the search covers at most. */
  readonly walked: number;
  readonly total: number;
  /** Repositories the search covers. */
  readonly repoCount: number;
  /** How long the finished search took. */
  readonly elapsedMs?: number;
  readonly error?: string;
  /** The last search's results; null before one (or with no query). */
  readonly results: readonly SearchResultCommit[] | null;
  /** The query the results are for (what the rows highlight). */
  readonly resultsQuery: string;
  /** Expanded commit rows (`repo:hash`). */
  readonly expanded: readonly string[];
}

/** Every `[start, end)` where `query` hits `text`; none for an invalid regex. */
export function hits(
  text: string,
  query: string,
  opts: { readonly regex: boolean; readonly caseSensitive: boolean },
): Array<[number, number]> {
  const q = query.trim();
  if (!q) return [];
  const out: Array<[number, number]> = [];
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(q, opts.caseSensitive ? "g" : "gi");
    } catch {
      return [];
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        if (re.lastIndex >= text.length) break;
        re.lastIndex += 1; // a zero-width match: step past it
        continue;
      }
      out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }
  const needle = opts.caseSensitive ? q : q.toLowerCase();
  const hay = opts.caseSensitive ? text : text.toLowerCase();
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    out.push([i, i + needle.length]);
  }
  return out;
}

/**
 * A result's first line, split around its first match: the message when it
 * matches, else the first matching changed file's path, else the body or
 * changed line the search found; the message whole (no match) otherwise.
 * The view keeps `match` in view whatever the width.
 */
export function entryParts(
  c: SearchResultCommit,
  query: string,
  opts: { readonly regex: boolean; readonly caseSensitive: boolean },
): { before: string; match: string; after: string } {
  const candidates = [
    c.message,
    ...c.files.map((f) => f.path),
    ...(c.matched ? [c.matched.text] : []),
  ];
  for (const text of candidates) {
    const [first] = hits(text, query, opts);
    if (first) {
      return {
        before: text.slice(0, first[0]),
        match: text.slice(first[0], first[1]),
        after: text.slice(first[1]),
      };
    }
  }
  return { before: "", match: "", after: c.message };
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The results bar's text: how many results, across how many of the searched
 * repositories, how many commits were searched, and how long it took — or,
 * while searching, how far it has got. Before a search: what one would cover
 * (`scope` repositories, the newest `depth` commits of each).
 */
export function resultsSummary(
  s: Pick<
    HistoryState,
    "results" | "resultsQuery" | "searching" | "walked" | "total" | "repoCount" | "elapsedMs"
  >,
  scope = 0,
  depth = 0,
): string {
  if (!s.results || !s.resultsQuery) {
    return scope === 0
      ? "No repositories to search"
      : `Searches ${plural(scope, "repository", "repositories")} · newest ${depth.toLocaleString()} commits each`;
  }
  const found = new Set(s.results.map((c) => c.repoName)).size;
  const results = plural(s.results.length, "result", "results");
  const where =
    s.repoCount === 1
      ? "in 1 repository"
      : `across ${found.toLocaleString()} of ${plural(s.repoCount, "repository", "repositories")}`;
  if (s.searching) {
    return `Searching… ${results} ${where} · ${s.walked.toLocaleString()} / ${s.total.toLocaleString()} commits`;
  }
  const took = s.elapsedMs === undefined ? "" : ` · ${(s.elapsedMs / 1000).toFixed(1)}s`;
  return `${results} ${where} · ${plural(s.walked, "commit", "commits")} searched${took}`;
}

export class HistoryModel {
  private _state: HistoryState = {
    query: "",
    files: false,
    content: false,
    regex: false,
    caseSensitive: false,
    advanced: false,
    repoFilterText: "",
    repoFilterRegex: false,
    repoFilterCase: false,
    maxCount: DEPTH_LIMITS[0],
    repos: [],
    searching: false,
    walked: 0,
    total: 0,
    repoCount: 0,
    results: null,
    resultsQuery: "",
    expanded: [],
  };
  /** Each repo's worktree branches (a result names the one it is on). */
  private _worktrees: Readonly<Record<string, readonly string[]>> = {};
  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** The running search's match options (for match lines on demand). */
  private _searchOptions = { regex: false, caseSensitive: false, content: false };
  /** Results whose match line was asked for (this search). */
  private readonly _matchRequests = new Set<string>();
  private _token = 0;

  constructor(
    private readonly _api: HistoryApi,
    private readonly _changed: () => void,
  ) {}

  get state(): HistoryState {
    return this._state;
  }

  private _set(update: Partial<HistoryState>): void {
    this._state = { ...this._state, ...update };
    this._changed();
  }

  /** The workspace's repos (from the context, every render). */
  setRepos(repos: readonly string[]): void {
    const same =
      repos.length === this._state.repos.length &&
      repos.every((r, i) => r === this._state.repos[i]);
    if (!same) this._set({ repos: [...repos] });
  }

  /** Each repo's worktree branches (from the context, every render). */
  setWorktrees(worktrees: Readonly<Record<string, readonly string[]>>): void {
    this._worktrees = worktrees;
  }

  /** The repos a search covers: all, or those the repo filter matches. */
  scope(): string[] {
    const s = this._state;
    const pattern = s.advanced ? s.repoFilterText.trim() : "";
    if (!pattern) return [...s.repos];
    return s.repos.filter(
      (name) =>
        hits(name, pattern, { regex: s.repoFilterRegex, caseSensitive: s.repoFilterCase }).length >
        0,
    );
  }

  setQuery(query: string): void {
    this._set({ query });
    if (!query.trim()) {
      this._cancel();
      this._set({
        results: null,
        resultsQuery: "",
        searching: false,
        error: undefined,
        walked: 0,
        total: 0,
      });
      return;
    }
    this._debounce();
  }

  /** Simple (false) or advanced (true) search. */
  setAdvanced(advanced: boolean): void {
    if (advanced === this._state.advanced) return;
    this._set({ advanced });
    if (this._state.repoFilterText.trim()) this._rerun();
  }

  setRepoFilter(text: string): void {
    this._set({ repoFilterText: text });
    this._rerun();
  }

  toggle(option: HistoryToggle): void {
    this._set({ [option]: !this._state[option] } as Partial<HistoryState>);
    this._rerun();
  }

  setMaxCount(maxCount: number): void {
    if (maxCount === this._state.maxCount) return;
    this._set({ maxCount });
    this._rerun();
  }

  toggleExpanded(key: string): void {
    const expanded = this._state.expanded;
    this._set({
      expanded: expanded.includes(key) ? expanded.filter((k) => k !== key) : [...expanded, key],
    });
  }

  /** Search now (Enter). */
  searchNow(): void {
    this._cancelTimer();
    void this._search();
  }

  dispose(): void {
    this._cancel();
  }

  /** An option changed: search again if there is a query. */
  private _rerun(): void {
    if (this._state.query.trim()) this._debounce();
  }

  private _debounce(): void {
    this._cancelTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._search();
    }, DEBOUNCE_MS);
  }

  private _cancelTimer(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  private _cancel(): void {
    this._cancelTimer();
    this._token += 1;
  }

  /**
   * Search every repo in scope, each walking its history newest first in
   * windows of SEARCH_WINDOW commits (up to the depth limit), on its own (a
   * slow repo does not hold the others back). Matches are merged in, newest
   * first, as each window arrives.
   */
  private async _search(): Promise<void> {
    const s = this._state;
    const query = s.query.trim();
    if (!query) return;
    const token = ++this._token;
    this._matchRequests.clear();
    const repos = this.scope();
    const maxCount = s.maxCount;
    const options: CommitSearchOptions = {
      query,
      in: s.files ? "all" : "message",
      caseSensitive: s.caseSensitive,
      regex: s.regex,
      content: s.content,
    };
    this._searchOptions = { regex: s.regex, caseSensitive: s.caseSensitive, content: s.content };
    this._set({
      results: [],
      resultsQuery: query,
      searching: repos.length > 0,
      error: undefined,
      expanded: [],
      walked: 0,
      total: repos.length * maxCount,
      repoCount: repos.length,
      elapsedMs: undefined,
    });
    const startedAt = Date.now();
    let failures = 0;
    let lastError: unknown;
    const walk = async (repo: string): Promise<void> => {
      const worktrees = this._worktrees[repo];
      const repoOptions = worktrees?.length ? { ...options, worktrees } : options;
      for (let start = 0; start < maxCount;) {
        const size = Math.min(SEARCH_WINDOW, maxCount - start);
        let found: { commits: SearchResultCommit[]; walked: number };
        try {
          found = await this._api.searchWindow(repo, repoOptions, start, size);
        } catch (err) {
          failures += 1;
          lastError = err;
          return;
        }
        if (token !== this._token) return;
        start += found.walked;
        const results = found.commits.length
          ? [...(this._state.results ?? []), ...found.commits].sort(
              (a, b) => Date.parse(b.date) - Date.parse(a.date),
            )
          : this._state.results;
        this._set({ results, walked: this._state.walked + found.walked });
        if (found.walked < size) return; // the history ended
      }
    };
    await Promise.all(repos.map(walk));
    if (token !== this._token) return;
    if (repos.length > 0 && failures === repos.length) {
      const err = lastError;
      this._set({ searching: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    this._set({ searching: false, elapsedMs: Date.now() - startedAt });
  }

  /**
   * Fetch where a result matched (once), when its subject and paths do not
   * show it: the view asks for the rows it shows.
   */
  loadMatch(hash: string): void {
    const s = this._state;
    const c = s.results?.find((r) => r.hash === hash);
    if (!c || c.matched || this._matchRequests.has(hash)) return;
    const opts = this._searchOptions;
    if (hits(c.message, s.resultsQuery, opts).length > 0) return;
    if (c.files.some((f) => hits(f.path, s.resultsQuery, opts).length > 0)) return;
    this._matchRequests.add(hash);
    const token = this._token;
    void this._api.matchContext(c.repoName, c.hash, s.resultsQuery, opts).then(
      (matched) => {
        if (token !== this._token || !matched) return;
        this._set({
          results: (this._state.results ?? []).map((r) =>
            r.hash === hash ? { ...r, matched } : r,
          ),
        });
      },
      () => undefined, // best-effort: the row shows its subject
    );
  }
}
