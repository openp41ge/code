/**
 * Minimal type declarations for the Electron preload bridge.
 *
 * The full declarations live in packages/openp41ge/src/renderer/global.d.ts.
 * This file covers only the APIs used by openp41ge-core-filesystem services.
 */

import type { FileEntry, DirSnapshot } from "./types";

interface Openp41geFileAPI {
  readdir(path: string): Promise<FileEntry[]>;
  readTree(path: string, depth: number): Promise<DirSnapshot>;
}

interface Openp41geAPI {
  file: Openp41geFileAPI;
}

export {};

declare global {
  interface Window {
    openp41ge: Openp41geAPI;
  }
}
