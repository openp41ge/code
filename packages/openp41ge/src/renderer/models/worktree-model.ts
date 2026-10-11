import type { FileEntryModel, FileContentModel, FileStatus } from "./file-model.js";

/**
 * WorktreeModel represents a checked-out branch (worktree) in a repository.
 *
 * Provides access to the file tree of a specific branch and git status
 * operations for individual files.
 */
export interface WorktreeModel {
  readonly branch: string;
  readonly path: string;
  readonly exists: boolean;

  /** Read the directory/file tree rooted at this worktree. */
  readTree(dirPath?: string): Promise<FileEntryModel[]>;

  /** Open a file by path, returning a content model for reading. */
  readFile(filePath: string): Promise<FileContentModel>;

  /** Get git status for a file (untracked, modified, staged, etc.). */
  getFileStatus(filePath: string): Promise<FileStatus>;

  /** Stage (git add) a file. */
  stageFile(filePath: string): Promise<void>;
}
