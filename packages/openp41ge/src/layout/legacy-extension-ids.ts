/**
 * legacy-extension-ids.ts — saved-state migration for renamed extension ids.
 *
 * Extension surfaces are saved by app type `ext:<extensionId>:<surfaceId>`
 * (workspace files and saved layouts). When the official extensions were
 * renamed to the `openp41ge-extension-*` convention their ids changed with
 * them, so app types saved under the old ids are rewritten on read.
 * Idempotent; any other app type is returned unchanged.
 */

/** Pre-rename extension id → current id. */
const LEGACY_EXTENSION_IDS: Readonly<Record<string, string>> = {
  "openp41ge-explorer": "openp41ge-extension-explorer",
  "openp41ge-workspaces": "openp41ge-extension-workspaces",
};

/** Rewrite an app type saved under a pre-rename extension id. */
export function migrateLegacyExtensionAppType(appType: string): string {
  const match = /^ext:([^:]+):(.*)$/.exec(appType);
  if (!match) return appType;
  const renamed = LEGACY_EXTENSION_IDS[match[1]];
  return renamed ? `ext:${renamed}:${match[2]}` : appType;
}

/** Rewrite the `appType` of every saved tab in a tab record (copy on change). */
export function migrateLegacyExtensionTabs<T>(tabs: Record<string, T>): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [id, tab] of Object.entries(tabs)) {
    const appType = (tab as { appType?: unknown })?.appType;
    if (typeof appType === "string") {
      const next = migrateLegacyExtensionAppType(appType);
      if (next !== appType) {
        out[id] = { ...tab, appType: next };
        changed = true;
        continue;
      }
    }
    out[id] = tab;
  }
  return changed ? out : tabs;
}
