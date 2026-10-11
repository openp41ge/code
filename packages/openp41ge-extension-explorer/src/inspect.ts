/**
 * inspect.ts — file-open gate for the Explorer extension.
 *
 * Pure filesystem logic (no Electron, no shared platform code). The Explorer
 * owns the *decision* of whether a file can be opened in the editor (the
 * host's `<file-editor>` package renders it), keeping the payloads flowing
 * to the renderer lean and safe: paths are confined to a workspace root and
 * large / binary files are refused before the host opens an editor tab.
 */

import { open, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

/** Largest file the Explorer will hand to the editor (5 MiB). */
export const MAX_OPEN_FILE_BYTES = 5 * 1024 * 1024;
/** How many bytes to sample for binary detection. */
const BINARY_SAMPLE_BYTES = 8192;

/** Result envelope returned by the `explorer/open-file` handler. */
export interface OpenFileResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly name?: string;
  readonly error?: string;
}

/** True when `filePath` is `root` itself or lives beneath it. */
export function isWithinRoot(filePath: string, root: string): boolean {
  const f = resolve(filePath);
  const r = resolve(root);
  return f === r || f.startsWith(r + sep);
}

/** True when a buffer looks like binary data (contains a NUL byte). */
export function looksBinary(buffer: Uint8Array): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Decide whether `filePath` (inside `root`) is openable in the file editor.
 * Confines the path to the workspace root, rejects non-files, oversize files,
 * and binary files. Never throws — resolves to an `OpenFileResult`.
 */
export async function inspectFile(
  filePath: string,
  root: string,
): Promise<OpenFileResult> {
  if (!isWithinRoot(filePath, root)) {
    return { ok: false, error: "File is outside the workspace root" };
  }
  let size: number;
  try {
    const st = await stat(filePath);
    size = st.size;
    if (!st.isFile()) {
      return { ok: false, error: "Not a regular file" };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (size > MAX_OPEN_FILE_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `File is too large to open (${mb} MiB)` };
  }

  if (size > 0) {
    const handle = await open(filePath, "r");
    try {
      const chunk = new Uint8Array(Math.min(size, BINARY_SAMPLE_BYTES));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, 0);
      if (looksBinary(chunk.subarray(0, bytesRead))) {
        return { ok: false, error: "File appears to be binary" };
      }
    } finally {
      await handle.close();
    }
  }

  return { ok: true, path: filePath, name: basename(filePath) };
}
