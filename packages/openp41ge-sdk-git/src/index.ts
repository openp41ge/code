/**
 * openp41ge-sdk-git — git queries for extension backends (public SDK).
 *
 * `GitQueries` runs git through a `GitRunner` (in a backend, the platform's
 * `ctx.git`) and parses its output: commit log, commits, diff stats, branches,
 * commit search, a file's hunks / content at a commit. Backend-only: a
 * renderer entry may import its types, not its values (the shared extension
 * runtime does not include it).
 */

export { GitQueries, type GitRunner, type MatchOptions } from "./git-queries";
export * from "./git-types";
export {
  buildInlineDiffFile,
  type InlineDiffFile,
  type InlineDiffRow,
} from "./build-inline-diff-file";
