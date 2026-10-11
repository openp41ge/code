/**
 * legacy-agents-tabs.ts — saved-state migration for the retired platform
 * agents (agents extension plan, phase 6). Its tabs are rewritten on read to
 * open the agents extension's surfaces:
 *   - a grid `agents` tab `{ chatId | filePath: chatId, cwd? }`
 *       → the chat tab `{ chatId, cwd? }` (the file-path slot is kept: it is
 *         the tab's identity, as `OpenTabRequest.key` gives it);
 *   - the `agents` sidebar tab → the extension's Agents sidebar.
 * A chat tab without a chat is left as it is. Idempotent; a record with
 * nothing to rewrite is returned unchanged.
 */

const EXT = "ext:openp41ge-extension-agents";

type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Rewrite the tabs `migrate` maps (copy on change). */
function rewrite<T>(tabs: Record<string, T>, migrate: (tab: Obj) => Obj | null) {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [id, tab] of Object.entries(tabs)) {
    const next = tab && typeof tab === "object" ? migrate(tab as Obj) : null;
    if (next) changed = true;
    out[id] = (next ?? tab) as T;
  }
  return changed ? out : tabs;
}

/** Grid tabs: a saved chat tab becomes the extension's chat tab. */
export function migrateLegacyAgentsEditorTabs<T>(tabs: Record<string, T>): Record<string, T> {
  return rewrite(tabs, (tab) => {
    if (tab.appType !== "agents") return null;
    const config = (tab.config && typeof tab.config === "object" ? tab.config : {}) as Obj;
    const chatId = str(config.chatId) ?? str(config.filePath);
    if (!chatId) return null;
    const cwd = str(config.cwd);
    return {
      ...tab,
      appType: `${EXT}:chat`,
      config: { chatId, filePath: chatId, ...(cwd ? { cwd } : {}) },
    };
  });
}

/** Sidebar tabs: the Agents tab becomes the extension's Agents sidebar. */
export function migrateLegacyAgentsSystemTabs<T>(tabs: Record<string, T>): Record<string, T> {
  return rewrite(tabs, (tab) =>
    tab.appType === "agents" ? { ...tab, appType: `${EXT}:chats` } : null,
  );
}
