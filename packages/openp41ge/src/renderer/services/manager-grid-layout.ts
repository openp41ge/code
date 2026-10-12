/**
 * manager-grid-layout.ts — the manager window's grid as saved between
 * launches (`<app-data>/manager-grid.json`, written by the main process): its
 * columns, each column's tabs in order (app type, title, icon, the tab's
 * config, pinned), and which is active. Tab ids are not saved; a restored tab
 * gets a new one.
 */

/** A saved tab: what reopens it. */
/** The manager grid's id, as its tab bars and drags carry it (`winId`). */
export const MANAGER_GRID_WIN_ID = "manager-grid";

export interface SavedManagerTab {
  readonly appType: string;
  readonly title: string;
  readonly icon?: string;
  readonly config: Record<string, unknown>;
  readonly pinned: boolean;
}

export interface SavedManagerGrid {
  readonly version: 1;
  readonly columns: ReadonlyArray<{
    readonly tabs: readonly SavedManagerTab[];
    /** Index of the column's active tab. */
    readonly active: number;
  }>;
}

/** The grid's tabs, as the manager grid holds them. */
interface GridTabLike {
  readonly id: string;
  readonly appType: string;
  readonly title: string;
  readonly icon?: string;
  readonly config: Record<string, unknown>;
  readonly pinned?: boolean;
}

/** What to save of the grid: its columns (in order) and their tabs. */
export function serializeManagerGrid(
  placements: ReadonlyArray<{ readonly tabIds: readonly string[]; readonly activeTabId: string }>,
  tabs: readonly GridTabLike[],
): SavedManagerGrid {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const columns = placements
    .map((p) => {
      const ids = p.tabIds.filter((id) => byId.has(id));
      return {
        tabs: ids.map((id) => {
          const t = byId.get(id)!;
          return {
            appType: t.appType,
            title: t.title,
            ...(t.icon ? { icon: t.icon } : {}),
            config: { ...t.config },
            pinned: t.pinned ?? false,
          };
        }),
        active: Math.max(0, ids.indexOf(p.activeTabId)),
      };
    })
    .filter((c) => c.tabs.length > 0);
  return { version: 1, columns };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A saved grid read back, or null when it is not one. Malformed tabs and
 *  empty columns are dropped; an out-of-range active index is clamped. */
export function parseManagerGrid(value: unknown): SavedManagerGrid | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.columns)) return null;
  const columns = value.columns
    .filter(isObject)
    .map((c) => {
      const tabs = (Array.isArray(c.tabs) ? c.tabs : [])
        .filter(
          (t): t is Record<string, unknown> =>
            isObject(t) &&
            typeof t.appType === "string" &&
            t.appType !== "" &&
            typeof t.title === "string",
        )
        .map((t) => ({
          appType: t.appType as string,
          title: t.title as string,
          ...(typeof t.icon === "string" && t.icon ? { icon: t.icon } : {}),
          config: isObject(t.config) ? { ...t.config } : {},
          pinned: t.pinned === true,
        }));
      const active = typeof c.active === "number" ? Math.floor(c.active) : 0;
      return { tabs, active: Math.min(Math.max(0, active), Math.max(0, tabs.length - 1)) };
    })
    .filter((c) => c.tabs.length > 0);
  return { version: 1, columns };
}
