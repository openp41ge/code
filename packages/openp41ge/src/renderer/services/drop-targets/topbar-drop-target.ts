/**
 * TopBarDropTarget — handles drops on the top bar.
 *
 * Visual feedback:
 *   - Hover near the edge of a workset item → show a vertical drop indicator
 *     (position marker between worksets)
 *   - Hover in the center zone of a workset item → show a blue outline around
 *     the workset, indicating "wait here to switch to this workset"
 *   - After 500ms hover in the center zone → auto-switch to that workset
 *
 * The blue outline is the target's responsibility — it manages its own
 * CSS classes on the workset bar elements.
 */

import type {
  IDragSource,
  IDropTarget,
  DragResult,
  TargetFeedback,
} from "../../interfaces/drag-handler";
import { isOpenp41geTopbar } from "../../interfaces/element-guards";

/**
 * Visual state for hover zones on a workset bar item.
 *
 *    [left-edge-zone] [center-zone] [right-edge-zone]
 *    ├── 25% ──│├────── 50% ──────│├── 25% ──┤
 *
 * Edge zones: show drop indicator (insert position)
 * Center zone: show blue outline + hover-to-switch
 */
const EDGE_ZONE_RATIO = 0.25;

export class TopBarDropTarget implements IDropTarget {
  readonly type = "openp41ge-bar";

  readonly element: HTMLElement;
  private _commandBus: { dispatch: (fn: string, ...args: unknown[]) => void };
  private _indicatorEl: HTMLElement | null = null;
  private _highlightedWorksetId: string | null = null;
  private _highlightedWorksetEl: HTMLElement | null = null;
  private _hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  private _isHoveringCenter = false;

  constructor(
    openp41geBarEl: HTMLElement,
    commandBus: { dispatch: (fn: string, ...args: unknown[]) => void },
  ) {
    this.element = openp41geBarEl;
    this._commandBus = commandBus;
    this._ensureIndicator();
  }

  onHover(source: IDragSource, clientX: number, _clientY: number): TargetFeedback | null {
    const pageData = source.getDragData();
    if (pageData.type !== "tab" && pageData.type !== "openp41ge-tab") return null;

    // Find which workset item is under the cursor
    const worksetItems = this.element.querySelectorAll<HTMLElement>("[data-workset-id]");
    const rect = this.element.getBoundingClientRect();
    const relX = clientX - rect.left;

    let targetWorksetId: string | null = null;
    let targetWorksetEl: HTMLElement | null = null;
    let withinCenter = false;
    let dropIdx = 0;

    // Determine which workset item we're hovering over
    for (const item of worksetItems) {
      const itemRect = item.getBoundingClientRect();
      const itemRelX = clientX - itemRect.left;
      const itemRelCenter = itemRelX / itemRect.width;

      if (clientX >= itemRect.left && clientX <= itemRect.right) {
        targetWorksetId = item.getAttribute("data-workset-id");
        targetWorksetEl = item;

        if (itemRelCenter >= EDGE_ZONE_RATIO && itemRelCenter <= 1 - EDGE_ZONE_RATIO) {
          withinCenter = true;
          // Drop index is after this workset
          dropIdx = Array.from(worksetItems).indexOf(item) + 1;
          break;
        }

        // Edge zone — calculate which side
        if (itemRelCenter < EDGE_ZONE_RATIO) {
          dropIdx = Array.from(worksetItems).indexOf(item);
        } else {
          dropIdx = Array.from(worksetItems).indexOf(item) + 1;
        }
        break;
      }
    }

    // If cursor is not within any workset item (gap between worksets or empty
    // space past the last workset), determine the correct drop index based
    // on the cursor's X position relative to all workset items.
    if (!targetWorksetId && worksetItems.length > 0) {
      // Check if we're past the last workset
      const lastRect = worksetItems[worksetItems.length - 1].getBoundingClientRect();
      if (clientX > lastRect.right) {
        dropIdx = worksetItems.length;
      }
      // Check if we're before the first workset
      else if (clientX < worksetItems[0].getBoundingClientRect().left) {
        dropIdx = 0;
      }
      // Check if we're in a gap between two worksets
      else {
        for (let i = 0; i < worksetItems.length - 1; i++) {
          const leftRect = worksetItems[i].getBoundingClientRect();
          const rightRect = worksetItems[i + 1].getBoundingClientRect();
          if (clientX > leftRect.right && clientX < rightRect.left) {
            dropIdx = i + 1;
            break;
          }
        }
      }
    }

    // Update visual state
    this._clearHighlight();

    if (withinCenter && targetWorksetEl && targetWorksetId) {
      // Center zone — show blue outline
      targetWorksetEl.style.outline = "2px solid #4a9eff";
      targetWorksetEl.style.outlineOffset = "-2px";
      targetWorksetEl.style.borderRadius = "3px";
      this._highlightedWorksetId = targetWorksetId;
      this._highlightedWorksetEl = targetWorksetEl;
      this._isHoveringCenter = true;

      // Schedule auto-switch after 500ms
      if (
        targetWorksetId !==
        (this._hoverTimeout as unknown as Record<string, string> | null)?.["worksetId"]
      ) {
        if (this._hoverTimeout) {
          clearTimeout(this._hoverTimeout);
          this._hoverTimeout = null;
        }

        const winId = pageData.winId;
        this._hoverTimeout = setTimeout(() => {
          if (this._highlightedWorksetId) {
            this._commandBus.dispatch("switchWorkset", winId, this._highlightedWorksetId);
          }
        }, 500) as unknown as ReturnType<typeof setTimeout>;
        (this._hoverTimeout as unknown as Record<string, unknown>)["worksetId"] = targetWorksetId;
      }

      // Hide edge indicator
      this._hideIndicator();
    } else {
      // Edge zone — show drop indicator
      this._isHoveringCenter = false;
      if (this._hoverTimeout) {
        clearTimeout(this._hoverTimeout);
        this._hoverTimeout = null;
      }
      this._showIndicator(dropIdx, relX);
    }

    return null; // Visuals are managed directly via DOM, no need for feedback object
  }

  async onDrop(source: IDragSource, clientX: number, _clientY: number): Promise<DragResult> {
    // Save center-zone state BEFORE clearing — _clearHighlight resets
    // _isHoveringCenter and _highlightedWorksetId, which we need for
    // the center-zone drop decision.
    const wasCenter = this._isHoveringCenter;
    const targetWorksetId = this._highlightedWorksetId;

    this._clearHighlight();
    this._hideIndicator();
    if (this._hoverTimeout) {
      clearTimeout(this._hoverTimeout);
      this._hoverTimeout = null;
    }

    const pageData = source.getDragData();
    if (pageData.type !== "tab" && pageData.type !== "openp41ge-tab") {
      this._ensureIndicator();
      return { success: false, reason: "only tabs can be dropped on workset bar" };
    }

    // ── Center zone drop: insert tab into the targeted workset's grid ──────
    if (wasCenter && targetWorksetId) {
      this._commandBus.dispatch(
        "moveTabBetweenCells",
        pageData.winId,
        pageData.worksetId,
        pageData.tabId,
        pageData.winId,
        targetWorksetId,
        0,
        0,
        undefined,
        undefined,
      );
      return { success: true };
    }

    // ── Edge zone drop: create a new workset with the tab ──────────────────
    const dropIdx = isOpenp41geTopbar(this.element)
      ? (this.element.getDropIndex?.(clientX) ?? 0)
      : 0;

    this._commandBus.dispatch("createWorksetWithTab", pageData.winId, pageData.tabId, "", dropIdx);

    return { success: true };
  }

  onLeave(): void {
    this._clearHighlight();
    this._hideIndicator();
    if (this._hoverTimeout) {
      clearTimeout(this._hoverTimeout);
      this._hoverTimeout = null;
    }
    this._isHoveringCenter = false;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private _ensureIndicator(): void {
    let el = this.element.querySelector<HTMLElement>(".topbar-drop-indicator");
    if (!el) {
      el = document.createElement("div");
      el.className = "topbar-drop-indicator";
      // Match the workset reorder indicator style: fixed positioning with
      // viewport-relative coordinates, 5px wide, rounded corners.
      el.style.cssText =
        "position:fixed;width:5px;background:var(--accent-hover);border-radius:2px;pointer-events:none;z-index:1000;display:none;";
      this.element.appendChild(el);
    }
    this._indicatorEl = el;
  }

  private _showIndicator(dropIdx: number, _relX: number): void {
    if (!this._indicatorEl) return;
    // Use viewport-relative coordinates (position:fixed) to match the
    // workset reorder indicator style. This avoids coordinate-system
    // mismatches caused by the traffic-light spacer and nav buttons.
    const worksetItems = this.element.querySelectorAll<HTMLElement>("[data-workset-id]");

    // Compute the scroll bar's viewport rect for vertical centering
    const bar = this.element.querySelector(".topbar-scroll");
    const barRect =
      bar instanceof HTMLElement
        ? bar.getBoundingClientRect()
        : this.element.getBoundingClientRect();

    let left: number;
    if (worksetItems.length === 0) {
      left = barRect.left - 3;
    } else if (dropIdx <= 0) {
      left = worksetItems[0].getBoundingClientRect().left - 3;
    } else if (dropIdx >= worksetItems.length) {
      left = worksetItems[worksetItems.length - 1].getBoundingClientRect().right - 3;
    } else {
      left = worksetItems[dropIdx - 1].getBoundingClientRect().right - 3;
    }

    const top = barRect.top + barRect.height * 0.2;
    const height = barRect.height * 0.6;

    this._indicatorEl.style.display = "block";
    this._indicatorEl.style.left = `${left}px`;
    this._indicatorEl.style.top = `${top}px`;
    this._indicatorEl.style.height = `${height}px`;
  }

  private _hideIndicator(): void {
    if (this._indicatorEl) {
      this._indicatorEl.style.display = "none";
    }
  }

  private _clearHighlight(): void {
    if (this._highlightedWorksetEl) {
      this._highlightedWorksetEl.style.outline = "";
      this._highlightedWorksetEl.style.outlineOffset = "";
      this._highlightedWorksetEl.style.borderRadius = "";
      this._highlightedWorksetEl = null;
    }
    this._highlightedWorksetId = null;
    this._isHoveringCenter = false;
  }
}
