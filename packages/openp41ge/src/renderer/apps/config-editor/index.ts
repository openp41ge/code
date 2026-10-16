/**
 * Config editor app type registration — the platform's JSON editor for an
 * extension's config (`{ extensionId }`), opened by `host.config.openEditor()`
 * or a dropped `config-overrides` payload.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { ConfigEditorController } from "./config-editor-controller";
import { CONFIG_EDITOR_APP_TYPE } from "./title";

export const configEditorAppRegistration: AppTypeRegistration = {
  id: CONFIG_EDITOR_APP_TYPE,
  opens: ["openp41ge/settings"],
  label: "Settings",
  icon: "⚙",
  description: "An extension's settings",
  // Needs no workspace open (a window without one can host it).
  workspace: "none",
  createController: (tabId: string) => new ConfigEditorController(tabId),
  settings: true,
};
