/**
 * Workspace launch-arg parsing (main process).
 *
 * Future CLI seam: opening the app with a workspace provided as a launch
 * argument will make startup load/activate that workspace instead of starting
 * fresh. Today nothing sets it, but the gate that decides whether to restore
 * persisted layout lives behind this function. The exact argument contract
 * (name/format) should be finalised when the CLI feature is planned — keep any
 * changes isolated to this file.
 */

/**
 * Return the workspace path supplied as a `--workspace <path>` launch argument,
 * or `null` when none was provided (or the value is missing / looks like a flag).
 */
export function parseWorkspaceLaunchArg(argv: string[]): string | null {
  const idx = argv.indexOf("--workspace");
  if (idx < 0) return null;
  const value = argv[idx + 1];
  if (!value || value.startsWith("-")) return null;
  return value;
}
