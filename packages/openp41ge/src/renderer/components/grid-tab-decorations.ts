/**
 * grid-tab-decorations.ts — what a grid tab shows besides its title: a prefix
 * icon and a muted description, for the app types that have them (extension
 * tabs, from their surface's `tabLabel`; settings tabs get the gear).
 */

import { getAppTypeRegistration } from "../apps/app-registry";
import { settingsIcon } from "../icons";
import type { AppTypeRegistration } from "../controllers/types";

type TabLabel = ReturnType<NonNullable<AppTypeRegistration["tabLabel"]>>;

/**
 * An extension grid tab's label for its config (the surface's `tabLabel`),
 * or undefined: not an extension tab, no `tabLabel`, or it threw.
 */
export function extensionTabLabel(
  appType: string,
  config: Record<string, unknown> | undefined,
): TabLabel | undefined {
  if (!appType.startsWith("ext:")) return undefined;
  const tabLabel = getAppTypeRegistration(appType)?.tabLabel;
  if (!tabLabel) return undefined;
  try {
    return tabLabel(config ?? {});
  } catch {
    return undefined;
  }
}

/** The settings gear, as a settings tab's prefix icon (null: not a settings tab). */
export function settingsTabIcon(appType: string): string | null {
  return isSettingsAppType(appType) ? settingsIcon(14) : null;
}

/** Whether a grid tab is a settings tab (it shows the settings gear). */
export function isSettingsAppType(appType: string): boolean {
  return getAppTypeRegistration(appType)?.settings === true;
}
