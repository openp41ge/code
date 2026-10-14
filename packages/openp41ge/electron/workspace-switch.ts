/**
 * Switching the workspace a window shows: the window replaces its workspace,
 * it does not open another one. This decides what happens to its old state
 * and which window of the new workspace's state it becomes; the application
 * carries it out.
 */

/** What a window switching from `oldPath` to `newPath` (null: no workspace) does. */
export interface WorkspaceSwitchPlan {
  /** Its old state: `remove` the window from it, or `keep` it (the
   *  workspace's last window: its layout stays in the workspace's file). */
  readonly old: "remove" | "keep";
  /** Which window of the new state it becomes: a saved one, or a fresh one. */
  readonly window: { readonly kind: "saved"; readonly id: string } | { readonly kind: "new" };
}

export interface WorkspaceSwitchInput {
  readonly windowId: string;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  /** Ids of every live window. */
  readonly liveWindowIds: readonly string[];
  /** Live windows of the old workspace other than this one. */
  readonly otherLiveWindowsOfOld: number;
  /** Live windows of the new workspace. */
  readonly liveWindowsOfNew: number;
  /** The windows of the new workspace's saved layout. */
  readonly savedWindowIdsOfNew: readonly string[];
}

/** The plan, or null when the window already shows `newPath`. */
export function planWorkspaceSwitch(input: WorkspaceSwitchInput): WorkspaceSwitchPlan | null {
  if (input.oldPath === input.newPath) return null;
  const old = input.oldPath !== null && input.otherLiveWindowsOfOld === 0 ? "keep" : "remove";
  if (input.newPath === null || input.liveWindowsOfNew > 0) return { old, window: { kind: "new" } };
  const saved = input.savedWindowIdsOfNew.find((id) => !input.liveWindowIds.includes(id));
  return { old, window: saved ? { kind: "saved", id: saved } : { kind: "new" } };
}
