/**
 * Log viewer app type registration.
 *
 * Registers the log viewer so that <openp41ge-log-viewer> can be mounted
 * inside a pane when the user chooses "Logs" from the pane picker.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { LogViewerController } from "./log-viewer-controller";

export const logViewerAppRegistration: AppTypeRegistration = {
  id: "log-viewer",
  label: "Logs",
  icon: "\u2318",
  description: "Application log viewer",
  createController: (tabId: string) => new LogViewerController(tabId),
};
