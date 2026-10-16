/**
 * model.ts — the open palette's results, as data: what was found (entries),
 * which tab types each can open in, and how they rank. Pure; the registries
 * come in as a `PaletteCatalog` and the history and `now` as arguments.
 *
 *   - An **open** entry is an item of an open kind (SDK `open.ts`); it opens
 *     in any tab type whose `opens` lists its kind, the one picked most (and
 *     most recently) for that kind first.
 *   - A **tab** entry is a tab type offered on its own (a sidebar tab, or a
 *     grid tab that takes no params); it is remembered under the kind `""`.
 *   - A **create** entry is a create action: a provider's (ranked by its
 *     title) or the platform's new file / new folder (always last). With
 *     nothing typed, new file / new folder ask for a name (`ask`).
 */

import { openItemKey, type SearchOpenItem } from "openp41ge-sdk";
import {
  frecency,
  fuzzyMatch,
  matchFile,
  orderTabTypes,
  rankScore,
  type PaletteHistory,
  type PalettePick,
} from "../../../shared/open-palette-ranking";

/** A tab type a result can open in. */
export interface TabTypeChoice {
  readonly id: string;
  readonly label: string;
  readonly placement: "grid" | "sidebar";
}

export type PaletteEntry =
  | {
      readonly type: "open";
      readonly item: SearchOpenItem;
      /** A file's path in its worktree: matched instead of the title. */
      readonly matchPath?: string;
    }
  | {
      readonly type: "tab";
      readonly tabType: string;
      readonly title: string;
      readonly description?: string;
      readonly icon?: string;
    }
  | {
      readonly type: "create";
      readonly title: string;
      readonly description?: string;
      readonly icon?: string;
      /** A provider's create action. */
      readonly provider?: {
        readonly extensionId: string;
        readonly providerId: string;
        readonly create: string;
      };
      /** The platform's new file / new folder. */
      readonly path?: { readonly target: string; readonly what: "file" | "folder" };
      /** New file / new folder that asks for its name first, in `target`. */
      readonly ask?: { readonly what: "file" | "folder"; readonly target: CreateTarget };
    };

/** Where a new file / folder goes: a worktree folder, and what to call it. */
export interface CreateTarget {
  readonly root: string;
  /** e.g. `gh/org/repo · main`. */
  readonly label: string;
}

/** The registries, as the model needs them (only types available in this window). */
export interface PaletteCatalog {
  /** The tab types that open `kind`, in registration order. */
  tabTypesFor(kind: string): readonly TabTypeChoice[];
  /** A tab type offered on its own, or null when it is not one now. */
  tabType(id: string): TabTypeChoice | null;
}

/** A ranked result. */
export interface RankedEntry {
  readonly entry: PaletteEntry;
  readonly key: string;
  /** The kind it is remembered under (`""` for a tab on its own). */
  readonly kind: string;
  /** The tab types it opens in, the default first (empty for a create). */
  readonly tabTypes: readonly TabTypeChoice[];
  readonly score: number;
}

/** How a result is told apart (and remembered). */
export function entryKey(entry: PaletteEntry): string {
  switch (entry.type) {
    case "open":
      return openItemKey(entry.item);
    case "tab":
      return `tab:${entry.tabType}`;
    case "create":
      if (entry.provider) {
        return `create:${entry.provider.extensionId}/${entry.provider.providerId}/${entry.provider.create}`;
      }
      if (entry.ask) return `create:ask:${entry.ask.what}`;
      return `create:${entry.path?.what}:${entry.path?.target}`;
  }
}

/** The `limit` best results for `query`, deduplicated (the first source wins). */
export function rankEntries(
  entries: readonly PaletteEntry[],
  query: string,
  catalog: PaletteCatalog,
  history: PaletteHistory,
  now: number,
  limit = 50,
): RankedEntry[] {
  const seen = new Set<string>();
  const ranked: RankedEntry[] = [];
  const last: RankedEntry[] = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.type === "create") {
      if (entry.path || entry.ask) {
        last.push({ entry, key, kind: "", tabTypes: [], score: -Infinity });
        continue;
      }
      const match = fuzzyMatch(query, entry.title);
      if (match !== null) ranked.push({ entry, key, kind: "", tabTypes: [], score: match });
      continue;
    }
    const kind = entry.type === "open" ? entry.item.kind : "";
    let choices: readonly TabTypeChoice[];
    if (entry.type === "open") {
      choices = catalog.tabTypesFor(kind);
    } else {
      const self = catalog.tabType(entry.tabType);
      choices = self ? [self] : [];
    }
    if (choices.length === 0) continue;
    const match =
      entry.type === "open" && entry.matchPath !== undefined
        ? matchFile(query, entry.matchPath)
        : fuzzyMatch(query, entry.type === "open" ? entry.item.title : entry.title);
    if (match === null) continue;
    const usage = history.tabTypes[kind];
    const order = orderTabTypes(
      choices.map((c) => c.id),
      usage,
      now,
    );
    const tabTypes = order.map((id) => choices.find((c) => c.id === id)!);
    const score = rankScore(
      match,
      frecency(history.items[key], now),
      frecency(usage?.[tabTypes[0].id], now),
    );
    ranked.push({ entry, key, kind, tabTypes, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return [...ranked.slice(0, limit), ...last];
}

/** What to remember when `entry` opens in `tabType`; null for a create row. */
export function pickFor(entry: PaletteEntry, tabType: string): PalettePick | null {
  if (entry.type === "create") return null;
  return {
    kind: entry.type === "open" ? entry.item.kind : "",
    tabType,
    item: entryKey(entry),
  };
}

/** New file / new folder named `name` in `target` (none for an empty or `..` name). */
export function namedPathEntries(
  name: string,
  target: CreateTarget | null,
  what: readonly ("file" | "folder")[] = ["file", "folder"],
): PaletteEntry[] {
  const rel = name.trim().replace(/^\/+/, "");
  if (!target || rel === "" || rel.split("/").includes("..")) return [];
  const full = `${target.root.replace(/\/+$/, "")}/${rel}`;
  return what.map((w) => ({
    type: "create",
    title: `New ${w} “${rel}”`,
    description: `in ${target.label}`,
    path: { target: full, what: w },
  }));
}

/** With nothing typed: new file / new folder, each asking for its name. */
export function askPathEntries(target: CreateTarget | null): PaletteEntry[] {
  if (!target) return [];
  return (["file", "folder"] as const).map((what) => ({
    type: "create",
    title: `New ${what}…`,
    description: `in ${target.label}`,
    ask: { what, target },
  }));
}
