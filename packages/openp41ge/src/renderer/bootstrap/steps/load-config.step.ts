/**
 * Load configuration from the main process via IPC, then apply the app theme
 * and the JSON editors' settings.
 *
 * This is the first async IPC call. If it fails, the app continues with
 * default config values (configService defaults gracefully).
 *
 * The UI has already been rendered by the time this step runs, so the
 * user sees an immediate layout even while config loads.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { createLogger } from "openp41ge-core-logger";
import { setJsonEditorDefaults } from "openp41ge-sdk-uikit/json-editor";
import { followJsonEditorSettings } from "../../services/editor-settings";

const log = createLogger("openp41ge", "load-config");

export class LoadConfigStep implements IStartupStep {
  readonly name = "load-config";

  async run(context: StartupContext): Promise<void> {
    await context.configService.load();
    context.configService.applyAppTheme();
    // Every JSON editor (the platform's and extensions') follows the
    // editor/json and editor/* line height and font size.
    followJsonEditorSettings(context.configService, setJsonEditorDefaults);
    log.info("config loaded and theme applied");
  }
}
