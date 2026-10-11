/**
 * Welcome-dismissal IPC — a marker file in the app-data directory.
 *
 * When `~/.openp41ge` (release) or `~/.openp41ge-dev` (dev) contains the
 * marker file, the manager window does not show (or open) the Welcome tab.
 * The user creates/removes the marker by toggling the "never show the
 * welcome message again" control on the first welcome page.
 */

import { ipcMain } from "electron";
import fs from "fs";
import path from "path";

/** Marker file name, resolved under the app-data root. */
const WELCOME_DISMISSED_FILE = ".welcome-dismissed";

export function registerWelcomeHandlers(openp41geDir: string, isDev: boolean): void {
  const marker = path.join(openp41geDir, WELCOME_DISMISSED_FILE);

  ipcMain.handle("welcome:is-dismissed", () => {
    // The "never show again" dismissal is only honored in packaged (production)
    // builds. Dev builds always show the welcome intro so it can't be hidden
    // while iterating.
    if (isDev) return false;
    return fs.existsSync(marker);
  });

  ipcMain.handle("welcome:set-dismissed", (_event, dismissed: boolean) => {
    if (isDev) return false;
    if (dismissed) {
      fs.mkdirSync(openp41geDir, { recursive: true });
      fs.writeFileSync(marker, "", "utf8");
    } else {
      try {
        fs.rmSync(marker, { force: true });
      } catch {
        // Best-effort: the file may already be gone.
      }
    }
    return fs.existsSync(marker);
  });
}
