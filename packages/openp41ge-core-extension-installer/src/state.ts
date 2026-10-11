/**
 * state.ts — the installer's persisted state, stored next to the install root
 * (default `~/.openp41ge/extensions/state.json`).
 *
 * Owns the `installed` map (per-id version/source/sha256).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface InstalledEntry {
  readonly version: string;
  readonly source: string;
  readonly installedAt: string;
  readonly sha256?: string;
}

export interface ExtensionState {
  /** Mutable working copy that is serialized on write. */
  installed: Record<string, InstalledEntry>;
}

const DEFAULT_STATE = (): ExtensionState => ({ installed: {} });

/** Read state; returns an empty/default state when missing or corrupt. */
export async function readState(stateFile: string): Promise<ExtensionState> {
  try {
    const raw: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    const obj = (raw ?? {}) as Record<string, unknown>;
    return {
      installed:
        obj.installed && typeof obj.installed === "object"
          ? (obj.installed as Record<string, InstalledEntry>)
          : {},
    };
  } catch {
    return DEFAULT_STATE();
  }
}

export async function writeState(stateFile: string, state: ExtensionState): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}
