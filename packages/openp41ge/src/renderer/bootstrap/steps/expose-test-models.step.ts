/**
 * Expose test models on window.__testModels for test injection.
 *
 * This step has no dependencies and never fails — it only sets a window property.
 * In production builds, test model imports are tree-shaken.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "expose-test-models");

// ── Test models (tree-shaken from production) ──────────────────────────
import { TopBarDropTarget } from "../../services/drop-targets/topbar-drop-target";
import {
  TestRepoService,
  TestRepositoryModel,
  TestWorktreeModel,
  TestFileContent,
} from "../../models/test-models";

export class ExposeTestModelsStep implements IStartupStep {
  readonly name = "expose-test-models";

  async run(_context: StartupContext): Promise<void> {
    (window as unknown as Record<string, unknown>).__testModels = {
      TestRepoService,
      TestRepositoryModel,
      TestWorktreeModel,
      TestFileContent,
      TopBarDropTarget,
    };
    log.info("test models exposed");
  }
}
