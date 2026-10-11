/**
 * FileOpenHandler — handles file opening for the openp41ge:open-file event.
 *
 * Operates at the window level — no worksets. Each window has its own
 * grid and tab placements.
 *
 * Preview vs permanent behavior follows VS Code's model:
 *   - pinned=false (unpinned): opens as a preview tab.
 *   - pinned=true: opens as a permanent tab.
 *   - Second click on a preview tab → pins it (promotes to permanent).
 */

import type { IFileOpenHandler } from "../interfaces/file-open-handler";
import type { ICommandBus } from "../interfaces/command-bus";
import type { IWorkspaceStateManager } from "../interfaces/workspace-state-manager";

import type { Tab } from "../../layout/types";

import { createLogger } from "openp41ge-core-logger";
import { Openp41geTabsEventHandler } from "./openp41ge-tabs-event-handler";
import type { TabMountManager } from "./tab-mount-manager";

const log = createLogger("openp41ge", "file-open-handler");

export class FileOpenHandler implements IFileOpenHandler {
  private _commandBus: ICommandBus | null = null;
  private _workspaceState: IWorkspaceStateManager | null = null;
  private _mountManager: TabMountManager | null = null;

  init(
    commandBus: ICommandBus,
    workspaceState: IWorkspaceStateManager,
    mountManager?: TabMountManager,
  ): void {
    this._commandBus = commandBus;
    this._workspaceState = workspaceState;
    this._mountManager = mountManager ?? null;
  }

  handleOpenFile(e: CustomEvent): void {
    const detail = e.detail || {};
    const filePath = detail.path;
    if (!filePath) return;
    let pinned: boolean;
    if (typeof detail.pinned === "boolean") {
      pinned = detail.pinned;
    } else {
      pinned = (detail.mode || "preview") !== "preview";
    }
    const col = detail.col;
    // Optional externally-provided search highlight (e.g. the Git sidebar's
    // current query) — carried on the new tab's config and applied by the file
    // editor after its buffer loads.
    const search = (detail.search ?? undefined) as
      { query?: string; regex?: boolean; caseSensitive?: boolean } | undefined;
    // Optional line/column to reveal (Explorer content-search match rows).
    const line = typeof detail.line === "number" ? detail.line : undefined;
    const column = typeof detail.column === "number" ? detail.column : undefined;
    const matchIndex = typeof detail.matchIndex === "number" ? detail.matchIndex : undefined;
    const tabConfig =
      search || line !== undefined || column !== undefined || matchIndex !== undefined
        ? {
            ...(search ? { search } : {}),
            ...(line !== undefined ? { line } : {}),
            ...(column !== undefined ? { column } : {}),
            ...(matchIndex !== undefined ? { matchIndex } : {}),
          }
        : undefined;
    log.info("open", filePath, pinned ? "pinned" : "unpinned");

    const myWindowId = window.openp41ge.workspace.getWindowId();
    if (!myWindowId) {
      log.warn("open skipped — no window context");
      return;
    }
    const targetCol = col !== undefined ? col : this._getLastActiveCellCol();
    const fileName = e.detail.name || "";

    // A content-search match click (line provided) should jump to a file that
    // is already open anywhere in the window, reusing the tab and revealing
    // the matching line — rather than opening a duplicate (VS Code behaviour).
    if (line !== undefined) {
      const existingAnywhere = this._findFileViewerAnywhere(filePath);
      if (existingAnywhere) {
        const ctrl = this._mountManager?.getController(existingAnywhere);
        if (ctrl && "revealLine" in ctrl) {
          (
            ctrl as unknown as {
              revealLine(l: number, c?: number, s?: unknown, mi?: number): void;
            }
          ).revealLine(line, column, search, matchIndex);
        }
        log.info("jump to existing tab at line", existingAnywhere, line);
        this._commandBus!.dispatch("activateTabInCell", myWindowId, existingAnywhere);
        return;
      }
    }

    // Step 1: Check if this file is already open in the target cell.
    // - Double-click (pinned=true) on a preview tab → pin it
    // - Single-click (pinned=false) on a preview tab → just activate
    // - Any click on a pinned tab → just activate
    const existingTabId = this._findFileViewerInCell(filePath, targetCol);
    if (existingTabId) {
      const tab = this._getTab(existingTabId);
      if (tab && tab.isPreview && pinned) {
        log.info("pin preview tab via double-click", existingTabId);
        this._commandBus!.dispatch("pinTabInCell", myWindowId, targetCol, existingTabId);
      } else {
        log.info("activate existing tab", existingTabId);
        this._commandBus!.dispatch("activateTabInCell", myWindowId, existingTabId);
      }
      return;
    }

    // Step 2: File not in this cell. Check if we should replace the preview slot.
    // Delegate to actionOpenFile which handles preview replacement via openTabInCell.
    if (!pinned) {
      const existingPreviewTabId = this._findPreviewInCell(targetCol);
      if (existingPreviewTabId) {
        log.info("replace preview via actionOpenFile", existingPreviewTabId);
        this._commandBus!.dispatch(
          "actionOpenFile",
          myWindowId,
          "file-viewer",
          fileName,
          filePath,
          targetCol,
          false,
          tabConfig,
        );
        return;
      }
    }

    // Step 3: Open new tab
    log.info("open new tab", pinned ? "pinned" : "unpinned");
    this._commandBus!.dispatch(
      "actionOpenFile",
      myWindowId,
      "file-viewer",
      fileName,
      filePath,
      targetCol,
      pinned,
      tabConfig,
    );
  }

  openPreview(filePath: string, fileName: string): void {
    log.info("openPreview", filePath);
    this._openFile(filePath, fileName, false);
  }

  openEdit(filePath: string, fileName: string): void {
    log.info("openEdit", filePath);
    this._openFile(filePath, fileName, true);
  }

  private _openFile(filePath: string, fileName: string, pinned: boolean): void {
    const myWindowId = window.openp41ge.workspace.getWindowId();
    if (!myWindowId) {
      log.warn("openFile skipped — no window context");
      return;
    }
    const targetCol = this._getLastActiveCellCol();
    this._commandBus!.dispatch(
      "actionOpenFile",
      myWindowId,
      "file-viewer",
      fileName,
      filePath,
      targetCol,
      pinned,
    );
  }

  private _getLastActiveCellCol(): number {
    const myWindowId = window.openp41ge.workspace.getWindowId();
    if (!myWindowId) return 0;

    const col = Openp41geTabsEventHandler.getLastFocusedCol(myWindowId);

    // Validate the column exists in the current grid. If not (e.g. compactGrid
    // shifted placements without updating lastFocusedCol), fall back to the
    // first available placement.
    const ws = this._workspaceState?.getWorkspace();
    if (ws) {
      const win = ws.windows.find((w) => w.id === myWindowId);
      if (win) {
        const hasCol = win.grid.placements.some(
          (p) => p.position.row === 0 && p.position.col === col,
        );
        if (hasCol) return col;
        // Fall back to first existing column
        const fallback = win.grid.placements.find((p) => p.position.row === 0);
        if (fallback) return fallback.position.col;
      }
    }
    return 0;
  }

  /** Find a file-viewer tab for `filePath` anywhere in this window. */
  private _findFileViewerAnywhere(filePath: string): string | null {
    const ws = this._workspaceState!.getWorkspace();
    if (!ws) return null;
    const myWindowId = window.openp41ge.workspace.getWindowId();
    const win = ws.windows.find((w) => w.id === myWindowId);
    if (!win) return null;
    const tabs = ws.editorTabs as Record<string, Tab | undefined>;
    for (const pl of win.grid.placements) {
      for (const tabId of pl.tabIds) {
        const tab = tabs[tabId];
        if (tab && tab.appType === "file-viewer" && tab.config?.filePath === filePath) {
          return tabId;
        }
      }
    }
    return null;
  }

  private _findFileViewerInCell(filePath: string, col: number): string | null {
    const ws = this._workspaceState!.getWorkspace();
    if (!ws) return null;
    const myWindowId = window.openp41ge.workspace.getWindowId();
    const win = ws.windows.find((w) => w.id === myWindowId);
    if (!win) return null;

    const pl = win.grid.placements.find((p) => p.position.row === 0 && p.position.col === col);
    if (!pl) return null;

    const tabs = ws.editorTabs as Record<string, Tab | undefined>;
    for (const tabId of pl.tabIds) {
      const tab = tabs[tabId];
      if (tab && tab.appType === "file-viewer" && tab.config?.filePath === filePath) {
        return tabId;
      }
    }
    return null;
  }

  private _findPreviewInCell(col: number): string | null {
    const ws = this._workspaceState!.getWorkspace();
    if (!ws) return null;
    const myWindowId = window.openp41ge.workspace.getWindowId();
    const win = ws.windows.find((w) => w.id === myWindowId);
    if (!win) return null;

    const pl = win.grid.placements.find((p) => p.position.row === 0 && p.position.col === col);
    if (!pl) return null;

    const tabs = ws.editorTabs as Record<string, Tab | undefined>;
    for (const tabId of pl.tabIds) {
      const tab = tabs[tabId];
      if (tab && tab.appType === "file-viewer" && tab.isPreview) {
        return tabId;
      }
    }
    return null;
  }

  private _getTab(tabId: string): Tab | null {
    const ws = this._workspaceState!.getWorkspace();
    if (!ws) return null;
    const tabs = ws.editorTabs as Record<string, Tab | undefined>;
    return tabs[tabId] ?? null;
  }
}
