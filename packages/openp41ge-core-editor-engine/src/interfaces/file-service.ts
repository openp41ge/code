export interface FileReadResult {
  /** Full text content of the file. */
  data: string;
  /** Total file size in bytes. */
  totalSize: number;
}

/** Reads file content from disk. */
export interface IFileReader {
  readFile(path: string): Promise<FileReadResult>;
}

/** Writes file content to disk. */
export interface IFileWriter {
  writeFile(path: string, content: string): Promise<boolean>;
}
