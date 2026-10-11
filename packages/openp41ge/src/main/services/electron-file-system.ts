import fs from "fs";
import path from "path";
import { createLogger } from "openp41ge-core-logger";
import type {
  IFileSystemService,
  FileEntryInfo,
  ChunkedReadResult,
} from "../interfaces/file-system-service.js";
import type { DirSnapshot } from "openp41ge-core-filesystem";

const log = createLogger("openp41ge", "electron-file-system");

/**
 * Electron main-process file system service.
 *
 * Wraps Node.js fs operations with proper error handling.
 * All paths should be absolute.
 */
export class ElectronFileSystem implements IFileSystemService {
  async readdir(dirPath: string): Promise<FileEntryInfo[]> {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) return [];

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const result: FileEntryInfo[] = [];

    for (const entry of entries) {
      const fullPath = path.join(resolved, entry.name);
      let size = 0;
      let modifiedAt = 0;
      try {
        const stat = fs.statSync(fullPath);
        size = entry.isFile() ? stat.size : 0;
        modifiedAt = stat.mtimeMs;
      } catch (err) {
        // Permission denied or broken symlink — skip
        log.debug("readdir stat failed; skipping entry:", fullPath, err);
        continue;
      }
      result.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size,
        modifiedAt,
      });
    }

    // Sort: directories first, then by name (case-insensitive)
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return result;
  }

  /**
   * Read a directory and its subdirectory listings down to `depth` levels,
   * returning a nested snapshot so the renderer can open the next levels
   * without a round trip. Depth 0 returns just the immediate children.
   */
  async readTree(dirPath: string, depth: number): Promise<DirSnapshot> {
    const resolved = path.resolve(dirPath);
    const entries = await this.readdir(resolved);
    const children: DirSnapshot[] = [];
    if (depth > 0) {
      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        try {
          children.push(await this.readTree(entry.path, depth - 1));
        } catch (err) {
          // Unreadable subdirectory — skip it; the next level loads on demand.
          log.debug("readTree unreadable subdirectory; skipping:", entry.path, err);
        }
      }
    }
    return { path: resolved, entries, children };
  }

  async stat(filePath: string): Promise<FileEntryInfo | null> {
    try {
      const resolved = path.resolve(filePath);
      const stat = fs.statSync(resolved);
      return {
        name: path.basename(resolved),
        path: resolved,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      };
    } catch (err) {
      log.debug("stat failed:", filePath, err);
      return null;
    }
  }

  async readRange(
    filePath: string,
    offset: number,
    length: number,
  ): Promise<{ data: string; totalSize: number }> {
    try {
      const resolved = path.resolve(filePath);
      const fd = await fs.promises.open(resolved, "r");
      try {
        const stats = await fd.stat();
        const totalSize = stats.size;
        const buf = Buffer.alloc(Math.min(length, Math.max(0, totalSize - offset)));
        const { bytesRead } = await fd.read(buf, 0, buf.length, offset);
        const data = buf.toString("utf-8", 0, bytesRead);
        return { data, totalSize };
      } finally {
        // Always release the descriptor — even if a read/stat threw
        // (e.g. EISDIR when handed a directory). An unclosed handle is
        // only closed by GC, leaking the fd and spamming Node with
        // "Closing file descriptor N on garbage collection".
        await fd.close();
      }
    } catch (err) {
      log.warn("readRange failed:", filePath, err);
      return { data: "", totalSize: 0 };
    }
  }

  async readChunked(
    filePath: string,
    chunkSize: number,
    onProgress: (progress: { loaded: number; total: number; chunk: string }) => void,
  ): Promise<ChunkedReadResult> {
    try {
      const resolved = path.resolve(filePath);
      const fd = await fs.promises.open(resolved, "r");
      try {
        const stats = await fd.stat();
        const totalSize = stats.size;
        let offset = 0;
        const chunks: string[] = [];

        while (offset < totalSize) {
          const toRead = Math.min(chunkSize, totalSize - offset);
          const buf = Buffer.alloc(toRead);
          const { bytesRead } = await fd.read(buf, 0, toRead, offset);
          if (bytesRead === 0) break;
          const chunkStr = buf.toString("utf-8", 0, bytesRead);
          chunks.push(chunkStr);
          offset += bytesRead;
          onProgress({ loaded: offset, total: totalSize, chunk: chunkStr });
          // Yield to the event loop every 4 chunks
          if (chunks.length % 4 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }
        return { data: chunks.join(""), totalSize };
      } finally {
        // Always release the descriptor, even on mid-read errors.
        await fd.close();
      }
    } catch (err) {
      log.warn("readChunked failed:", filePath, err);
      return { data: "", totalSize: 0 };
    }
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean }> {
    try {
      const resolved = path.resolve(filePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, "utf-8");
      return { success: true };
    } catch (err) {
      log.error("writeFile failed:", filePath, err);
      return { success: false };
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      return fs.existsSync(path.resolve(filePath));
    } catch (err) {
      log.debug("exists check failed:", filePath, err);
      return false;
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    fs.mkdirSync(path.resolve(dirPath), { recursive: true });
  }

  async remove(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: false });
    }
  }

  async removeRecursive(dirPath: string): Promise<void> {
    const resolved = path.resolve(dirPath);
    if (fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}
