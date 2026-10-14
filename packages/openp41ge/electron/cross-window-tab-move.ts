/**
 * Moving a grid tab to another window. Windows of the same workspace share
 * its state, so the tab moves within it. Between windows of different workspaces (or none) only a tab that needs
 * no workspace moves: it opens in the target window's state and closes in the
 * source's. The renderer, which knows the tab types, says which those are.
 */

import type { TabId, Workspace } from "../src/layout/types.js";

/** The state a window shows. */
export interface TabMoveState {
  getWorkspace(): Workspace;
  apply(name: string, args: unknown[]): boolean;
  broadcast(): void;
}

/** A tab dropped on another window's grid. */
export interface CrossWindowTabMove {
  readonly sourceWinId: string;
  readonly tabId: string;
  readonly targetWinId: string;
  /** The target column (with `splitLeft`: the column split beside). */
  readonly col: number;
  /** Tab-bar position in the column (-1: the end). */
  readonly index: number;
  /** Set for a drop on a column boundary: a new column left/right of `col`. */
  readonly splitLeft?: boolean;
}

export function moveTabAcrossWindows(
  move: CrossWindowTabMove,
  stateOf: (windowId: string) => TabMoveState | null,
  workspaceFreeAppTypes: readonly string[],
): "moved" | "refused" {
  const source = stateOf(move.sourceWinId);
  const target = stateOf(move.targetWinId);
  if (!source || !target) return "refused";
  const split = move.splitLeft !== undefined;

  if (source === target) {
    source.apply(
      split ? "splitCrossWindowTab" : "moveTabBetweenCells",
      split
        ? [move.sourceWinId, move.tabId, move.targetWinId, move.col, move.splitLeft]
        : [move.sourceWinId, move.tabId, move.targetWinId, 0, move.col, move.index],
    );
    source.broadcast();
    return "moved";
  }

  const tab = source.getWorkspace().editorTabs[move.tabId as TabId];
  if (!tab || !workspaceFreeAppTypes.includes(tab.appType)) return "refused";
  const config: Record<string, unknown> = { ...tab.config };
  const filePath = typeof config.filePath === "string" ? config.filePath : undefined;
  target.apply(
    split ? "splitFileOpen" : "actionOpenFile",
    split
      ? [move.targetWinId, tab.appType, tab.title, filePath, move.col, move.splitLeft, config]
      : [
          move.targetWinId,
          tab.appType,
          tab.title,
          filePath,
          move.col,
          true,
          config,
          move.index >= 0 ? move.index : null,
        ],
  );
  source.apply("removeTabFromCell", [move.sourceWinId, move.tabId]);
  target.broadcast();
  source.broadcast();
  return "moved";
}
