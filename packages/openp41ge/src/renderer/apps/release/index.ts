/**
 * Release app type — a release of the app in a manager grid tab (`{ tag }`),
 * opened from a row of the Releases tab. One tab per release: the tab's key
 * (`path`) is `release:<tag>`.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { ReleaseController } from "./release-controller";

export const RELEASE_APP_TYPE = "release";

export const releaseAppRegistration: AppTypeRegistration = {
  id: RELEASE_APP_TYPE,
  label: "Release",
  icon: "📦",
  description: "A release of the app",
  createController: (tabId: string) => new ReleaseController(tabId),
};

/** The grid's open call, as far as opening a release uses it. */
interface ReleaseGrid {
  openApp(
    appType: string,
    title: string,
    config: Record<string, unknown>,
    icon?: string,
    pinned?: boolean,
  ): void;
}

/** Open (or focus) release `tag`'s tab; `pinned` from a double click. */
export function openReleaseTab(grid: ReleaseGrid, tag: string, pinned: boolean): void {
  grid.openApp(RELEASE_APP_TYPE, tag, { tag, path: `release:${tag}` }, undefined, pinned);
}
