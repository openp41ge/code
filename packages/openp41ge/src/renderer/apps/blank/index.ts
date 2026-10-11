/**
 * Blank app type registration.
 *
 * Creates BlankController panes — an empty tab with no content. Used as the
 * default when a new column is split off without a target app.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { BlankController } from "./blank-controller";

export const blankAppRegistration: AppTypeRegistration = {
  id: "blank",
  label: "Blank Tab",
  icon: "\u25A1",
  description: "Empty tab",
  createController: (tabId: string) => new BlankController(tabId, "blank"),
};
