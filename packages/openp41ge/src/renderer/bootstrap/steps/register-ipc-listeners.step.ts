/**
 * Register IPC listeners from the main process.
 *
 * These handle:
 *   - Zoom in/out/reset (triggered by the Electron menu bar)
 *   - Confirm modal (triggered by the main process for quit/close confirmations)
 *   - Open logs in this window's grid
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "register-ipc-listeners");

import { wireResetListener } from "../../app";
import { openLogsInWindow } from "../../apps/log-viewer/open-logs";
import { openWorkspaceEditor } from "../../apps/management/index";
import { workspaceFileService } from "../../services/workspace-file-service";

export class RegisterIpcListenersStep implements IStartupStep {
  readonly name = "register-ipc-listeners";

  async run(context: StartupContext): Promise<void> {
    // If preload bridge is missing, skip IPC listener registration
    if (typeof window.openp41ge === "undefined") {
      log.warn("preload bridge not available, skipping IPC listeners");
      return;
    }

    window.openp41ge.onZoomIn(() => context.zoomService.zoomIn());
    window.openp41ge.onZoomOut(() => context.zoomService.zoomOut());
    window.openp41ge.onZoomReset(() => context.zoomService.zoomReset());

    // ── Confirm dialog mask ────────────────────────────────────────────────
    // When a confirmation is shown for this window, dim + block it and point
    // the user at the confirm dialog window. The dialog itself is a native
    // BrowserWindow owned by the main process (confirm-dialog-manager).
    window.openp41ge.confirm.onMaskShow(() => {
      if (document.getElementById("openp41ge-confirm-mask-root")) return;
      const host = document.createElement("div");
      host.id = "openp41ge-confirm-mask-root";
      const mask = document.createElement("openp41ge-confirm-mask");
      host.appendChild(mask);
      document.body.appendChild(host);
    });
    window.openp41ge.confirm.onMaskHide(() => {
      document.getElementById("openp41ge-confirm-mask-root")?.remove();
    });

    // Wire the app reset listener so window.openp41ge.workspace.reset() works
    wireResetListener();

    // ── Logs open in this window's grid ─────────────────────────────────────
    window.openp41ge.windowManager.onOpenLogsInWindow?.((errorId) => {
      void openLogsInWindow(errorId ? { errorId } : undefined);
    });
    // A window opened to show logs (no window was open) opens them now.
    const launchLogs = window.openp41ge.workspace.getLaunchLogs?.();
    if (launchLogs) void openLogsInWindow(launchLogs);

    // ── Explorer worktree warning icon → the workspace's editor ──
    // The editor shows the workspace's repositories and worktrees.
    document.addEventListener("openp41ge:focus-workspace-repo", ((e: Event) => {
      const repoName = (e as CustomEvent<{ repoName?: string }>).detail?.repoName;
      const path = context.workspacePath;
      if (!repoName || !path) return;
      openWorkspaceEditor(path, workspaceFileService.openWorkspaceName, true);
    }) as EventListener);

    log.info("IPC listeners registered");
  }
}
