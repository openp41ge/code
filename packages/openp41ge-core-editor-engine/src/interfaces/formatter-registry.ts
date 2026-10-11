/**
 * Formats file content before writing to disk.
 */
export interface IFormatter {
  readonly name: string;
  format(content: string): string;
}

/**
 * Maps file extensions to formatters.
 * Extensions are stored without the leading dot.
 */
export interface IFormatterRegistry {
  register(extensions: string[], formatter: IFormatter): void;
  get(extension: string): IFormatter | null;
}
