/** The config editor's grid app type (`{ extensionId }`). */
export const CONFIG_EDITOR_APP_TYPE = "config-editor";

/** The prefix of official extension ids, left out of their titles. */
const OFFICIAL_PREFIX = "openp41ge-extension-";

/** The id the platform's own settings use (`PLATFORM_SETTINGS_ID`). */
const PLATFORM_ID = "openp41ge";

/** An extension's name: "Agents" for `openp41ge-extension-agents`, "My Ext"
 *  for `my-ext`, "Platform" for the platform. */
export function extensionName(extensionId: string): string {
  if (extensionId === PLATFORM_ID) return "Platform";
  const name = extensionId.startsWith(OFFICIAL_PREFIX)
    ? extensionId.slice(OFFICIAL_PREFIX.length)
    : extensionId;
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** A config editor tab's title: "Agents Settings" for `openp41ge-extension-agents`,
 *  "Platform Settings" for the platform's own. */
export function configEditorTitle(extensionId: string): string {
  return `${extensionName(extensionId)} Settings`;
}
