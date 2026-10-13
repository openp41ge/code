/**
 * legacy-git-tabs.ts — saved-state migration for the retired platform git UI
 * (git extension plan, phase 6). Its tabs are rewritten on read to open the
 * git extension's surfaces:
 *   - `git-repository` `{ filePath: repoName, worktreeBranch? }`
 *       → Repository `{ repoName, branch? }`
 *   - `git-commit-search` `{ filePath: JSON { repoName, hash } }`
 *       → Commit `{ repoName, hash }`
 *   - `commit-file-diff` `{ filePath: JSON { repoName, hash, path } }`
 *       → File diff `{ repoName, path, hash }`
 *   - the `git` (History) sidebar tab → the extension's Git History Search
 *     sidebar (`history-search`).
 * A tab whose saved data cannot be read is left as it is. Idempotent; a
 * record with nothing to rewrite is returned unchanged.
 */

const EXT = "ext:openp41ge-extension-git";

type Obj = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The JSON object an old tab kept in its file-path slot, or its own fields. */
function saved(config: Obj): Obj {
  const slot = config.filePath;
  if (typeof slot === "string" && slot.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(slot);
      if (parsed && typeof parsed === "object") return { ...config, ...(parsed as Obj) };
    } catch {
      return config;
    }
  }
  return config;
}

/** The extension tab an old git tab becomes, or null when it cannot. */
function migrateTab(tab: Obj): Obj | null {
  const config = (tab.config && typeof tab.config === "object" ? tab.config : {}) as Obj;
  switch (tab.appType) {
    case "git-repository": {
      const repoName = str(config.repoName) ?? str(config.filePath);
      if (!repoName || repoName.startsWith("{")) return null;
      const branch = str(config.worktreeBranch);
      return {
        ...tab,
        appType: `${EXT}:repository`,
        config: { repoName, ...(branch ? { branch } : {}) },
      };
    }
    case "git-commit-search": {
      const c = saved(config);
      const repoName = str(c.repoName);
      const hash = str(c.hash);
      if (!repoName || !hash) return null;
      return { ...tab, appType: `${EXT}:commit`, config: { repoName, hash } };
    }
    case "commit-file-diff": {
      const c = saved(config);
      const repoName = str(c.repoName);
      const hash = str(c.hash);
      const path = str(c.path);
      if (!repoName || !hash || !path) return null;
      return { ...tab, appType: `${EXT}:file-diff`, config: { repoName, path, hash } };
    }
    case "git":
      return { ...tab, appType: `${EXT}:history-search`, title: "Git History Search" };
    default:
      return null;
  }
}

/** Rewrite every saved old git tab in a tab record (copy on change). */
export function migrateLegacyGitTabs<T>(tabs: Record<string, T>): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [id, tab] of Object.entries(tabs)) {
    const next = tab && typeof tab === "object" ? migrateTab(tab as Obj) : null;
    if (next) changed = true;
    out[id] = (next ?? tab) as T;
  }
  return changed ? out : tabs;
}
