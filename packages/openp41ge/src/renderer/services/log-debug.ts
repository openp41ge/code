/**
 * Log debug-session determination.
 *
 * `isDebugSeed()` decides whether a debug session should be seeded at launch:
 * build-time `OPENP41GE_DEBUG=1` (defined as `__OPENP41GE_DEBUG__`) or the
 * runtime `localStorage["openp41ge-debug"] === "1"` override.
 */

/** Build-time debug flag — replaced by vite.config `define` from OPENP41GE_DEBUG. */
declare const __OPENP41GE_DEBUG__: boolean;

/** True when a debug session should be seeded at launch. */
export function isDebugSeed(): boolean {
  let builtIn = false;
  try {
    builtIn = typeof __OPENP41GE_DEBUG__ !== "undefined" ? !!__OPENP41GE_DEBUG__ : false;
  } catch {
    builtIn = false;
  }
  if (builtIn) return true;
  try {
    return localStorage.getItem("openp41ge-debug") === "1";
  } catch {
    return false;
  }
}
