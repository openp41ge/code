/**
 * Shared formatting utilities.
 */

/** Strip trailing whitespace from each line. */
export function stripTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+$/gm, "");
}

/** Ensure the text ends with exactly one newline. */
export function ensureFinalNewline(text: string): string {
  const trimmed = text.replace(/\n*$/, "");
  return trimmed + "\n";
}

/** Normalize line endings to LF. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Count leading whitespace on a line. */
export function leadingWhitespace(line: string): number {
  return line.search(/\S|$/);
}

/** Detect whether the document uses tabs for indentation. */
export function usesTabs(text: string): boolean {
  return text.split("\n").some((line) => {
    const first = line.match(/^(\s*)\S/);
    return first && first[1].startsWith("\t");
  });
}
