/**
 * extract.ts — safe tar.gz extraction.
 *
 * The asset format is a self-contained `.tgz` whose contents sit under one
 * top-level directory (e.g. `package/`); `strip: 1` drops that so the extension
 * files land directly in `<installDir>/<id>/`.
 *
 * Path-traversal guard: entries with an absolute path or any `..` segment are
 * excluded (defence in depth on top of tar's own behaviour).
 */

import { mkdir } from "node:fs/promises";
import * as tar from "tar";

export interface ExtractOptions {
  /** Number of leading path components to strip. Default 1. */
  readonly strip?: number;
  /** Optional extra filter on entry paths. */
  readonly filter?: (path: string) => boolean;
}

export function isUnsafeEntryPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("/")) return true;
  return norm.split("/").some((seg) => seg === "..");
}

export async function extractTgz(
  tgzPath: string,
  destDir: string,
  options: ExtractOptions = {},
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const inner = (path: string) => !isUnsafeEntryPath(path) && (options.filter?.(path) ?? true);
  await tar.x({ file: tgzPath, cwd: destDir, strip: options.strip ?? 1, filter: inner });
}
