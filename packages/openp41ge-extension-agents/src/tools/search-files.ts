/**
 * tools/search-files.ts — the `search_files` agent tool.
 *
 * Walks a set of roots (leaving out what git ignores) looking for files whose
 * path contains `query`, or for lines inside files that match `content`
 * (plain or a regular expression, smart case), listed as `path:line: text`
 * and capped per file and in total. Results are grouped under a heading per
 * worktree (its repo, branch and folder) with paths relative to it. Errors
 * are reported in-band via `error`. Registers itself against an
 * AgentToolRegistry.
 */

import fs from "fs";
import path from "path";
import ignore, { type Ignore } from "ignore";
import type { AgentTool, AgentToolRegistry, ToolExecutionContext, ToolWorktree } from "./types.js";

/** Resolve a possibly-relative path against the tool context cwd. */
function resolvePath(p: string | undefined, ctx: ToolExecutionContext): string | undefined {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.resolve(ctx.cwd ?? process.cwd(), p);
}

/**
 * Whether `p` lies at or under `root`. Compared lexically after resolving
 * `.`/`..`, so `/root`-adjacent siblings like `/root-evil` are excluded.
 */
function isWithin(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Filter a requested root against the connected-worktree scope.
 *
 * - `roots` undefined → no scope restriction (legacy / direct usage).
 * - `roots` empty → nothing connected → deny the search.
 * - a requested root outside `roots` → caller is trying to escape the scope.
 */
function scopeError(candidates: string[], ctx: ToolExecutionContext): string | null {
  if (ctx.roots === undefined) return null;
  if (ctx.roots.length === 0) {
    return "search_files: no connected worktrees in scope";
  }
  const out = candidates.filter((r) => !ctx.roots!.some((root) => isWithin(r, root)));
  if (out.length) {
    return `search_files: roots outside the connected worktrees (${out.join(", ")})`;
  }
  return null;
}

/** A folder's `.gitignore` rules; paths are matched relative to `dir`. */
interface IgnoreLayer {
  readonly dir: string;
  readonly rules: Ignore;
}

async function gitignoreOf(dir: string): Promise<IgnoreLayer | null> {
  try {
    const text = await fs.promises.readFile(path.join(dir, ".gitignore"), "utf-8");
    return { dir, rules: ignore().add(text) };
  } catch {
    return null;
  }
}

/** Whether a `.gitignore` of `p`'s folder or one above it (up to the root
 *  searched) ignores it. */
function isIgnored(p: string, isDir: boolean, layers: readonly IgnoreLayer[]): boolean {
  return layers.some((layer) => {
    const rel = path.relative(layer.dir, p).split(path.sep).join("/");
    return layer.rules.ignores(isDir ? `${rel}/` : rel);
  });
}

/** Every file under `dir`, in name order, leaving out dot-folders,
 *  `node_modules`, `dist` and what git ignores. `visit` returns false to stop. */
async function walk(
  dir: string,
  layers: readonly IgnoreLayer[],
  visit: (file: string) => Promise<boolean>,
): Promise<boolean> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  const own = await gitignoreOf(dir);
  const here = own ? [...layers, own] : layers;
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isIgnored(p, true, here)) continue;
      if (!(await walk(p, here, visit))) return false;
    } else if (entry.isFile() && !isIgnored(p, false, here)) {
      if (!(await visit(p))) return false;
    }
  }
  return true;
}

/** Paths a search lists unless it asks for a number. */
const DEFAULT_MAX_PATHS = 200;
/** Matching lines a content search lists unless it asks for a number. */
const DEFAULT_MAX_MATCHES = 100;
/** Matching lines listed per file; the rest are counted. */
const MAX_MATCHES_PER_FILE = 20;
/** Larger files are not searched (logs, bundles, data). */
const MAX_FILE_BYTES = 1024 * 1024;
/** How much of the start of a file is checked for a NUL byte (binary). */
const BINARY_SNIFF_BYTES = 8000;
/** How many skipped large files a search names. */
const MAX_NAMED_SKIPS = 5;
/** A longer matching line is shown as the part around the match. */
const MAX_LINE_CHARS = 300;

/** The part of a long line around `at` (where the match starts). */
function excerpt(line: string, at: number): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  const from = Math.max(0, Math.min(at - 100, line.length - MAX_LINE_CHARS));
  const part = line.slice(from, from + MAX_LINE_CHARS);
  return `${from > 0 ? "…" : ""}${part}${from + MAX_LINE_CHARS < line.length ? "…" : ""}`;
}

/** The worktree a searched folder is in: the innermost connected worktree
 *  holding it (with its repo and branch when known), else the folder itself
 *  (no scope given). Results under it are headed by it and their paths are
 *  relative to it. */
function worktreeOf(dir: string, ctx: ToolExecutionContext): { folder: string; heading: string } {
  const folder =
    (ctx.roots ?? [])
      .filter((root) => isWithin(dir, root))
      .sort((a, b) => b.length - a.length)[0] ?? dir;
  const known: ToolWorktree | undefined = ctx.worktrees?.find(
    (w) => path.resolve(w.path) === path.resolve(folder),
  );
  return {
    folder,
    heading: known ? `# ${known.repo} @ ${known.branch} — ${folder}` : `# ${folder}`,
  };
}

const files = (n: number): string => `${n} file${n === 1 ? "" : "s"}`;

/** `p` relative to `folder`, with `/` separators. */
function relativeTo(folder: string, p: string): string {
  return path.relative(folder, p).split(path.sep).join("/");
}

/** Smart case: match exactly when the text has a capital letter (outside a
 *  regular expression's escapes, so `\\S` doesn't count), else any case. */
function hasCapital(content: string, regex: boolean): boolean {
  return /[A-Z]/.test(regex ? content.replace(/\\./g, "") : content);
}

/** Where `content` matches in a line, or -1. */
type Matcher = (line: string) => number;

function matcherFor(
  content: string,
  regex: boolean,
  caseSensitive: boolean,
): Matcher | { error: string } {
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(content, caseSensitive ? "" : "i");
    } catch (err) {
      return {
        error: `search_files: content is not a valid regular expression (${(err as Error).message})`,
      };
    }
    return (line) => line.search(re);
  }
  if (caseSensitive) return (line) => line.indexOf(content);
  const needle = content.toLowerCase();
  return (line) => line.toLowerCase().indexOf(needle);
}

const tool: AgentTool = {
  name: "search_files",
  description:
    "Search the connected worktrees. `query` matches file PATHS within a worktree (a substring, " +
    "e.g. `src/chat` or `agents-chat.ts`) and lists the files. `content` finds TEXT INSIDE files " +
    "and lists each matching line as `path:line: text` (plain text, or a regular expression with " +
    "`regex`). Smart case: content with a capital letter matches its case exactly, all lower " +
    "case matches any case; `caseSensitive` overrides. To find several strings at once, use one " +
    "`regex` with alternation, e.g. `role === [\"'](user|system)[\"']`. A search with no match says " +
    "what it searched (the case, how many files), so it need not be repeated to be sure. " +
    "query is optional with content: give both " +
    "only to search the files whose path matches query. Results are grouped under a heading per " +
    "worktree, `# <repo> @ <branch> — <worktree folder>`, and each path is relative to that " +
    "folder: read a match with read_file at `<worktree folder>/<path>` and startLine. Files git " +
    "ignores, binary files and files over 1 MB are not searched. Pass worktree root paths (or " +
    "folders inside them) in `roots` to search only those; by default every connected worktree " +
    "is searched. Roots outside the connected worktrees are rejected.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A substring of the file paths to match (not their contents).",
      },
      content: {
        type: "string",
        description: "Text to find inside the files (with query: only in the files it matches).",
      },
      regex: {
        type: "boolean",
        description: "Treat content as a JavaScript regular expression (default false).",
      },
      caseSensitive: {
        type: "boolean",
        description:
          "Match content's case exactly (true) or ignore it (false). Default: exact when content has a capital letter.",
      },
      roots: {
        type: "array",
        items: { type: "string" },
        description:
          "Worktree root paths to search. Use paths from the connected-worktrees list. " +
          "Defaults to all connected worktrees.",
      },
      maxResults: {
        type: "number",
        description: `Maximum paths (default ${DEFAULT_MAX_PATHS}) or matching lines (default ${DEFAULT_MAX_MATCHES}).`,
      },
    },
    required: [],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!query && !content) {
      return {
        content: "",
        error: "search_files: give query (a path to match), content (text to find), or both",
      };
    }
    const requested = Array.isArray(args.roots)
      ? (args.roots as string[]).map((r) => resolvePath(r, ctx) ?? r)
      : undefined;

    // Apply the connected-worktree scope.
    let roots: string[];
    if (ctx.roots !== undefined) {
      // No roots argument → search every connected worktree; otherwise search
      // the requested subset (specific worktree(s) / a group of them).
      const candidates = requested && requested.length ? requested : ctx.roots;
      const denied = scopeError(candidates, ctx);
      if (denied) return { content: "", error: denied };
      roots = candidates;
    } else {
      roots = requested && requested.length ? requested : [ctx.cwd ?? process.cwd()];
    }
    // Results per worktree, in the order searched, each under its heading.
    const groups = new Map<string, { heading: string; lines: string[] }>();
    const groupOf = (root: string) => {
      const { folder, heading } = worktreeOf(root, ctx);
      let group = groups.get(folder);
      if (!group) {
        group = { heading, lines: [] };
        groups.set(folder, group);
      }
      return { folder, lines: group.lines };
    };
    const render = (empty: string, footer: string[]): string => {
      const out: string[] = [];
      for (const { heading, lines } of groups.values()) {
        if (lines.length > 0) out.push(heading, ...lines);
      }
      if (out.length === 0) out.push(empty);
      return [...out, ...footer].join("\n");
    };

    try {
      if (!content) {
        const max = typeof args.maxResults === "number" ? args.maxResults : DEFAULT_MAX_PATHS;
        let listed = 0;
        for (const root of roots) {
          const { folder, lines } = groupOf(root);
          const more = await walk(root, [], async (p) => {
            const rel = relativeTo(folder, p);
            if (rel.toLowerCase().includes(query)) {
              lines.push(rel);
              listed++;
            }
            return listed < max;
          });
          if (!more) break;
        }
        return { content: render("(no matching files)", []) };
      }

      const regex = args.regex === true;
      const caseSensitive =
        typeof args.caseSensitive === "boolean" ? args.caseSensitive : hasCapital(content, regex);
      const match = matcherFor(content, regex, caseSensitive);
      if (typeof match !== "function") return { content: "", error: match.error };
      const max = typeof args.maxResults === "number" ? args.maxResults : DEFAULT_MAX_MATCHES;
      let listed = 0;
      let stopped = false;
      let pathMatched = 0;
      let searched = 0;
      let tooBig = 0;
      const bigNames: string[] = [];
      for (const root of roots) {
        const { folder, lines: out } = groupOf(root);
        const visit = async (p: string): Promise<boolean> => {
          const rel = relativeTo(folder, p);
          if (query && !rel.toLowerCase().includes(query)) return true;
          pathMatched++;
          const stat = await fs.promises.stat(p).catch(() => null);
          if (!stat) return true;
          if (stat.size > MAX_FILE_BYTES) {
            tooBig++;
            if (bigNames.length < MAX_NAMED_SKIPS) bigNames.push(rel);
            return true;
          }
          const buf = await fs.promises.readFile(p).catch(() => null);
          if (!buf || buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return true;
          searched++;
          const lines = buf.toString("utf-8").split(/\r?\n/);
          let inFile = 0;
          for (let i = 0; i < lines.length; i++) {
            const at = match(lines[i]);
            if (at < 0) continue;
            inFile++;
            if (inFile > MAX_MATCHES_PER_FILE) continue;
            if (listed >= max) {
              stopped = true;
              return false;
            }
            out.push(`${rel}:${i + 1}: ${excerpt(lines[i].trimEnd(), at)}`);
            listed++;
          }
          if (inFile > MAX_MATCHES_PER_FILE) {
            out.push(`${rel}: ${inFile - MAX_MATCHES_PER_FILE} more matches in this file`);
          }
          return true;
        };
        if (!(await walk(root, [], visit))) break;
      }
      const footer: string[] = [];
      if (stopped) {
        footer.push(
          `(stopped at ${max} matches; narrow it with query (a path) or more specific content)`,
        );
      }
      if (tooBig > 0) {
        const names = `${bigNames.join(", ")}${tooBig > bigNames.length ? ", …" : ""}`;
        footer.push(`(skipped ${files(tooBig)} over 1 MB: ${names})`);
      }
      // Nothing matched: say what was searched, so the answer can be trusted
      // without searching again (a wrong path reads differently from "none").
      const what = regex ? `/${content}/` : `"${content}"`;
      const empty =
        query && pathMatched === 0
          ? `(no files whose path contains "${query}"; nothing searched)`
          : `(no matches for ${what} (${caseSensitive ? "exact" : "any"} case) in ${files(searched)}` +
            `${query ? ` whose path contains "${query}"` : ""})`;
      return { content: render(empty, footer) };
    } catch (err) {
      return { content: "", error: `search_files: ${(err as Error).message}` };
    }
  },
};

/** Register this tool into a registry. */
export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
