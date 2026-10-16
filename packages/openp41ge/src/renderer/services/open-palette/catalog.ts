/**
 * catalog.ts — the open palette's view of the tab registries: which tab
 * types open a kind (`opens`), and which are offered on their own (every
 * sidebar tab; a grid tab without `opens`), as far as this window can host
 * them.
 */

import {
  getAllAppTypeRegistrations,
  getAppTypeRegistration,
  getSystemTabRegistration,
} from "../../apps/app-registry";
import { availableInWindow } from "../window-workspace";
import type { PaletteCatalog, TabTypeChoice } from "./model";

export const liveCatalog: PaletteCatalog = {
  tabTypesFor(kind: string): TabTypeChoice[] {
    return getAllAppTypeRegistrations()
      .filter((r) => r.opens?.includes(kind) && availableInWindow(r))
      .map((r) => ({ id: r.id, label: r.label, placement: "grid" }));
  },
  tabType(id: string): TabTypeChoice | null {
    const sidebar = getSystemTabRegistration(id);
    if (sidebar) {
      return availableInWindow(sidebar) ? { id, label: sidebar.label, placement: "sidebar" } : null;
    }
    const grid = getAppTypeRegistration(id);
    if (!grid || grid.opens !== undefined || grid.settings || !availableInWindow(grid)) return null;
    return { id, label: grid.label, placement: "grid" };
  },
};
