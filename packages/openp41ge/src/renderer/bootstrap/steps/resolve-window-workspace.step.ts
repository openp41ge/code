/**
 * ResolveWindowWorkspaceStep — read the workspace this window shows (null:
 * none) from the preload bridge into the startup context, and load it into the
 * workspace-file service so the title bar shows its name and the file/git
 * panels have a workspace to work on.
 *
 * The main process sends `workspacePath` in the `openp41ge:init` IPC message.
 * Runs early (before the state fetch). Defensive: without the preload bridge
 * the window has no workspace.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { workspaceFileService } from "../../services/workspace-file-service";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "resolve-window-workspace");

export class ResolveWindowWorkspaceStep implements IStartupStep {
  readonly name = "resolve-window-workspace";

  async run(context: StartupContext): Promise<void> {
    const bridge = window.openp41ge?.workspace;
    if (!bridge) {
      log.warn("preload bridge not available: the window has no workspace");
      return;
    }

    // The workspace path is set by the openp41ge:init IPC, which arrives on
    // did-finish-load. Await it so the real binding is read.
    try {
      await bridge.waitForInit?.();
    } catch (err) {
      log.debug("waitForInit failed; assuming no workspace:", err);
    }

    context.workspacePath = bridge.getWorkspacePath?.() ?? null;

    if (context.workspacePath) {
      try {
        await workspaceFileService.loadPath(context.workspacePath);
        // Edits from elsewhere (the workspace editor, an extension) reach this
        // window's panels without a reload.
        workspaceFileService.followDiskChanges();
      } catch (err) {
        log.error("failed to bind open workspace:", err, { skipToast: true });
      }
    }

    log.info("window workspace:", context.workspacePath);
  }
}
