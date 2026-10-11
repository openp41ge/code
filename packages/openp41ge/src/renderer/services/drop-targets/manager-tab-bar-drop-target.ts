/**
 * ManagerTabBarDropTarget — drop target for the Application Management window's
 * tab bar (`.wm-tabbar`).
 *
 * Only manager-tab drags may land here. A successful drop fires a composed
 * `manager-tab-reorder` CustomEvent on the bar, which the host
 * (<openp41ge-window-manager>) listens for to reorder its `_openTabs` state.
 *
 * While the cursor hovers the bar, a standard blue vertical drop indicator
 * marks the insertion gap — identical to the grid/sidebar tab-bar indicator.
 * The indicator lives in the bar's shadow DOM (the component's own shadow
 * root), so the target holds a direct reference to the bar element and appends
 * the line there; it never relies on document-level querying.
 */

import type {
  IDragSource,
  IDropTarget,
  TargetFeedback,
  DragResult,
} from "../../interfaces/drag-handler";

/** Event fired on the bar when a manager tab is dropped to reorder it. */
export const MANAGER_TAB_REORDER_EVENT = "manager-tab-reorder";

/** Blue insert line — matches the grid/sidebar tab-bar insert marker. The
 *  look (3px solid blue + glow) is applied directly on the element, and the
 *  class remains only as an identity marker for drag-capture hiding. */
const INDICATOR_CLASS = "wm-tab-drop-indicator";

export function managerTabButtons(bar: HTMLElement): HTMLElement[] {
  return Array.from(bar.querySelectorAll<HTMLElement>(".wm-tab"));
}

/** True when the bar is taller than wide (a vertical sidebar, not a top bar). */
function barIsVertical(bar: HTMLElement): boolean {
  return bar.offsetHeight > bar.offsetWidth;
}

/** Compute the insertion index for the pointer within the bar (0..tabs.length).
 *  Uses the bar's dominant axis so it works both as the original top tab-bar
 *  (horizontal) and as the left sidebar (vertical). */
export function managerDropIndex(bar: HTMLElement, clientX: number, clientY?: number): number {
  const barRect = bar.getBoundingClientRect();
  const vertical = barIsVertical(bar);
  const pos = vertical ? (clientY ?? barRect.top) - barRect.top : clientX - barRect.left;
  const buttons = managerTabButtons(bar);
  for (let i = 0; i < buttons.length; i++) {
    const r = buttons[i].getBoundingClientRect();
    const mid = vertical ? r.top - barRect.top + r.height / 2 : r.left - barRect.left + r.width / 2;
    if (pos < mid) return i;
  }
  return buttons.length;
}

export class ManagerTabBarDropTarget implements IDropTarget {
  readonly type = "manager-tab-bar";
  readonly element: HTMLElement;

  private _indicator: HTMLElement | null = null;
  /** The bar is a scroll container in the component's shadow root; give it a
   *  positioning context so the absolutely-positioned indicator can live in
   *  its content coordinate space (and scroll with the tabs). */
  private _positioned = false;

  constructor(barEl: HTMLElement) {
    this.element = barEl;
  }

  onHover(source: IDragSource, clientX: number, clientY: number): TargetFeedback | null {
    // Only manager tabs can be dropped on a management tab bar.
    if (source.type !== "manager-tab") return null;
    this._showIndicator(clientX, clientY);
    return { cssClass: "wm-tabbar--drop-active", overTabBar: true };
  }

  onDrop(source: IDragSource, clientX: number, clientY: number): Promise<DragResult> {
    if (source.type !== "manager-tab") {
      this.onLeave();
      return Promise.resolve({ success: false, reason: "unsupported source" });
    }
    const data = source.getDragData();
    const tabId = (data as { tabId?: string }).tabId;
    if (!tabId) {
      this.onLeave();
      return Promise.resolve({ success: false, reason: "missing tabId" });
    }

    const fromIndex = managerTabButtons(this.element).findIndex(
      (btn) => btn.getAttribute("data-manager-tab") === tabId,
    );
    const dropIndex = managerDropIndex(this.element, clientX, clientY);
    // Removing the tab first shifts a forward insertion down by one.
    const toIndex = fromIndex >= 0 && dropIndex > fromIndex ? dropIndex - 1 : dropIndex;

    this.onLeave();
    this._fire({
      tabId,
      fromIndex,
      toIndex: Math.max(0, toIndex),
    });
    return Promise.resolve({ success: true });
  }

  onLeave(): void {
    this._hideIndicator();
  }

  /** Show the blue insertion line at the gap under the pointer. Used for the
   *  cross-window ghost preview (no live source exists locally). */
  showIndicator(clientX: number, clientY?: number): void {
    this._ensurePositioned();
    const vertical = barIsVertical(this.element);
    const index = managerDropIndex(this.element, clientX, clientY);
    const buttons = managerTabButtons(this.element);
    const gap =
      index < buttons.length
        ? vertical
          ? buttons[index].offsetTop
          : buttons[index].offsetLeft
        : vertical
          ? this.element.scrollHeight
          : this.element.scrollWidth;
    const ind = this._getIndicator();
    if (vertical) {
      ind.style.left = "0";
      ind.style.width = "100%";
      ind.style.height = "3px";
      ind.style.top = `${Math.max(0, gap - 1)}px`;
    } else {
      ind.style.top = "0";
      ind.style.height = "100%";
      ind.style.width = "3px";
      ind.style.left = `${Math.max(0, gap - 1)}px`;
    }
    ind.style.display = "block";
  }

  private _ensurePositioned(): void {
    if (!this._positioned) {
      this._positioned = true;
      this.element.style.position = "relative";
    }
  }

  private _showIndicator(clientX: number, clientY: number): void {
    this.showIndicator(clientX, clientY);
  }

  private _hideIndicator(): void {
    if (this._indicator) {
      this._indicator.style.display = "none";
    }
  }

  private _fire(detail: { tabId: string; fromIndex: number; toIndex: number }): void {
    const event = new CustomEvent(MANAGER_TAB_REORDER_EVENT, {
      bubbles: true,
      composed: true,
      detail,
    });
    this.element.dispatchEvent(event);
  }

  /** Lazily create the indicator element inside the bar (shadow DOM). */
  private _getIndicator(): HTMLElement {
    if (this._indicator) return this._indicator;
    // A plain div (NOT a <drop-line>): the drop-line renders in shadow DOM with
    // no slot, so its appended children would never paint. A plain div's
    // light-DOM children render — matching the grid/sidebar indicators exactly.
    const el = document.createElement("div");
    el.className = INDICATOR_CLASS;
    el.style.cssText =
      "position:absolute;top:0;bottom:0;width:3px;background:rgb(74,158,255);box-shadow:0 0 10px rgba(74,158,255,0.6);display:none;pointer-events:none;z-index:9;border-radius:0;";
    this.element.appendChild(el);
    this._indicator = el;
    return el;
  }
}
