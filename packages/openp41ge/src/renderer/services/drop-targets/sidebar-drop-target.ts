/**
 * SidebarDropTarget — drop target for sidebar tab bars.
 *
 * When a system tab is dragged over a sidebar, this target shows a
 * visible ghost overlay (blue-tinted highlight) covering the entire
 * sidebar element, plus a precise drop indicator line on the tab bar.
 *
 * On drop, it fires a `sidebar-tab-drop` CustomEvent that the host
 * application routes to the workspace operation.
 *
 * Fires on `document`:
 *   sidebar-tab-drop — { tabId, sourceSide, targetSide, dropIndex, winId }
 */

import type {
  IDragSource,
  IDropTarget,
  DragResult,
  TargetFeedback,
} from "../../openp41ge-tabs-adapter";

// ─── Capture suppression ────────────────────────────────────────────────────
// While a sidebar-tab drag is capturing its bitmap ghost frame, the sidebar
// wide ghost overlay / drop indicator must not be painted into the snapshot.
// The host toggles this with setSidebarDropFeedbackSuppressed() around the
// capture (onHover would otherwise re-create the overlay synchronously right
// after the capture-frame cleanup, and capturePage samples it).
let _feedbackSuppressed = false;

export function setSidebarDropFeedbackSuppressed(v: boolean): void {
  _feedbackSuppressed = v;
}

import { SIDEBAR_DROP_EVENT, SIDEBAR_TAB_BUTTON_SELECTOR } from "openp41ge-core-constants";

export function getTabButtonsInSidebarBar(bar: HTMLElement): HTMLElement[] {
  return Array.from(bar.querySelectorAll(SIDEBAR_TAB_BUTTON_SELECTOR)).filter(
    (el): el is HTMLElement => {
      const htmlEl = el as HTMLElement;
      return !htmlEl.classList.contains("sidebar-drop-indicator-wrapper");
    },
  );
}

function getDropIndexInSidebarBar(bar: HTMLElement, clientX: number): number {
  const tabs = getTabButtonsInSidebarBar(bar);
  if (tabs.length === 0) {
    return 0;
  }

  let insertIndex = tabs.length;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i] as HTMLElement;
    const rect = tab.getBoundingClientRect();
    const midPoint = rect.left + rect.width / 2;

    if (clientX < midPoint) {
      insertIndex = i;
      break;
    }
  }

  return insertIndex;
}

export class SidebarDropTarget implements IDropTarget {
  readonly type = "sidebar-tab-bar";
  readonly element: HTMLElement;

  readonly winId: string;
  readonly side: "left" | "right";
  private _overlayEl: HTMLElement | null = null;
  private _indicatorEl: HTMLElement | null = null;

  constructor(barEl: HTMLElement, winId: string, side: "left" | "right") {
    this.element = barEl;
    this.winId = winId;
    this.side = side;
  }

  onHover(source: IDragSource, clientX: number, clientY: number): TargetFeedback | null {
    const data = source.getDragData() as { type?: string; side?: string; tabId?: string };
    const dropIndex = getDropIndexInSidebarBar(this.element, clientX);

    // Same-sidebar reorder that would not move the dragged tab: dropping right
    // before itself (dropIndex === fromIndex) or right after itself
    // (dropIndex === fromIndex + 1) is a no-op — the drop handler already
    // refuses it, so the PRECISE vertical bar must not advertise it. The
    // sidebar-wide overlay still shows, so hovering visibly targets the
    // sidebar; only the insert-bar is suppressed.
    const isSameSide =
      data.type === "system-tab" && data.side === this.side && typeof data.tabId === "string";
    const fromIndex = isSameSide
      ? getTabButtonsInSidebarBar(this.element).findIndex(
          (btn) => btn.getAttribute("data-sidebar-tab-id") === data.tabId,
        )
      : -1;
    const noOpReorder = fromIndex >= 0 && (dropIndex === fromIndex || dropIndex === fromIndex + 1);

    // Only show the precise drop indicator when cursor is directly over the
    // tab bar AND the bar has at least one tab. When the sidebar is empty its
    // tab bar is visually hidden (only the `+` button row shows), so the
    // tab-bar insert line must not appear — only the sidebar-wide overlay.
    const hasTabs = getTabButtonsInSidebarBar(this.element).length > 0;
    const barRect = this.element.getBoundingClientRect();
    const isOverTabBar = clientY >= barRect.top && clientY <= barRect.bottom;

    this._showOverlay(dropIndex, isOverTabBar && !noOpReorder && hasTabs, isOverTabBar);
    return { indicatorKey: `sidebar-bar-${this.winId}-${this.side}`, overTabBar: isOverTabBar };
  }

  async onDrop(source: IDragSource, clientX: number, clientY: number): Promise<DragResult> {
    this._hideOverlay();

    const data = source.getDragData() as Record<string, unknown>;
    if (data.type !== "system-tab") {
      return { success: false, reason: "only system tabs can be dropped on sidebar tab bars" };
    }

    // Position only matters while hovering the tab bar. Dropping anywhere on
    // the sidebar body/cell below always APPENDS to the end of the tab bar.
    const barRect = this.element.getBoundingClientRect();
    const overTabBar = clientY >= barRect.top && clientY <= barRect.bottom;
    const tabs = getTabButtonsInSidebarBar(this.element);
    const dropIndex = overTabBar ? getDropIndexInSidebarBar(this.element, clientX) : tabs.length;
    const sourceSide = data.side as "left" | "right";

    // Same sidebar — reorder
    if (sourceSide === this.side) {
      const tabButtons = getTabButtonsInSidebarBar(this.element);
      const fromIndex = tabButtons.findIndex(
        (btn) => btn.getAttribute("data-sidebar-tab-id") === data.tabId,
      );

      if (fromIndex >= 0) {
        if (dropIndex !== fromIndex && dropIndex !== fromIndex + 1) {
          const adjustedDrop = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
          this._fire(SIDEBAR_DROP_EVENT, {
            tabId: data.tabId,
            sourceSide,
            targetSide: this.side,
            dropIndex: adjustedDrop,
            winId: this.winId,
          });
        }
      }
      return { success: true };
    }

    // Cross-sidebar move
    this._fire(SIDEBAR_DROP_EVENT, {
      tabId: data.tabId,
      sourceSide,
      targetSide: this.side,
      dropIndex,
      winId: this.winId,
    });
    return { success: true };
  }

  onLeave(): void {
    this._hideOverlay();
  }

  private _fire(type: string, detail: Record<string, unknown>): void {
    document.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  }

  /**
   * Find the <openp41ge-sidebar> host element that contains the tab bar.
   */
  private _getSidebarHost(): HTMLElement | null {
    return this.element.closest("openp41ge-sidebar");
  }

  /**
   * Show a visible drop overlay:
   * - Full sidebar drop-box (the grid's solid <drop-box> landing target)
   *   highlighting the whole sidebar
   * - Precise drop indicator line on the tab bar (when `showIndicator` is true)
   *
   * While the cursor is over the TAB BAR (`overTabBar`), the box drops its
   * border and keeps only its wash background, so the tab-bar insert line
   * reads clearly (the wash still makes it obvious the drop lands in the
   * sidebar). Hovering the body keeps the full box.
   */
  private _showOverlay(dropIndex: number, showIndicator: boolean, overTabBar: boolean): void {
    // Suppressed while the drag ghost captures its bitmap frame — no overlay or
    // drop indicator may be painted into the snapshot.
    if (_feedbackSuppressed) return;

    // ── Sidebar-wide ghost overlay ──────────────────────────────────
    const sidebarHost = this._getSidebarHost();
    if (sidebarHost) {
      // Ensure the sidebar is a positioning root
      const hostPos = getComputedStyle(sidebarHost).position;
      if (hostPos === "static" || hostPos === "") {
        sidebarHost.style.position = "relative";
      }

      if (!this._overlayEl || !sidebarHost.contains(this._overlayEl)) {
        // The sidebar-wide drop indicator is the same <drop-box> landing
        // target the grid uses. The box covers the whole sidebar host (the
        // target the tab will dock into). Registered by the sidebar, which
        // pulls in the uikit drop-indicator module.
        this._overlayEl = document.createElement("drop-box");
        this._overlayEl.className = "sidebar-drop-zone-box";
        this._overlayEl.style.inset = "0";
        sidebarHost.appendChild(this._overlayEl);
      }

      // Framing: full box border while over the body; wash-only (no border
      // accents) while over the tab bar so the insert line reads. Set the
      // FRAME PROPERTY (not just the attribute) — Lit reflects the default
      // `frame = true` back onto the attribute on first render, so removing
      // the attribute alone would be overridden.
      if (this._overlayEl) {
        (this._overlayEl as unknown as { frame: boolean }).frame = !overTabBar;
      }
    }

    // ── Tab bar drop indicator line ────────────────────────────────
    if (!this._indicatorEl || !this.element.contains(this._indicatorEl)) {
      // A plain div (NOT a <drop-line>): the drop-line renders in shadow DOM
      // with no slot, so its appended children would never paint. A plain
      // div's light-DOM children render, matching the grid's tab-reorder
      // indicator exactly.
      this._indicatorEl = document.createElement("div");
      this._indicatorEl.className = "sidebar-drop-indicator";
      this._indicatorEl.style.cssText = [
        "position:absolute",
        "top:0",
        "bottom:0",
        "width:3px",
        "background:rgb(74,158,255)",
        "box-shadow:0 0 10px rgba(74,158,255,0.6)",
        "display:none",
        "pointer-events:none",
        "z-index:31",
        "border-radius:0",
      ].join(";");
      // Full-height, square, matching the grid's tab-reorder indicator.
      this.element.appendChild(this._indicatorEl);
    }

    if (!showIndicator) {
      this._indicatorEl.style.display = "none";
      return;
    }

    // Position the indicator, accounting for scroll offset of the
    // scroll container inside the tab bar.
    const tabs = getTabButtonsInSidebarBar(this.element);
    const scrollContainer = this.element.querySelector(".sidebar-tab-scroll");
    const scrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;

    let pos: number;
    if (tabs.length === 0 || dropIndex <= 0) {
      // Before first tab or empty bar: position at the visible left edge
      pos = -scrollLeft;
      if (pos < 0) pos = 0;
    } else if (dropIndex >= tabs.length) {
      // After last tab: position at the visible right edge of last tab
      const last = tabs[tabs.length - 1];
      pos = last.offsetLeft + last.offsetWidth - scrollLeft;
    } else {
      // Between two tabs: position at the visible left edge of the tab at
      // dropIndex. Shift left by 1px so the 3px-wide line is centered on
      // the boundary, overlapping both sides of it.
      pos = tabs[dropIndex].offsetLeft - scrollLeft - 1;
    }

    this._indicatorEl.style.display = "block";
    this._indicatorEl.style.left = `${pos}px`;
  }

  private _hideOverlay(): void {
    if (this._overlayEl && this._overlayEl.parentNode) {
      this._overlayEl.parentNode.removeChild(this._overlayEl);
    }
    this._overlayEl = null;

    if (this._indicatorEl && this._indicatorEl.parentNode) {
      this._indicatorEl.parentNode.removeChild(this._indicatorEl);
    }
    this._indicatorEl = null;
  }
}
