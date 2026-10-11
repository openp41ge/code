/**
 * File drop handler — manages file-tree drag-and-drop onto the grid.
 *
 * Receives native HTML DragEvent and translates them into openp41ge-core-tabs
 * grid-open-tab events, which the Openp41geTabsEventHandler dispatches
 * as workspace commands.
 *
 * Visual ghost overlays for file drops are handled by the <tab-grid>
 * component's built-in GridDropTarget.
 */

import type { IFileDropHandler } from "../interfaces/file-drop-handler";
import type { ICommandBus } from "../interfaces/command-bus";
import { Openp41geTabsEventHandler } from "./openp41ge-tabs-event-handler";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "file-drop-handler");

export class FileDropHandler implements IFileDropHandler {
  private _commandBus: ICommandBus | null = null;

  init(commandBus: ICommandBus): void {
    this._commandBus = commandBus;
  }

  handleDragOver(e: DragEvent, _gridEl: HTMLElement): void {
    if (!this._isRelevantDrag(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  }

  handleDragLeave(e: DragEvent, gridEl: HTMLElement): void {
    if (!this._isRelevantDrag(e)) return;
    if (gridEl.contains(e.relatedTarget as Node)) return;
    // No visual overlay to clean up — GridDropTarget handles that.
  }

  handleDrop(e: DragEvent, gridEl: HTMLElement): void {
    if (!this._isRelevantDrag(e)) return;
    e.preventDefault();

    const filePath = e.dataTransfer?.getData("text/plain");
    if (filePath) {
      this._handleFileDrop(filePath, gridEl, e);
    }
  }

  private _handleFileDrop(filePath: string, gridEl: HTMLElement, _e: DragEvent): void {
    const winId = this._resolveWinId(gridEl);
    const targetCol = this._resolveTargetCol(gridEl, _e);

    // Dispatch the grid-open-tab event that Openp41geTabsEventHandler handles
    gridEl.dispatchEvent(
      new CustomEvent("grid-open-tab", {
        bubbles: true,
        detail: {
          winId,
          tabType: "file-viewer",
          tabConfig: { filePath },
          targetCol,
          pinned: true,
        },
      }),
    );
  }

  private _isRelevantDrag(e: DragEvent): boolean {
    try {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i++) {
        const t = String(types[i]);
        if (t === "text/plain") return true;
      }
      return false;
    } catch (err) {
      log.debug("file-drop type check failed:", err);
      return false;
    }
  }

  private _resolveWinId(gridEl: HTMLElement): string {
    const tabGrid = gridEl.closest("tab-grid") as (HTMLElement & { winId?: string }) | null;
    return tabGrid?.winId || "";
  }

  /** Determine the target column based on cursor position or last focused. */
  private _resolveTargetCol(gridEl: HTMLElement, _e: DragEvent): number {
    const tabGrid = gridEl.closest("tab-grid") as (HTMLElement & { winId?: string }) | null;
    if (tabGrid?.winId) {
      return Openp41geTabsEventHandler.getLastFocusedCol(tabGrid.winId);
    }
    return 0;
  }
}
