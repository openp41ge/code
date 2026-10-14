/**
 * App type and system tab registries — maps type IDs to controller factories.
 *
 * Two separate registries:
 *   1. Editor app types (for the grid) — e.g., file-viewer, terminal
 *   2. System tab types (for sidebars) — e.g., explorer, git, search, projects
 *
 * When a pane is created, the grid looks up the editor app type here and calls
 * `createController(paneId)` to get the appropriate controller.
 * If no registration exists, PlaceholderController is used as fallback.
 */

import type {
  AppTypeRegistration,
  SystemTabRegistration,
  SystemTabSettings,
} from "../controllers/types";

// ─── Editor App Type Registry ─────────────────────────────────────────────

const _appRegistry = new Map<string, AppTypeRegistration>();

export function registerAppType(reg: AppTypeRegistration): void {
  _appRegistry.set(reg.id, reg);
}

/** Register a settings surface as a grid app type (a settings tab). */
export function registerSettingsAppType(settings: SystemTabSettings): void {
  registerAppType({
    id: settings.appType,
    label: settings.label,
    icon: settings.icon ?? "⚙",
    description: settings.description ?? `${settings.label} settings`,
    createController: settings.createController,
    settings: true,
  });
}

/** The app types that need no workspace open (`workspace: "none"`). */
export function workspaceFreeAppTypes(): string[] {
  return [..._appRegistry.values()].filter((r) => r.workspace === "none").map((r) => r.id);
}

export function getAppTypeRegistration(id: string): AppTypeRegistration | undefined {
  return _appRegistry.get(id);
}

// ─── System Tab Type Registry ─────────────────────────────────────────────

const _systemTabRegistry = new Map<string, SystemTabRegistration>();

export function registerSystemTabType(reg: SystemTabRegistration): void {
  _systemTabRegistry.set(reg.id, reg);
  // A system tab owns its settings surface as a grid app type, so registering
  // the tab also makes the grid able to render its settings tab.
  if (reg.settings) registerSettingsAppType(reg.settings);
}

export function getSystemTabRegistration(id: string): SystemTabRegistration | undefined {
  return _systemTabRegistry.get(id);
}

export function getAllSystemTabRegistrations(): SystemTabRegistration[] {
  return Array.from(_systemTabRegistry.values());
}
