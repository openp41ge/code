/**
 * workspace-manifest-changes.ts — which workspace file changes windows hear
 * about (`workspace-files:changed`).
 *
 * A workspace file holds its manifest (name, repos, data folder, …) and its
 * layout session (windows, tabs, sidebars), which the workspace's windows save
 * constantly. Only a manifest change is reported: a touched file is read once
 * it settles and compared with the last manifest seen. A half-written file is
 * skipped (its completed write touches it again); a new or deleted file is a
 * change.
 */

import { WORKSPACE_SESSION_FIELDS } from "../../layout/workspace-file.js";

/** The layout session's fields, which are not the manifest. */
const SESSION_FIELDS = new Set(WORKSPACE_SESSION_FIELDS);

/** A workspace file's manifest as a comparable string (key order ignored). */
export function manifestKey(data: Record<string, unknown>): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };
  const manifest = Object.fromEntries(Object.entries(data).filter(([k]) => !SESSION_FIELDS.has(k)));
  return JSON.stringify(sorted(manifest));
}

/** The manifest key of a file's contents; undefined when it is not (yet) JSON. */
function keyOf(raw: string): string | undefined {
  try {
    const data: unknown = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data)
      ? manifestKey(data as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export class WorkspaceManifestChanges {
  /** Each file's last manifest key; null: the file is gone. */
  private readonly _keys = new Map<string, string | null>();
  private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * @param read a file's contents, or null when it does not exist
   * @param notify a file's manifest changed
   * @param settleMs quiet time after the last touch before the file is read
   */
  constructor(
    private readonly _read: (path: string) => string | null,
    private readonly _notify: (path: string) => void,
    private readonly _settleMs: number,
  ) {}

  /** Remember the current manifests of `paths` (so a first touch compares). */
  prime(paths: readonly string[]): void {
    for (const p of paths) {
      const raw = this._read(p);
      const key = raw === null ? null : keyOf(raw);
      if (key !== undefined) this._keys.set(p, key);
    }
  }

  /** The file at `path` was written, created or deleted. */
  touched(path: string): void {
    const pending = this._timers.get(path);
    if (pending) clearTimeout(pending);
    this._timers.set(
      path,
      setTimeout(() => {
        this._timers.delete(path);
        this._check(path);
      }, this._settleMs),
    );
  }

  stop(): void {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }

  private _check(path: string): void {
    const raw = this._read(path);
    const key = raw === null ? null : keyOf(raw);
    if (key === undefined) return; // half-written: its completed write touches it again
    if (this._keys.has(path) ? this._keys.get(path) === key : key === null) return;
    this._keys.set(path, key);
    this._notify(path);
  }
}
