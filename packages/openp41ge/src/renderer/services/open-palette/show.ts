/**
 * show.ts — open the palette (Cmd+N) in this window, wired to the live
 * registries, sources and actions. A second Cmd+N while it is open focuses
 * it. Other shortcuts are off while it is open.
 */

import type { TabId, Workspace } from "../../../layout/types";
import type { IKeyboardManager } from "../../interfaces/keyboard-manager";
import "../../components/openp41ge-open-palette";
import type {
  Openp41geOpenPalette,
  OpenPaletteDeps,
} from "../../components/openp41ge-open-palette";
import { emptyPaletteHistory } from "../../../shared/open-palette-ranking";
import { resolveCmdWTarget } from "../cmd-w-target";
import { openEntry, runCreate } from "./actions";
import { liveCatalog } from "./catalog";
import { gatherEntries, resolveCreateTarget } from "./sources";

/** The file of the focused grid tab, if it shows one. */
function focusedFile(ws: Workspace | null, winId: string): string | null {
  const target = resolveCmdWTarget(ws, winId);
  if (target?.kind !== "close-tab") return null;
  const filePath = ws?.editorTabs[target.tabId as TabId]?.config?.filePath;
  return typeof filePath === "string" ? filePath : null;
}

export function showOpenPalette(
  keyboard: IKeyboardManager,
  getWorkspace: () => Workspace | null,
): void {
  const open = document.querySelector<Openp41geOpenPalette>("openp41ge-open-palette");
  if (open) {
    open.focusInput();
    return;
  }
  const winId = window.openp41ge?.workspace?.getWindowId?.() ?? "";
  const createTarget = resolveCreateTarget(focusedFile(getWorkspace(), winId)).catch(() => null);
  const options = (query: string, newColumn: boolean) => ({
    winId,
    newColumn,
    query,
    catalog: liveCatalog,
  });
  const deps: OpenPaletteDeps = {
    catalog: liveCatalog,
    history: async () => (await window.openp41ge?.palette?.history()) ?? emptyPaletteHistory(),
    gather: async (query, onEntries) =>
      gatherEntries(query, { createTarget: await createTarget }, onEntries),
    open: (entry, tabType, newColumn, query) =>
      openEntry(entry, tabType, options(query, newColumn)),
    create: (entry, query) => runCreate(entry, options(query, false)),
    now: () => Date.now(),
  };
  const palette = document.createElement("openp41ge-open-palette") as Openp41geOpenPalette;
  palette.deps = deps;
  keyboard.pushModal();
  palette.onclose = () => keyboard.popModal();
  document.body.appendChild(palette);
}
