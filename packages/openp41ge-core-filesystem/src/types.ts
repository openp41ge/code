/**
 * Types used by the filesystem service layer.
 *
 * Pure data — no platform dependencies. The host app maps its domain
 * model to these types.
 */

export interface WorktreeData {
  branch: string;
  path: string;
  exists: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

/**
 * A directory listing expanded to a fixed depth, produced by the main process
 * so the renderer can open the next levels without a round trip.
 *
 * `children` holds each immediate subdirectory's own `DirSnapshot`, recursed
 * down to the requested depth (the root snapshot's `entries` are the requested
 * directory's immediate children).
 */
export interface DirSnapshot {
  /** Absolute path of this directory. */
  path: string;
  /** Immediate children of `path`. */
  entries: FileEntry[];
  /** Subdirectory snapshots, one level deeper than this node. */
  children: DirSnapshot[];
}
