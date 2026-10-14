/**
 * Release app type — a release of the app in a manager grid tab (`{ tag }`),
 * opened from a row of the Releases tab. One tab per release: the tab's key
 * (`path`) is `release:<tag>`.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { ReleaseController } from "./release-controller";

export const RELEASE_APP_TYPE = "release";

/** The tab's icon (Material Symbols "deployed_code"), in the tab's text colour. */
const RELEASE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 -960 960 960" width="16" height="16"><path d="M440-183v-274L200-596v274l240 139Zm80 0 240-139v-274L520-457v274Zm-40-343 237-137-237-137-237 137 237 137ZM160-252q-19-11-29.5-29T120-321v-318q0-22 10.5-40t29.5-29l280-161q19-11 40-11t40 11l280 161q19 11 29.5 29t10.5 40v318q0 22-10.5 40T800-252L520-91q-19 11-40 11t-40-11L160-252Zm320-228Z"/></svg>';

export const releaseAppRegistration: AppTypeRegistration = {
  id: RELEASE_APP_TYPE,
  label: "Release",
  icon: RELEASE_ICON,
  description: "A release of the app",
  // Needs no workspace open (a window without one can host it).
  workspace: "none",
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
