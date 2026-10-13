/**
 * Chromium's storage: the app's name, its profile folder (Electron's
 * `userData`) and its crash reports folder (`crashDumps`, kept inside the
 * profile). Set first thing in the main process: Sentry's native crash
 * reporting fixes the crash reports folder when it starts, and before this
 * Electron's defaults name both after the package ("openp41ge").
 */

import { app } from "electron";
import path from "path";
import { crashReportsDir, resolveChromiumProfileDir } from "../src/main/services/app-data-dir.js";
import { StorageMove, legacyChromiumProfileDirName } from "../src/main/services/storage-rename.js";

export function initChromiumStorage(): void {
  app.setName("openp41ge code");
  // Chromium's profile from before the rename moves to the new name first
  // (not with an `OPENP41GE_DIR` override: the profile is inside it then).
  const appData = app.getPath("appData");
  const profile = resolveChromiumProfileDir(app.isPackaged, appData);
  const dir = process.env.OPENP41GE_DIR
    ? profile
    : new StorageMove().moveFolder(
        path.join(appData, legacyChromiumProfileDirName(app.isPackaged)),
        profile,
      );
  app.setPath("userData", dir);
  app.setPath("crashDumps", crashReportsDir(dir));
}
