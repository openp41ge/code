/**
 * App-data directory resolution — the single source of truth for where
 * openp41ge stores its user data on disk.
 *
 * The folder name depends on whether the app is running as a packaged release
 * (`~/.openp41ge-code`) or as a dev build (`~/.openp41ge-code-dev`), so a dev
 * build and a released build can run side by side without sharing data. (The
 * folders were `~/.openp41ge` and `~/.openp41ge-dev`; `storage-rename.ts`
 * moves them.)
 *
 * Precedence (highest first):
 *   1. `OPENP41GE_DIR`       — explicit user/script override (Chromium's
 *                               profile then lives inside it too).
 *   2. `~/.openp41ge-code`      — packaged release (app.isPackaged === true).
 *   3. `~/.openp41ge-code-dev`  — dev build (app.isPackaged === false).
 */

import os from "os";
import path from "path";

export const APP_DATA_DIR_PRODUCTION = ".openp41ge-code";
export const APP_DATA_DIR_DEV = ".openp41ge-code-dev";

/** Folder name under the home directory, by packaged state. */
export function appDataDirName(isPackaged: boolean): string {
  return isPackaged ? APP_DATA_DIR_PRODUCTION : APP_DATA_DIR_DEV;
}

/**
 * Chromium's profile folder (Electron's `userData`: localStorage, caches)
 * under the OS app-data folder, by packaged state: the app's name, and for a
 * dev build its development name. Chromium locks its storage in this folder,
 * so if both used one folder the second app to start would wait seconds on
 * its first localStorage access.
 */
export function chromiumProfileDirName(isPackaged: boolean): string {
  return isPackaged ? "openp41ge code" : "openp41ge code development";
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

/**
 * Absolute Chromium profile folder: with an `OPENP41GE_DIR` override it is
 * inside that folder (so a run on a throwaway folder shares nothing with the
 * user's apps), otherwise `chromiumProfileDirName` under the OS app-data
 * folder (`appData`, Electron's `app.getPath("appData")`).
 */
export function resolveChromiumProfileDir(isPackaged: boolean, appData: string): string {
  const override = process.env.OPENP41GE_DIR;
  if (override) return path.join(override, "chromium-profile");
  return path.join(appData, chromiumProfileDirName(isPackaged));
}

/** Chromium's crash reports folder: inside its profile folder (`profileDir`). */
export function crashReportsDir(profileDir: string): string {
  return path.join(profileDir, "Crashpad");
}
