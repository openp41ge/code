/**
 * StringBuffer — a contiguous block of text with pre-computed line starts.
 *
 * Line starts are stored as offsets into the buffer string. They enable
 * O(1) line content access and O(log n) offset-to-position conversion
 * within the buffer.
 */

import { CharCode } from "./char-code";

/**
 * A typed array representation of line start offsets.
 * Uses Uint32Array for files >65536 chars, Uint16Array for smaller files.
 */
export type LineStarts = Uint32Array | Uint16Array | number[];

/**
 * Create an array of line start offsets for a given string.
 * Returns a compact typed array (Uint16Array or Uint32Array depending on size).
 */
export function createLineStartsFast(str: string): LineStarts {
  const r: number[] = [0];
  let rLength = 1;

  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    if (chr === CharCode.CarriageReturn) {
      if (i + 1 < len && str.charCodeAt(i + 1) === CharCode.LineFeed) {
        r[rLength++] = i + 2;
        i++;
      } else {
        r[rLength++] = i + 1;
      }
    } else if (chr === CharCode.LineFeed) {
      r[rLength++] = i + 1;
    }
  }

  return toCompactArray(r);
}

function toCompactArray(arr: number[]): Uint32Array | Uint16Array | number[] {
  if (arr.length === 0) return arr;
  const max = arr[arr.length - 1];
  if (max < 65536) {
    const r = new Uint16Array(arr.length);
    r.set(arr, 0);
    return r;
  }
  const r = new Uint32Array(arr.length);
  r.set(arr, 0);
  return r;
}

export class StringBuffer {
  constructor(
    /** The actual text content. */
    readonly buffer: string,
    /** Pre-computed offsets of each line start. lineStarts[0] = 0 always. */
    readonly lineStarts: LineStarts,
  ) {}

  /** Number of lines in this buffer. */
  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Total character length of the buffer. */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Get the text content of a specific line (0-based).
   * Returns empty string for out-of-range line numbers.
   */
  getLineContent(lineIndex: number): string {
    if (lineIndex < 0 || lineIndex >= this.lineStarts.length) return "";
    const start = this.lineStarts[lineIndex] as number;
    const end =
      lineIndex + 1 < this.lineStarts.length
        ? (this.lineStarts[lineIndex + 1] as number)
        : this.buffer.length;

    // Exclude the line ending character(s)
    let actualEnd = end;
    if (actualEnd > start) {
      const lastChar = this.buffer.charCodeAt(actualEnd - 1);
      if (lastChar === CharCode.LineFeed) {
        actualEnd--;
        if (
          actualEnd > start &&
          this.buffer.charCodeAt(actualEnd - 1) === CharCode.CarriageReturn
        ) {
          actualEnd--;
        }
      } else if (lastChar === CharCode.CarriageReturn) {
        actualEnd--;
      }
    }
    return this.buffer.substring(start, actualEnd);
  }

  /**
   * Get a substring from the buffer.
   */
  getText(start: number, end: number): string {
    return this.buffer.substring(start, end);
  }

  /**
   * Get a single character at the given offset.
   */
  getCharCode(offset: number): number {
    if (offset < 0 || offset >= this.buffer.length) return 0;
    return this.buffer.charCodeAt(offset);
  }
}
