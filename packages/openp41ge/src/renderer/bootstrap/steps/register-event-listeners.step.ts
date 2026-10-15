/**
 * Register all document-level event listeners.
 *
 * These listeners handle cross-cutting concerns:
 *   - Config changes → update data-app-theme attribute
 *   - File open events → delegate to FileOpenHandler
 *   - Worktree tab close events → remove tabs matching a path prefix
 *   - Unhandled promise rejections → log for debugging
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";
const log = createLogger("openp41ge", "register-event-listeners");

export class RegisterEventListenersStep implements IStartupStep {
  readonly name = "register-event-listeners";

  async run(context: StartupContext): Promise<void> {
    // Config changes → update theme attribute
    document.addEventListener("openp41ge:config-changed", ((e: CustomEvent) => {
      const detail = e.detail as { key?: string; value?: unknown };
      if (detail?.key === "appTheme") context.configService.applyAppTheme();
    }) as EventListener);

    // File open events
    document.addEventListener("openp41ge:open-file", ((e: CustomEvent) => {
      context.fileOpenHandler.handleOpenFile(e);
    }) as EventListener);

    // Worktree tab close events
    document.addEventListener("openp41ge:close-worktree-tabs", ((e: CustomEvent) => {
      const detail = e.detail as { pathPrefix: string; repoName: string; branch: string };
      const ws = context.workspaceState.getWorkspace();
      if (!ws) return;
      for (const win of ws.windows) {
        for (const placement of win.grid.placements) {
          const toRemove: string[] = [];
          for (const tabId of placement.tabIds) {
            const tab = ws.editorTabs[tabId as keyof typeof ws.editorTabs];
            if (
              tab &&
              typeof tab.config?.filePath === "string" &&
              (tab.config.filePath as string).startsWith(detail.pathPrefix)
            ) {
              toRemove.push(tabId);
            }
          }
          for (const tabId of toRemove) {
            window.openp41ge.workspace.dispatch("removeTabFromCell", [win.id, tabId]);
          }
        }
      }
    }) as EventListener);

    // Catch unhandled promise rejections from Lit for debugging. Lit ChildPart
    // rejections are renderer-internal and are already surfaced as a
    // rejection by the error capture; log at warn so this duplicate detail
    // doesn't add a second error toast.
    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      if (event.reason?.message?.includes("ChildPart")) {
        log.error("ChildPart Error:", event.reason.message, { skipToast: true });
        log.error("ChildPart Stack:", event.reason.stack, { skipToast: true });
      }
    });

    log.info("event listeners registered");
  }
}
