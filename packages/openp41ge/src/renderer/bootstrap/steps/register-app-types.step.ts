/**
 * Register all app types (blank, file-viewer, log-viewer, config-editor, …)
 * so the grid can create controllers for new panes.
 *
 * Each app type is a registration record with a factory function that
 * creates TabController instances.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "register-app-types");

import { registerAppType } from "../../apps/app-registry";
import { blankAppRegistration } from "../../apps/blank/index";
import { fileViewerAppRegistration } from "../../apps/file-viewer/index";
import { logViewerAppRegistration } from "../../apps/log-viewer/index";
import { configEditorAppRegistration } from "../../apps/config-editor/index";
import { registerExtensionsWithRefresh } from "../../apps/extension/index";
import { workspaceData } from "../../services/workspace-data";

// ─── Log viewer component (auto-registers <openp41ge-log-viewer>) ──────────
import "openp41ge-core-logger/viewer";

export class RegisterAppTypesStep implements IStartupStep {
  readonly name = "register-app-types";

  async run(_context: StartupContext): Promise<void> {
    registerAppType(blankAppRegistration);
    registerAppType(fileViewerAppRegistration);
    registerAppType(logViewerAppRegistration);
    registerAppType(configEditorAppRegistration);

    // Register editor system tab types (override the grid)
    // The workspace manager is no longer an in-window surface: a workspace window
    // is bound to a fixed workspace (no in-window switching), and the Window
    // Manager window uses its own <openp41ge-window-manager> component rather than
    // a workspace overlay tab. So no "workspace-manager" editor system tab type
    // nor a "workspaces" system-overlay tab is registered here.

    // ── Load the extensions' renderer entries ───────────────────────────
    // Each self-registers its surfaces; the set is fetched from main and
    // reloaded on change.
    await registerExtensionsWithRefresh();

    // ── Populate workspace data ───────────────────────────────────────
    this._initWorkspaceData();

    log.info("app types and system tab types registered");
  }

  private async _initWorkspaceData(): Promise<void> {
    try {
      const repos = await window.openp41ge.workspaceController.listRepos();
      for (const repo of repos) {
        workspaceData.addRepo({
          id: `repo-${repo.name}`,
          path: repo.path,
          name: repo.name,
        });
      }
      if (repos.length > 0) {
        workspaceData.setActiveRepo(`repo-${repos[0].name}`);
      }
    } catch (err) {
      // workspace controller may not be ready yet
      log.debug("register-app-types workspace controller not ready:", err);
    }
  }
}
