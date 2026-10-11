/**
 * File open handler — manages the openp41ge:open-file event and file opening logic.
 *
 * Determines whether to create a new tab, reuse an existing preview tab,
 * or promote a preview tab to edit mode.
 */

import type { ICommandBus } from "./command-bus";
import type { IWorkspaceStateManager } from "./workspace-state-manager";
import type { TabMountManager } from "../services/tab-mount-manager";

export interface IFileOpenHandler {
  /** Initialize with dependencies. */
  init(
    commandBus: ICommandBus,
    workspaceState: IWorkspaceStateManager,
    mountManager?: TabMountManager,
  ): void;

  /** Handle the openp41ge:open-file custom event. */
  handleOpenFile(e: CustomEvent): void;

  /** Open a file in preview mode (single-click in file tree). */
  openPreview(filePath: string, fileName: string): void;

  /** Open a file in edit mode (double-click in file tree). */
  openEdit(filePath: string, fileName: string): void;
}
