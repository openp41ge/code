/**
 * File-related model types for the worktree explorer.
 *
 * These models represent files and directories within a worktree,
 * abstracting over whether the source is a real filesystem or
 * in-memory test data.
 */

export type FileStatus = "tracked" | "untracked" | "modified" | "staged" | "gitignored";

export interface FileEntryModel {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly modifiedAt: number;
  readonly gitStatus: FileStatus;
}

export interface FileContentModel {
  readRange(offset: number, length: number): Promise<{ data: string; totalSize: number }>;
  readChunked(
    chunkSize: number,
    onProgress: (progress: { loaded: number; total: number; chunk: string }) => void,
  ): Promise<{ data: string; totalSize: number }>;
}
