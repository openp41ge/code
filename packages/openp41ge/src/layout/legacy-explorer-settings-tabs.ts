/**
 * legacy-explorer-settings-tabs.ts — saved-state migration for the retired
 * platform Explorer Settings tab. The Explorer's settings are its extension's
 * config now, so a saved `explorer-settings` grid tab reopens as that config
 * in the platform's settings editor (`config-editor`, `{ extensionId }`).
 * Idempotent; tabs with nothing to rewrite are returned unchanged.
 */

const EXPLORER = "openp41ge-extension-explorer";

type Obj = Record<string, unknown>;

/** Grid tabs: a saved Explorer Settings tab becomes the Explorer's settings editor. */
export function migrateLegacyExplorerSettingsTabs<T>(tabs: Record<string, T>): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [id, tab] of Object.entries(tabs)) {
    const t = tab as Obj | null;
    if (t && typeof t === "object" && t.appType === "explorer-settings") {
      changed = true;
      out[id] = {
        ...t,
        appType: "config-editor",
        filePath: `config:${EXPLORER}`,
        config: { extensionId: EXPLORER },
      } as T;
    } else {
      out[id] = tab;
    }
  }
  return changed ? out : tabs;
}
