/**
 * palette-history-store.ts — what the open palette (Cmd+N) remembers: which
 * tab type each kind was opened in, and which items were opened
 * (`src/shared/open-palette-ranking.ts` has the shape and the math).
 *
 * One store for every window: a JSON file in the app's data folder, written
 * atomically on each pick. A missing or corrupt file reads as empty.
 */

import fs from "fs";
import path from "path";
import {
  emptyPaletteHistory,
  parsePaletteHistory,
  recordPick,
  type PaletteHistory,
  type PalettePick,
} from "../../shared/open-palette-ranking.js";

export interface PaletteHistoryStore {
  read(): PaletteHistory;
  /** Remember `pick` at `now`; returns the history after it. */
  record(pick: PalettePick, now: number): PaletteHistory;
}

/** The file's name in the app's data folder. */
export const PALETTE_HISTORY_FILE = "open-palette.json";

export class FilePaletteHistoryStore implements PaletteHistoryStore {
  private _cache: PaletteHistory | null = null;

  constructor(private readonly _file: string) {}

  read(): PaletteHistory {
    if (!this._cache) {
      try {
        this._cache = parsePaletteHistory(JSON.parse(fs.readFileSync(this._file, "utf-8")));
      } catch {
        this._cache = emptyPaletteHistory();
      }
    }
    return this._cache;
  }

  record(pick: PalettePick, now: number): PaletteHistory {
    const next = recordPick(this.read(), pick, now);
    this._cache = next;
    fs.mkdirSync(path.dirname(this._file), { recursive: true });
    const tmp = `${this._file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next), "utf-8");
    fs.renameSync(tmp, this._file);
    return next;
  }
}
