/**
 * App-data directory resolution — the single source of truth for where
 * openp41ge stores its user data on disk.
 *
 * The folder name depends on whether the app is running as a packaged release
 * (`~/.openp41ge`) or as a dev build (`~/.openp41ge-dev`), so a dev build and a
 * released build can run side by side without sharing data.
 *
 * Precedence (highest first):
 *   1. `OPENP41GE_DIR`       — explicit user/script override.
 *   2. `~/.openp41ge`        — packaged release (app.isPackaged === true).
 *   3. `~/.openp41ge-dev`    — dev build (app.isPackaged === false).
 */

import os from "os";
import path from "path";

export const APP_DATA_DIR_PRODUCTION = ".openp41ge";
export const APP_DATA_DIR_DEV = ".openp41ge-dev";

/** Folder name under the home directory, by packaged state. */
export function appDataDirName(isPackaged: boolean): string {
  return isPackaged ? APP_DATA_DIR_PRODUCTION : APP_DATA_DIR_DEV;
}

/**
 * Absolute app-data root: the environment override first, otherwise the
 * packaged-based default under the user's home directory.
 */
export function resolveAppDataDir(isPackaged: boolean): string {
  const override = process.env.OPENP41GE_DIR;
  if (override) return override;
  return path.join(os.homedir(), appDataDirName(isPackaged));
}
