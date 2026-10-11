/**
 * TabBarDropTarget — handles drops on a cell's tab bar for reordering.
 *
 * Fires CustomEvents on `this.element` for drop operations.
 * The host application (openp41ge) listens for these events and routes
 * them to IPC / workspace operations.
 *
 * Events (bubbling):
 *   tab-bar-reorder    — { winId, col, fromIndex, toIndex }
 *   tab-bar-move-cell  — { sourceWinId, tabId, targetWinId, targetCol, dropIndex }
 *   grid-open-tab      — { winId, tabType, tabConfig, targetCol } (open-tab/file
 *                        drops, mirroring a drop on the grid surface); typed
 *                        `payload` drops also carry `insertAt`, the tab-bar
 *                        index under the cursor
 */

import type { IDragSource, IDropTarget, DragResult, TargetFeedback } from "../interfaces";
import { getDropIndexInBar, getTabButtonsInBar } from "../boundary";
import { GRID_EVENTS, resolvePayloadOpen } from "./grid-drop-target";

/**
 * Event types dispatched by TabBarDropTarget.
 */
export const TAB_BAR_EVENTS = {
  REORDER: "tab-bar-reorder",
  MOVE_CELL: "tab-bar-move-cell",
} as const;

export class TabBarDropTarget implements IDropTarget {
  readonly type = "tab-bar";
  readonly element: HTMLElement;

  readonly winId: string;
  private _col: number;
  private _indicatorEl: HTMLElement | null = null;

  constructor(barEl: HTMLElement, winId: string, col: number) {
    this.element = barEl;
    this.winId = winId;
    this._col = col;
  }

  /** The grid column this tab bar belongs to (read by the host so it can show
   *  the wash-only drop box on the right cell while the cursor is over the bar). */
  get col(): number {
    return this._col;
  }

  onHover(source: IDragSource, clientX: number, _clientY: number): TargetFeedback | null {
    // A payload that nothing can open here gets no insert line.
    if (!this._payloadOpenFor(source)) {
      this._hideIndicator();
      return null;
    }
    const dropIndex = getDropIndexInBar(this.element, clientX);
    // A same-cell drag that lands on the tab's own position is a no-op
    // reorder — never show the insert line there (the drop would not move it).
    this._showIndicator(this._isNoOpReorder(source, dropIndex) ? -1 : dropIndex);
    return { indicatorKey: `tab-bar-${this.winId}-${this._col}`, overTabBar: true };
  }

  async onDrop(source: IDragSource, clientX: number, _clientY: number): Promise<DragResult> {
    this._hideIndicator();

    const data = source.getDragData();

    // A typed payload opens its resolved consumer AT the insert position.
    if (data.type === "payload") {
      const open = this._payloadOpenFor(source);
      if (!open || open === true) return { success: false, reason: "no consumer for payload" };
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: open.appType,
        tabConfig: open.tabConfig,
        targetCol: this._col,
        insertAt: getDropIndexInBar(this.element, clientX),
        pinned: true,
      });
      return { success: true };
    }

    // A stream (`open-tab`) or file dropped on the tab bar opens it in this
    // cell — mirroring a drop on the grid surface. The host listens for the
    // same `grid-open-tab` event the grid surface fires.
    if (data.type === "open-tab") {
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: data.appType,
        tabConfig: data.tabConfig ?? {},
        targetCol: this._col,
        pinned: true,
      });
      return { success: true };
    }

    if (data.type === "file") {
      this._fire(GRID_EVENTS.OPEN_TAB, {
        winId: this.winId,
        tabType: "file-viewer",
        tabConfig: { filePath: data.filePath },
        targetCol: this._col,
        pinned: true,
      });
      return { success: true };
    }

    if (data.type !== "tab") {
      return { success: false, reason: "only tabs can be dropped on tab bars" };
    }

    const dropIndex = getDropIndexInBar(this.element, clientX);
    const tabButtons = this.element.querySelectorAll<HTMLElement>(
      "openp41ge-tab-button, .tab-btn, [data-tab-id]",
    );
    const fromIndex = Array.from(tabButtons).findIndex(
      (btn) => btn.getAttribute("data-tab-id") === data.tabId,
    );

    if (fromIndex >= 0) {
      // Same cell — reorder within
      if (dropIndex !== fromIndex && dropIndex !== fromIndex + 1) {
        const adjustedDrop = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
        this._fire(TAB_BAR_EVENTS.REORDER, {
          winId: this.winId,
          col: this._col,
          fromIndex,
          toIndex: adjustedDrop,
        });
      }
      return { success: true };
    }

    // Cross-cell move
    this._fire(TAB_BAR_EVENTS.MOVE_CELL, {
      sourceWinId: data.winId,
      tabId: data.tabId,
      targetWinId: this.winId,
      targetCol: this._col,
      dropIndex,
    });
    return { success: true };
  }

  onLeave(): void {
    this._hideIndicator();
  }

  /** A same-cell reorder that would not change the tab's index (same
   *  position, or immediately after itself) is a no-op and must not show an
   *  indicator. Cross-cell drags (the dragged tab isn't in this bar) always
   *  show one. Mirrors onDrop's refusal condition. */
  private _isNoOpReorder(source: IDragSource, dropIndex: number): boolean {
    const data = source.getDragData();
    if (data?.type !== "tab") return false;
    const tabButtons = this.element.querySelectorAll<HTMLElement>(
      "openp41ge-tab-button, .tab-btn, [data-tab-id]",
    );
    const fromIndex = Array.from(tabButtons).findIndex(
      (btn) => btn.getAttribute("data-tab-id") === data.tabId,
    );
    if (fromIndex < 0) return false;
    return dropIndex === fromIndex || dropIndex === fromIndex + 1;
  }

  private _fire(type: string, detail: Record<string, unknown>): void {
    this.element.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  }

  /**
   * For a payload drag, what it opens here (null when nothing can); `true`
   * for every other drag type (not gated by the payload resolver).
   */
  private _payloadOpenFor(source: IDragSource): ReturnType<typeof resolvePayloadOpen> | true {
    const data = source.getDragData();
    if (data.type !== "payload") return true;
    return resolvePayloadOpen(data, { winId: this.winId, element: this.element });
  }

  private _showIndicator(dropIndex: number): void {
    if (!this._indicatorEl) {
      this._indicatorEl = document.createElement("div");
      this._indicatorEl.className = "tab-drop-indicator";
      this._indicatorEl.style.cssText =
        "position:absolute;top:0;bottom:0;width:3px;background:rgb(74,158,255);box-shadow:0 0 10px rgba(74,158,255,0.6);display:none;pointer-events:none;z-index:10;";
      this.element.appendChild(this._indicatorEl);
    }

    // Signal a no-op reorder by hiding the line entirely (no display/left set).
    if (dropIndex < 0) {
      this._hideIndicator();
      return;
    }

    // Use same element set as getDropIndexInBar — exclude injected overlays
    const tabs = getTabButtonsInBar(this.element);

    let pos: number;
    if (tabs.length === 0 || dropIndex <= 0) {
      pos = 0;
    } else if (dropIndex >= tabs.length) {
      const last = tabs[tabs.length - 1];
      pos = last.offsetLeft + last.offsetWidth;
    } else {
      // Shift left 1px so the 3px line is centered on the boundary (mirrors
      // the sidebar's indicator so both carry the same look).
      pos = tabs[dropIndex].offsetLeft - 1;
    }

    this._indicatorEl.style.display = "block";
    this._indicatorEl.style.left = `${pos}px`;
  }

  private _hideIndicator(): void {
    if (this._indicatorEl) {
      this._indicatorEl.style.display = "none";
    }
  }
}
