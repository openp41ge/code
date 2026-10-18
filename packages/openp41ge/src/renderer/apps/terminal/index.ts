/**
 * Terminal app type — the platform's scoped terminal in a grid tab: locked to
 * one binary an extension defines, in one worktree
 * (`{ binary, repo, worktree, runId? }`, the `openp41ge/command-run` kind).
 * One tab per binary and worktree: its key (`path`) is
 * `terminal:<binary>:<repo>@<worktree>`; a `runId` marks that run.
 */

import type { AppTypeRegistration } from "../../controllers/types";
import { TerminalController } from "./terminal-controller";

export { terminalTabKey, terminalTabTitle, type TerminalTarget } from "./target";

export const TERMINAL_APP_TYPE = "terminal";

/** The tab's icon (Material Symbols "terminal"), in the tab's text colour. */
export const TERMINAL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 -960 960 960" width="16" height="16"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H160v400Zm140-40-56-56 103-104-104-104 57-56 160 160-160 160Zm180 0v-80h240v80H480Z"/></svg>';

export const terminalAppRegistration: AppTypeRegistration = {
  id: TERMINAL_APP_TYPE,
  opens: ["openp41ge/command-run"],
  label: "Terminal",
  icon: TERMINAL_ICON,
  description: "A binary an extension defines, run in a worktree",
  createController: (tabId: string) => new TerminalController(tabId),
};
