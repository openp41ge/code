/**
 * palette-file-create.ts — the open palette's "New file" / "New folder":
 * created only inside one of the workspace's worktrees (never a worktree
 * itself), with missing parent folders, never over something that exists.
 */

import fs from "fs/promises";
import path from "path";

export type CreateResult =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string };

/** Create an empty file or a folder at `target`, which must be inside one of `roots`. */
export async function createInRoots(
  roots: readonly string[],
  target: string,
  what: "file" | "folder",
): Promise<CreateResult> {
  const resolved = path.resolve(target);
  const inside = roots.some((root) => {
    const rel = path.relative(path.resolve(root), resolved);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  if (!inside) return { ok: false, error: `${target} is not inside a worktree of the workspace` };
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    if (what === "folder") await fs.mkdir(resolved);
    else await fs.writeFile(resolved, "", { flag: "wx" });
    return { ok: true, path: resolved };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, error: `${resolved} already exists` };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
