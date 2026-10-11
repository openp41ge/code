/**
 * Terminal app type registration.
 *
 * Registers the terminal app type so that when a pane is created with
 * appType="terminal", the grid creates a TerminalController instead of
 * a PlaceholderController.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { TerminalController } from "./terminal-controller";

export const terminalAppRegistration: AppTypeRegistration = {
  id: "terminal",
  label: "Terminal",
  icon: "\u2318",
  description: "Shell / command line",
  createController: (tabId: string) => new TerminalController(tabId, "terminal"),
};
