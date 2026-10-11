/**
 * tree.ts — directory listing for the Explorer extension.
 *
 * Pure filesystem logic (no Electron, no shared platform code) so the
 * extension stays self-contained and testable in isolation.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A single entry in a directory listing. */
export interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "dir" | "file";
  /**
   * Prefetched nested listing for a directory. Present when the listing was
   * requested with `depth > 0` and the subdirectory was readable; absent when
   * the directory wasn't prefetched (or its read failed), so the host can
   * fetch it lazily on expand instead of showing a wrong empty folder.
   */
  readonly children?: TreeNode[];
}

/**
 * Create a directory at `dirPath`. Non-recursive: throws (EEXIST) if the
 * directory already exists, so a create never silently reuses an existing
 * folder and the renderer can surface a duplicate-entry error.
 */
export async function createDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: false });
}

/**
 * Create an empty file at `filePath`. Uses exclusive create (`wx`) so an
 * existing path fails (EEXIST) rather than clobbering the file.
 */
export async function createFile(filePath: string): Promise<void> {
  await writeFile(filePath, "", { flag: "wx" });
}

/** Upper bound on how many nested levels a single `read-dir` call will send.
 *  Bounds IPC payload size; the host's own prefetch-depth setting is clamped
 *  to this too. */
export const MAX_LIST_DEPTH = 4;

/**
 * List the children of `dirPath`. When `depth > 0`, every directory child is
 * prefetched recursively up to `depth` additional levels, attaching its
 * nested listing as `children` so the host can expand a freshly-loaded folder
 * without another round trip. A subdirectory that fails to read is simply not
 * prefetched (`children` absent) rather than failing the whole parent.
 *
 * Dot-entries (`.git`, `.DS_Store`, etc.) are skipped so the tree stays clean.
 * Entries are sorted directories first, then by name. Throws when the
 * directory is unreadable / missing.
 */
export async function listDir(dirPath: string, depth = 0): Promise<TreeNode[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const children = depth > 0 ? await _prefetch(path, depth - 1) : null;
      const node: TreeNode = {
        name: entry.name,
        path,
        kind: "dir",
        // Only attach a nested listing when it was actually prefetched (so a
        // failed subdirectory read leaves `children` absent → lazy fetch).
        ...(children ? { children } : {}),
      };
      nodes.push(node);
    } else {
      nodes.push({ name: entry.name, path, kind: "file" });
    }
  }
  nodes.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
  );
  return nodes;
}

/** Recursively list a directory for prefetching, returning `null` (rather than
 *  throwing) when the directory can't be read so the parent listing survives. */
async function _prefetch(dirPath: string, depth: number): Promise<TreeNode[] | null> {
  try {
    return await listDir(dirPath, depth);
  } catch {
    return null;
  }
}
