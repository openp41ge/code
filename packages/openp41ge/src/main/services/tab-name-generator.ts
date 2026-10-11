/**
 * Generates sequential workset names: "Workset", "Workset I", "Workset II", etc.
 *
 * The first workset is simply "Workset", subsequent ones are numbered using
 * Roman numerals starting at I.
 */

function toRoman(n: number): string {
  const vals: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let result = "";
  for (const [val, sym] of vals) {
    while (n >= val) {
      result += sym;
      n -= val;
    }
  }
  return result;
}

let nextNumber = 2;

export class TabNameGenerator {
  private _next = 2;

  /** Get the next workset name. */
  next(): string {
    const n = nextNumber++;
    this._next = n;
    return `Workset ${toRoman(n)}`;
  }

  /** Reset the counter (e.g., for testing). */
  reset(): void {
    nextNumber = 2;
    this._next = 2;
  }
}
