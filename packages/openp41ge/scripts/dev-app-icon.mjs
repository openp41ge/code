// Gives the dev build its under-construction icon (build/icon-dev.icns).
//
// Dev builds run Electron's own Electron.app from node_modules, so the icon
// goes into that bundle (Contents/Resources/electron.icns). macOS draws a
// bundle's icon with the system's icon treatment (the glass edge), which an
// icon set at runtime with app.dock.setIcon does not get.
//
// Run before `electron .` in dev. A no-op off macOS, and when the bundle
// already has the dev icon.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/**
 * Put `icnsPath` into the app bundle at `appPath` as its icon. The bundle's
 * files may be hardlinks into the package store, which other projects share,
 * so the old icon is unlinked and a new file written, never written through.
 * Returns whether the icon changed.
 */
export function installDevIcon(appPath, icnsPath) {
  const target = path.join(appPath, "Contents/Resources/electron.icns");
  const icns = fs.readFileSync(icnsPath);
  if (fs.existsSync(target) && fs.readFileSync(target).equals(icns)) return false;
  fs.rmSync(target, { force: true });
  fs.writeFileSync(target, icns);
  return true;
}

function main() {
  if (process.platform !== "darwin") return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // `require("electron")` from Node is the path to the Electron binary,
  // <bundle>/Contents/MacOS/Electron.
  const binary = createRequire(import.meta.url)("electron");
  const appPath = path.resolve(binary, "../../..");
  if (!installDevIcon(appPath, path.join(here, "../build/icon-dev.icns"))) return;
  // Have Launch Services and the Dock pick up the new icon. The bundle is not
  // re-signed: that would rewrite the Electron binary (possibly a store
  // hardlink), and a changed resource does not stop a local, unquarantined
  // app from launching.
  fs.utimesSync(appPath, new Date(), new Date());
  try {
    execFileSync(LSREGISTER, ["-f", appPath], { stdio: "ignore" });
  } catch {
    // Launch Services picks the icon up on its own, later.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
