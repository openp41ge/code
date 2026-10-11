/**
 * discovery.ts — find installed extensions on disk.
 *
 * Each discovery directory (global `~/.openp41ge/extensions`, per-workspace
 * `.openp41ge/extensions`) is scanned for immediate subdirectories; a subdir
 * that contains a valid `package.json` manifest is treated as an installed
 * extension. Hidden dirs and unreadable/non-extension dirs are skipped.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { parseExtensionManifest, type ExtensionManifest } from "openp41ge-sdk";

/** An extension found on disk, ready to load. */
export interface DiscoveredExtension {
  readonly manifest: ExtensionManifest;
  /** Absolute directory containing the extension. */
  readonly root: string;
  /** Absolute path to the bundled entry module. */
  readonly entryPath: string;
}

async function scanDir(dir: string): Promise<DiscoveredExtension[]> {
  if (!existsSync(dir)) return [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: DiscoveredExtension[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const root = join(dir, entry.name);
    const discovered = await readManifest(root);
    if (discovered) results.push(discovered);
  }
  return results;
}

async function readManifest(root: string): Promise<DiscoveredExtension | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const manifest = parseExtensionManifest(raw);
    return {
      manifest,
      root,
      entryPath: join(root, manifest.openp41ge.entry),
    };
  } catch {
    // Not a valid extension manifest (or unreadable) — skip silently; the
    // host reports/discovery logging handles diagnostics.
    return null;
  }
}

/** Discover all installed extensions across the given directories. */
export async function discoverExtensions(
  dirs: readonly string[],
): Promise<DiscoveredExtension[]> {
  const results: DiscoveredExtension[] = [];
  for (const dir of dirs) {
    results.push(...(await scanDir(dir)));
  }
  return results;
}
