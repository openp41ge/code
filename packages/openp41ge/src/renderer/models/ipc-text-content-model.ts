/**
 * IpcTextContentModel — production TextContentModel that reads/writes files
 * via the Electron IPC bridge (window.openp41ge.file).
 *
 * This is created by the openp41ge platform's model registry and shared across
 * all tabs viewing the same file path.
 *
 * The model uses PieceTreeTextContentModel (from openp41ge-file-editor) as its
 * backing data structure, with file I/O provided by the Electron IPC bridge.
 */

import { PieceTreeTextContentModel } from "openp41ge-sdk-uikit/file-editor";

/**
 * Detect the line ending sequence from file content.
 */
function detectEOL(content: string): "\n" | "\r\n" {
  if (content.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

/**
 * Create a PieceTreeTextContentModel for the given file path.
 *
 * Reads the full file content via window.openp41ge.file.readRange() and
 * configures writeFile for persistence on save.
 *
 * @param filePath - The absolute file path on disk.
 * @returns A fully initialized PieceTreeTextContentModel.
 */
export async function createIpcTextContentModel(
  filePath: string,
): Promise<PieceTreeTextContentModel> {
  // Read the full file content
  const readResult = await window.openp41ge.file.readRange(filePath, 0, Number.MAX_SAFE_INTEGER);

  const eol = detectEOL(readResult.data);

  const model = new PieceTreeTextContentModel(filePath, readResult.data, {
    eol,
    fileReader: {
      readRange: (path: string, offset: number, length: number) =>
        window.openp41ge.file.readRange(path, offset, length),
      writeFile: (path: string, content: string) => window.openp41ge.file.writeFile(path, content),
    },
  });

  return model;
}
