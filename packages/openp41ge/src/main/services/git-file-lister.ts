/**
 * git-file-lister.ts — the open palette's `FileLister`: `git ls-files` lists
 * a worktree's tracked files and the untracked ones git does not ignore.
 */

import { execFile } from "child_process";
import type { FileLister } from "./workspace-file-index.js";

/** Empty when git fails (not a repository, no git). */
export class GitFileLister implements FileLister {
  list(root: string): Promise<string[]> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { maxBuffer: 256 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve([]);
          resolve([...new Set(stdout.split("\0").filter(Boolean))]);
        },
      );
    });
  }
}
