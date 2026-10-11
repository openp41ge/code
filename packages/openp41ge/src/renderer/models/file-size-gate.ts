/**
 * FileSizeGate — pure decision logic for the editor's open-size limit.
 *
 * The VSCode-style guard: a file larger than `editor.maxFileSize` opens its tab
 * with a "file is too large to open in the editor" message instead of loading
 * content. Kept as a pure, dependency-free module so the threshold behaviour is
 * unit-testable without IPC, DOM, or the app services.
 */

/** Fallback limit when config isn't loaded yet — mirrors main DEFAULT_MAX_FILE_SIZE. */
export const DEFAULT_EDITOR_MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * May a file of `sizeBytes` be opened under `limitBytes`?
 *
 * - `null`/`undefined` size (stat unavailable) => allowed; the load/error path
 *   handles a missing file.
 * - `null`/`undefined` limit => falls back to the 50 MB default.
 * - Equal to the limit is allowed (VSCode semantics: size > maxFileSize blocks).
 */
export function shouldOpenFile(
  sizeBytes: number | null | undefined,
  limitBytes: number | null | undefined,
): boolean {
  if (sizeBytes == null) return true;
  const limit = limitBytes ?? DEFAULT_EDITOR_MAX_FILE_SIZE;
  return sizeBytes <= limit;
}
