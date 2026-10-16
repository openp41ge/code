/**
 * palette-handlers.ts — IPC for the open palette (Cmd+N).
 *
 *   - `palette:providers` / `palette:search` / `palette:create` — the
 *     extensions' search providers, run with the calling window's context.
 *   - `palette:files` — the calling workspace's files that best match a query.
 *   - `palette:create-path` — a new file or folder inside one of the calling
 *     workspace's worktrees.
 *   - `palette:history` / `palette:record` — what was opened, in which tab
 *     type (one store for every window).
 */

import { ipcMain } from "electron";
import type { HandlerCaller, WorkspaceRoot } from "openp41ge-sdk";
import type { ExtensionHostManager } from "../../src/main/services/extension-host-manager.js";
import type { PaletteHistoryStore } from "../../src/main/services/palette-history-store.js";
import type { WorkspaceFileIndex } from "../../src/main/services/workspace-file-index.js";
import { createInRoots } from "../../src/main/services/palette-file-create.js";
import type { PalettePick } from "../../src/shared/open-palette-ranking.js";

type Sender = { sender: Electron.WebContents };

export interface PaletteHandlerDeps {
  readonly manager: ExtensionHostManager;
  readonly callerFor: (event: Sender) => HandlerCaller;
  readonly history: PaletteHistoryStore;
  readonly files: WorkspaceFileIndex;
}

const MAX_FILES = 200;

function isPick(value: unknown): value is PalettePick {
  const p = value as PalettePick | null;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.kind === "string" &&
    typeof p.tabType === "string" &&
    p.tabType !== "" &&
    typeof p.item === "string" &&
    p.item !== ""
  );
}

export function registerPaletteHandlers(deps: PaletteHandlerDeps): void {
  const { manager, callerFor, history, files } = deps;
  const rootsOf = async (event: Sender): Promise<readonly WorkspaceRoot[]> =>
    (await callerFor(event).workspace?.roots()) ?? [];

  ipcMain.handle("palette:providers", () => manager.searchProviders());

  ipcMain.handle(
    "palette:search",
    (event, extensionId: string, providerId: string, query: string) =>
      manager.search(extensionId, providerId, String(query ?? ""), callerFor(event)),
  );

  ipcMain.handle(
    "palette:create",
    (event, extensionId: string, providerId: string, create: string, query: string) =>
      manager.createFromSearch(
        extensionId,
        providerId,
        create,
        String(query ?? ""),
        callerFor(event),
      ),
  );

  ipcMain.handle("palette:files", async (event, query: string, limit?: number) =>
    files.search(
      await rootsOf(event),
      String(query ?? ""),
      Math.min(Math.max(1, Number(limit) || MAX_FILES), MAX_FILES),
    ),
  );

  ipcMain.handle("palette:create-path", async (event, target: string, what: string) => {
    if (typeof target !== "string" || (what !== "file" && what !== "folder")) {
      return { ok: false, error: "invalid request" };
    }
    const roots = (await rootsOf(event)).map((r) => r.path);
    const result = await createInRoots(roots, target, what);
    if (result.ok) files.invalidate(result.path);
    return result;
  });

  ipcMain.handle("palette:history", () => history.read());

  ipcMain.handle("palette:record", (_event, pick: unknown) => {
    if (!isPick(pick)) return history.read();
    return history.record(pick, Date.now());
  });
}
