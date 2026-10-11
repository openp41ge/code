/**
 * ResolveWindowKindStep — read this window's kind and workspace binding from the
 * preload bridge into the startup context.
 *
 * Workspace windows run the full app; window-manager windows run a thin
 * workspace-picker view. The main process sends `windowType` / `workspacePath`
 * in the `openp41ge:init` IPC message, exposed here as `getWindowType()` /
 * `getWorkspacePath()`.
 *
 * Runs early (before state fetch) so later steps can branch on `windowType`.
 * Defensive: if the preload bridge is missing or getters are unavailable, the
 * context keeps its "workspace" default.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { workspaceFileService } from "../../services/workspace-file-service";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "resolve-window-kind");

export class ResolveWindowKindStep implements IStartupStep {
  readonly name = "resolve-window-kind";

  async run(context: StartupContext): Promise<void> {
    const bridge = window.openp41ge as
      | (Window["openp41ge"] & {
          workspace?: {
            getWindowType?: () => string;
            getWorkspacePath?: () => string | null;
            waitForInit?: () => Promise<void>;
          };
        })
      | undefined;

    if (!bridge?.workspace) {
      log.warn("preload bridge not available, defaulting window kind to workspace");
      return;
    }

    // The windowType / workspacePath are set by the openp41ge:init IPC, which
    // arrives on did-finish-load. Await it so we read the real kind instead of
    // the preload's default ("workspace") — otherwise a window-manager window
    // would briefly bind to the first layout window.
    try {
      await bridge.workspace.waitForInit?.();
    } catch (err) {
      // Defensive: if init never resolves, fall back to defaults below.
      log.debug("resolve-window-kind waitForInit failed; assuming workspace:", err);
    }

    const rawType = bridge.workspace.getWindowType?.();
    if (rawType === "manager") {
      context.windowType = "manager";
    } else if (rawType === "logs") {
      context.windowType = "logs";
    } else if (rawType === "workspace") {
      context.windowType = "workspace";
    } else {
      // Unknown / undefined — default to workspace (backwards compatible).
      log.warn("unknown window type, defaulting to workspace:", rawType);
      context.windowType = "workspace";
    }

    context.workspacePath = bridge.workspace.getWorkspacePath?.() ?? null;

    // A workspace window is bound to a fixed workspace — load it into the
    // workspace-file service so the title bar shows its name and the file/git
    // panels have a workspace to operate on. Window-manager windows have no
    // binding, so they skip this.
    if (context.windowType === "workspace" && context.workspacePath) {
      try {
        await workspaceFileService.loadPath(context.workspacePath);
        // Edits from elsewhere (the manager's workspace editor, an extension)
        // reach this window's panels without a reload.
        workspaceFileService.followDiskChanges();
      } catch (err) {
        log.error("failed to bind open workspace:", err, { skipToast: true });
      }
    }

    log.info("window kind:", context.windowType, "workspacePath:", context.workspacePath);
  }
}
