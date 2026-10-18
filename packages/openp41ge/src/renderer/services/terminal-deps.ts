/**
 * What the scoped terminal tab (<openp41ge-terminal-view>) reads and does:
 * the binaries extensions define, the workspace's runs, running a typed
 * line, and opening an extension's settings. One place, so tests can
 * replace it (`setTerminalDeps`).
 */

import type { CommandBinaryInfo, CommandRequest, CommandResult } from "openp41ge-sdk";
import type { CommandRun } from "../../shared/command-run";
import { CONFIG_EDITOR_APP_TYPE } from "../apps/config-editor/title";

/** Which runs a terminal shows. */
export interface TerminalRunFilter {
  readonly binary: string;
  readonly repo: string;
  readonly worktree: string;
}

export interface TerminalDeps {
  binaries(): Promise<readonly CommandBinaryInfo[]>;
  /** The workspace's runs matching `filter`, newest first. */
  runs(filter: TerminalRunFilter): Promise<readonly CommandRun[]>;
  run(request: CommandRequest): Promise<CommandResult>;
  /** A run of this window's workspace started, printed (`append`: the new
   *  output only) or ended. Returns unsubscribe. */
  onRun(fn: (event: { append: boolean; run: CommandRun }) => void): () => void;
  /** Open the settings of extension `extensionId`. */
  openSettings(extensionId: string): void;
}

let override: TerminalDeps | null = null;

/** Replace the dependencies; null restores the real ones. */
export function setTerminalDeps(deps: TerminalDeps | null): void {
  override = deps;
}

export function terminalDeps(): TerminalDeps {
  return override ?? defaults();
}

function defaults(): TerminalDeps {
  const commands = window.openp41ge?.commands;
  return {
    binaries: async () => (await commands?.binaries()) ?? [],
    runs: async (filter) => (await commands?.runs(filter)) ?? [],
    run: (request) =>
      commands
        ? commands.run(request)
        : Promise.resolve({
            ok: false,
            exitCode: null,
            output: "",
            truncated: false,
            runId: "",
            error: "commands are not available",
          }),
    onRun: (fn) => commands?.onRun(fn) ?? (() => undefined),
    openSettings: (extensionId) =>
      document.dispatchEvent(
        new CustomEvent("grid-open-tab", {
          detail: {
            tabType: CONFIG_EDITOR_APP_TYPE,
            tabConfig: { extensionId },
            pinned: true,
          },
        }),
      ),
  };
}
