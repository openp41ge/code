/**
 * command-handlers.ts — IPC for the scoped terminal (`CommandService`).
 *
 *   - `commands:binaries` — the binaries that can run now, with their rules.
 *   - `commands:conflicts` — the binaries several extensions define.
 *   - `commands:run` — run a line typed at a terminal's prompt (by `"you"`),
 *     in the calling window's workspace.
 *   - `commands:runs` / `commands:get-run` — that workspace's runs.
 *   - push `commands:run-changed` — a run of the window's workspace started,
 *     printed or ended: `{ append, run }`, `run.output` only what was added
 *     since the last push (`append: true`), or all of it.
 */

import { ipcMain } from "electron";
import type { CommandRequest } from "openp41ge-sdk";
import type {
  CommandRun,
  CommandRunFilter,
  CommandScope,
  CommandService,
} from "../../src/main/services/command-service.js";

type Sender = { sender: Electron.WebContents };

/** Who runs a line typed at a terminal's prompt. */
export const PROMPT_RUNNER = "you";

export function registerCommandHandlers(
  service: CommandService,
  scopeFor: (event: Sender) => CommandScope | null,
): void {
  ipcMain.handle("commands:binaries", () => service.binaries());
  ipcMain.handle("commands:conflicts", () => service.conflicts());
  ipcMain.handle("commands:run", (event, request: CommandRequest) =>
    service.run(scopeFor(event), request, PROMPT_RUNNER),
  );
  ipcMain.handle("commands:runs", (event, filter: CommandRunFilter) => {
    const scope = scopeFor(event);
    return scope ? service.runs(scope.workspaceId, filter ?? {}) : [];
  });
  ipcMain.handle("commands:get-run", (event, runId: string) => {
    const scope = scopeFor(event);
    return scope ? service.getRun(scope.workspaceId, String(runId)) : null;
  });
}

/** How much of each run's output the windows were sent. */
const sentLength = new Map<string, number>();

/** Tell `windows` (its workspace's) a run changed, sending only output
 *  they do not have. */
export function broadcastCommandRun(
  run: CommandRun,
  windows: Iterable<Electron.BrowserWindow>,
): void {
  const sent = sentLength.get(run.runId) ?? 0;
  const append = sent > 0 && run.output.length >= sent;
  const payload = {
    append,
    run: { ...run, output: append ? run.output.slice(sent) : run.output },
  };
  if (run.state === "done") sentLength.delete(run.runId);
  else sentLength.set(run.runId, run.output.length);
  for (const bw of windows) {
    if (!bw.isDestroyed()) bw.webContents.send("commands:run-changed", payload);
  }
}
