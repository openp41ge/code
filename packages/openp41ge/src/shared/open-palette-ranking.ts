/**
 * open-palette-ranking.ts — how the open palette (Cmd+N) ranks what it finds.
 *
 * Pure functions, shared by the renderer (ranking) and the main process (the
 * history store); `now` is always passed in.
 *
 * Every pick is remembered twice: the tab type it opened in, under the item's
 * kind (so a kind's default tab type is the one picked most, and most
 * recently), and the item itself. A remembered score halves every
 * `HALF_LIFE_MS`, so a habit that stopped weeks ago stops winning, and the
 * latest pick is boosted heavily (`RECENT_BOOST`, itself halving every
 * `RECENT_HALF_LIFE_MS`), so what was just used comes first.
 */

/** A remembered score as of `at` (ms since the epoch). */
export interface Usage {
  readonly score: number;
  readonly at: number;
}

/** A remembered item: its use, and what it was (to show it again). */
export interface RememberedItem extends Usage {
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Everything the palette remembers. */
export interface PaletteHistory {
  /** kind → tab type → use. A tab type offered on its own uses the kind `""`. */
  readonly tabTypes: Readonly<Record<string, Readonly<Record<string, Usage>>>>;
  /** item key → use. */
  readonly items: Readonly<Record<string, RememberedItem>>;
}

/** One pick: the item's kind and key, and the tab type it opened in. */
export interface PalettePick {
  readonly kind: string;
  readonly tabType: string;
  readonly item: string;
  /** What the item was (its title, params…), kept with its use. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const RECENT_BOOST = 50;
export const RECENT_HALF_LIFE_MS = 30 * 60 * 1000;
export const MAX_REMEMBERED_ITEMS = 500;

export function emptyPaletteHistory(): PaletteHistory {
  return { tabTypes: {}, items: {} };
}

function decayed(u: Usage, now: number): number {
  return u.score * 2 ** (-Math.max(0, now - u.at) / HALF_LIFE_MS);
}

/** The use after one more pick at `now`. */
export function recordUse(prev: Usage | undefined, now: number): Usage {
  return { score: (prev ? decayed(prev, now) : 0) + 1, at: now };
}

/** How much a use counts at `now`: decayed, times the recency boost. */
export function frecency(u: Usage | undefined, now: number): number {
  if (!u) return 0;
  const age = Math.max(0, now - u.at);
  return decayed(u, now) * (1 + RECENT_BOOST * 2 ** (-age / RECENT_HALF_LIFE_MS));
}

/** `candidates` (in registration order) by descending frecency; ties keep their order. */
export function orderTabTypes(
  candidates: readonly string[],
  usage: Readonly<Record<string, Usage>> | undefined,
  now: number,
): string[] {
  return candidates
    .map((t, i) => ({ t, i, f: frecency(usage?.[t], now) }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
    .map((x) => x.t);
}

/** The history after `pick` at `now` (a new object; `history` is unchanged). */
export function recordPick(
  history: PaletteHistory,
  pick: PalettePick,
  now: number,
): PaletteHistory {
  const forKind = history.tabTypes[pick.kind] ?? {};
  const tabTypes = {
    ...history.tabTypes,
    [pick.kind]: { ...forKind, [pick.tabType]: recordUse(forKind[pick.tabType], now) },
  };
  const prev = history.items[pick.item];
  const details = pick.details ?? prev?.details;
  let items: Record<string, RememberedItem> = {
    ...history.items,
    [pick.item]: { ...recordUse(prev, now), ...(details ? { details } : {}) },
  };
  const keys = Object.keys(items);
  if (keys.length > MAX_REMEMBERED_ITEMS) {
    const keep = keys
      .sort((a, b) => frecency(items[b], now) - frecency(items[a], now))
      .slice(0, MAX_REMEMBERED_ITEMS);
    items = Object.fromEntries(keep.map((k) => [k, items[k]]));
  }
  return { tabTypes, items };
}

/** A palette history read from disk, or an empty one when it is not one. */
export function parsePaletteHistory(value: unknown): PaletteHistory {
  const isUsage = (u: unknown): u is Usage =>
    typeof u === "object" &&
    u !== null &&
    Number.isFinite((u as Usage).score) &&
    Number.isFinite((u as Usage).at);
  const usages = (o: unknown): Record<string, Usage> =>
    typeof o === "object" && o !== null
      ? Object.fromEntries(
          Object.entries(o)
            .filter(([, u]) => isUsage(u))
            .map(([k, u]) => [k, { score: u.score, at: u.at }]),
        )
      : {};
  const remembered = (o: unknown): Record<string, RememberedItem> =>
    typeof o === "object" && o !== null
      ? Object.fromEntries(
          Object.entries(o)
            .filter(([, u]) => isUsage(u))
            .map(([k, u]) => {
              const d = (u as RememberedItem).details;
              const details = typeof d === "object" && d !== null && !Array.isArray(d) ? d : null;
              return [k, { score: u.score, at: u.at, ...(details ? { details } : {}) }];
            }),
        )
      : {};
  if (typeof value !== "object" || value === null) return emptyPaletteHistory();
  const v = value as Record<string, unknown>;
  const tabTypes =
    typeof v.tabTypes === "object" && v.tabTypes !== null
      ? Object.fromEntries(Object.entries(v.tabTypes).map(([k, o]) => [k, usages(o)]))
      : {};
  return { tabTypes, items: remembered(v.items) };
}

const BOUNDARY = /[\s/\\._\-:]/;

/**
 * How well `query` matches `text`: null when its characters are not all in
 * `text` in order (ignoring case), else a score — higher for a prefix, for
 * characters right after a word or path boundary (or a lower→upper case
 * change), and for runs of consecutive characters. An empty query scores 0.
 */
export function fuzzyMatch(query: string, text: string): number | null {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let qi = 0;
  let prev = -2;
  let run = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let s = 1;
    if (ti === 0) s += 10;
    else if (BOUNDARY.test(text[ti - 1])) s += 8;
    else if (text[ti] !== t[ti] && text[ti - 1] === t[ti - 1]) s += 6;
    if (ti === prev + 1) {
      run++;
      s += 4 * run;
    } else {
      run = 0;
    }
    score += s;
    prev = ti;
    qi++;
  }
  if (qi < q.length) return null;
  // A shorter text is a closer match.
  return score - t.length * 0.01;
}

/**
 * How well `query` matches the file at `relPath`: a match in its name counts
 * more than one across its folders.
 */
export function matchFile(query: string, relPath: string): number | null {
  const slash = relPath.lastIndexOf("/");
  const name = fuzzyMatch(query, relPath.slice(slash + 1));
  const whole = fuzzyMatch(query, relPath);
  if (name === null) return whole;
  return Math.max(name + 10, whole ?? -Infinity);
}

/** A result's rank: its match plus what remembered use adds. */
export function rankScore(match: number, itemFrecency: number, tabTypeFrecency: number): number {
  return match + 2 * Math.log2(1 + itemFrecency) + Math.log2(1 + tabTypeFrecency);
}
