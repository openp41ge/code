/**
 * tabs-showing.ts — the tabs that show a repository, a worktree or a folder
 * on disk.
 *
 * After a repository or worktree is deleted, the tabs that showed it are
 * closed: every tab whose config names the repository (`repoName`; for a
 * worktree, also its `branch`) — e.g. the git extension's repository, commit
 * and file diff tabs — and every tab whose file was inside the deleted folder.
 */

import type { Workspace } from "./types.js";

/** What was deleted: a repository, one of its worktrees, or a folder. */
export interface DeletedTarget {
  /** The repository (`<host>/<org>/<repo>`). */
  readonly repoName?: string;
  /** With `repoName`: only that worktree (its branch) went. */
  readonly branch?: string;
  /** The deleted folder: the clone, or a worktree. */
  readonly folder: string;
}

/** A tab in a window's grid. */
export interface TabRef {
  readonly windowId: string;
  readonly tabId: string;
}

function shows(config: Record<string, unknown> | undefined, target: DeletedTarget): boolean {
  if (target.repoName && config?.repoName === target.repoName) {
    if (!target.branch || config.branch === target.branch) return true;
  }
  const filePath = config?.filePath;
  if (typeof filePath !== "string") return false;
  const folder = target.folder.replace(/\/+$/, "");
  return filePath === folder || filePath.startsWith(`${folder}/`);
}

/** Every tab, in every window's grid, that shows `target`. */
export function tabsShowing(workspace: Workspace, target: DeletedTarget): TabRef[] {
  const found: TabRef[] = [];
  for (const win of workspace.windows) {
    for (const placement of win.grid.placements) {
      for (const id of placement.tabIds) {
        const tab = workspace.editorTabs[id];
        if (tab && shows(tab.config, target)) {
          found.push({ windowId: win.id, tabId: id });
        }
      }
    }
  }
  return found;
}
