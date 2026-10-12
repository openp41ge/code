/**
 * <openp41ge-windowview> — top-level component for a Openp41ge window (Lit).
 *
 * Owns the sidebar resize handles. Bottom area uses a thin (empty) bar
 * reserved for future use. System tabs replaced by a service modal.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import type { Window, Workspace, Rect, SystemTabId } from "../../layout/types";
import { emitEvent } from "../app";

import { getFileIcon } from "../icons/material-icons";
import { extensionTabLabel, settingsTabIcon } from "./grid-tab-decorations";

import { setContextMenuActive } from "../services/drag-context";
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  NOTCH_WIDTH,
  NOTCH_OVERFLOW,
} from "openp41ge-core-constants";

import "./openp41ge-sidebar";
// Registers <drag-line>, the shared translucent blue hover affordance used by
// the resize notches (the "you can drag this" sibling of <drop-line>).
import "openp41ge-sdk-uikit/drop-indicator";
import { appState } from "../services/app-state";

class Openp41geWindowView extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  @property({ attribute: false })
  windowData: Window | null = null;

  @property({ attribute: false })
  workspaceData: Workspace | null = null;

  @property({ attribute: false })
  layouts: Map<string, Map<string, Rect>> = new Map();

  // ═══ Focus (from AppState): where the focused tab's line shows ════════

  /** The window is focused, and the zone its focus is in (a sidebar, or the
   *  grid when null). Blurring keeps the zone, so the line comes back. */
  @state()
  private _focus = { windowFocused: appState.windowFocused, side: appState.focusedSide };

  private _unobserveFocus: (() => void) | null = null;

  private readonly _onFocusState = (): void => {
    const { windowFocused, focusedSide: side } = appState;
    if (windowFocused !== this._focus.windowFocused || side !== this._focus.side) {
      this._focus = { windowFocused, side };
    }
  };

  // ═══ Resize state (owned by windowview for unified corner handling) ──

  /** Left sidebar width in pixels. */
  @state()
  private _leftWidth = parseInt(localStorage.getItem("openp41ge:sidebar-width-left") ?? "280", 10);

  /** Right sidebar width in pixels. */
  @state()
  private _rightWidth = parseInt(
    localStorage.getItem("openp41ge:sidebar-width-right") ?? "280",
    10,
  );

  // ── Drag state ────────────────────────────────────────────────────────

  private _activeHandle: "left" | "right" | null = null;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartLeftWidth = 280;
  private _dragStartRightWidth = 280;
  /** Latest applied width during an active drag (written straight to the DOM so
   * the handle tracks the mouse every move, without a full re-render per mousemove). */
  private _dragLeftWidth = 280;
  private _dragRightWidth = 280;

  /** True while the sidebar rubber-bands past its OWN max width. */
  private _isOverMax = false;
  private _overMaxTarget = 0;
  /** True while the sidebar rubber-bands below its OWN min width. */
  private _isOverMin = false;
  private _overMinTarget = 0;
  /** Resistance factor for the small "give" while over-dragging (0..1). */
  private readonly _RESISTANCE = 0.2;

  // ── Context menu ─────────────────────────────────────────────────────

  private _contextMenu: { x: number; y: number; paneId?: string } | null = null;
  private _skeletonInitialized = false;
  private _resizeRaf = 0;

  /**
   * On every window resize, force a top-level Lit re-render (rAF-throttled).
   * The CSS shell already tracks the viewport, but JS-measured sub-layouts
   * (sidebar heights, editor/tree viewports, bottom pane) capture pixel sizes
   * during render — so they must re-render as the window grows or they go
   * stale until some later event. The macOS native maximize animation is a
   * particular case where this matters.
   */
  private _onWindowResize = (): void => {
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.requestUpdate();
    });
  };

  connectedCallback(): void {
    super.connectedCallback();
    this._ensureSkeleton();
    window.addEventListener("resize", this._onWindowResize);
    this._unobserveFocus = appState.observe(this._onFocusState);
    this._onFocusState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onWindowResize);
    this._unobserveFocus?.();
    this._unobserveFocus = null;
    if (this._resizeRaf) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = 0;
    }
    document.removeEventListener("mousemove", this._onResizeMove);
    document.removeEventListener("mouseup", this._onResizeEnd);
  }

  private _onWorkspacesUpdate = (): void => {
    this.requestUpdate();
  };

  private _ensureSkeleton(): void {
    if (this._skeletonInitialized) return;
    this._skeletonInitialized = true;

    this.addEventListener("contextmenu", (e: MouseEvent) => {
      const gridArea = this.querySelector(".openp41ge-grid-area");
      if (!gridArea || !gridArea.contains(e.target as Node)) return;
      e.preventDefault();
      if (!(e.target instanceof HTMLElement)) return;
      const paneEl = e.target.closest("[data-pane-id]");
      if (!(paneEl instanceof HTMLElement)) {
        this._contextMenu = { x: e.clientX, y: e.clientY, paneId: undefined };
      } else {
        const paneId = paneEl.getAttribute("data-pane-id") ?? undefined;
        this._contextMenu = { x: e.clientX, y: e.clientY, paneId };
      }
      this._updateContextMenu();
    });
  }

  // ═══ Resize handlers ──────────────────────────────────────────────────

  private _onResizeStart(e: MouseEvent, handle: "left" | "right"): void {
    e.preventDefault();
    this._activeHandle = handle;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    this._dragStartLeftWidth = this._leftWidth;
    this._dragStartRightWidth = this._rightWidth;
    this._dragLeftWidth = this._leftWidth;
    this._dragRightWidth = this._rightWidth;
    this._isOverMax = false;
    this._overMaxTarget = 0;
    this._isOverMin = false;
    this._overMinTarget = 0;
    // Keep the notch's blue indicator lit for the whole drag (not just hover).
    this._setDragLine(handle, true);

    document.addEventListener("mousemove", this._onResizeMove);
    document.addEventListener("mouseup", this._onResizeEnd);
  }

  private _onResizeMove = (e: MouseEvent): void => {
    if (!this._activeHandle) return;

    const dx = e.clientX - this._dragStartX;

    document.body.style.cursor = "col-resize";

    switch (this._activeHandle) {
      case "left": {
        const newWidth = this._sidebarMove("left", dx);
        this._dragLeftWidth = newWidth;
        this._applyWidth("left", newWidth);
        break;
      }
      case "right": {
        // Right handle: dragging left (dx<0) widens the right sidebar.
        const newWidth = this._sidebarMove("right", dx);
        this._dragRightWidth = newWidth;
        this._applyWidth("right", newWidth);
        break;
      }
    }
  };

  /**
   * Compute the sidebar width for a drag move: it follows the pointer between
   * its min and max, and rubber-bands past either (springing back on release).
   */
  private _sidebarMove(handle: "left" | "right", dx: number): number {
    const startWidth = handle === "left" ? this._dragStartLeftWidth : this._dragStartRightWidth;
    // Widening the sidebar is +dx for left, -dx for right.
    const desired = handle === "left" ? startWidth + dx : startWidth - dx;
    // The sidebar's effective max is the smaller of MAX_SIDEBAR_WIDTH and the
    // 35% viewport cap (the same constraint the template's `max-width` uses),
    // so the rubber band fires at the width the sidebar actually renders to.
    const maxSidebar = this._sidebarMax();

    let newWidth: number;
    this._isOverMax = false;
    this._isOverMin = false;
    this._overMaxTarget = 0;
    this._overMinTarget = 0;

    if (desired < MIN_SIDEBAR_WIDTH) {
      // Below its own minimum — rubber band down, spring back on release.
      newWidth = MIN_SIDEBAR_WIDTH - (MIN_SIDEBAR_WIDTH - desired) * this._RESISTANCE;
      this._isOverMin = true;
      this._overMinTarget = MIN_SIDEBAR_WIDTH;
    } else {
      newWidth = Math.min(maxSidebar, desired);
      // Above its own max — rubber band up, spring back on release.
      if (desired > maxSidebar) {
        newWidth = maxSidebar + (desired - maxSidebar) * this._RESISTANCE;
        this._isOverMax = true;
        this._overMaxTarget = maxSidebar;
      }
    }
    return newWidth;
  }

  /**
   * The effective max width a sidebar can render to: the smaller of
   * `MAX_SIDEBAR_WIDTH` and the 35% viewport cap used by the template.
   */
  private _sidebarMax(): number {
    return Math.min(MAX_SIDEBAR_WIDTH, Math.round(window.innerWidth * 0.35));
  }

  /**
   * Write a sidebar width straight to its DOM host element. Bypasses Lit
   * re-rendering so the resize handle tracks the mouse position on every
   * mousemove — even very fast ones — instead of lagging behind.
   */
  private _applyWidth(side: "left" | "right", width: number): void {
    const el = this.querySelector<HTMLElement>(`openp41ge-sidebar[side="${side}"]`);
    if (!el) return;
    el.style.flex = `0 1 ${width}px`;
    // Let the (possibly rubber-banded) width render exactly, so the overshoot is
    // visible during the drag. Committed widths are already capped by
    // `_sidebarMove` at `min(MAX_SIDEBAR_WIDTH, 35vw)`, so this never persists
    // a width beyond the design cap.
    el.style.maxWidth = `${width}px`;
  }

  /**
   * Animate the sidebar spring-back by temporarily enabling a width transition
   * on the element, applying the target width, and clearing it after the
   * transition completes. This makes the rubber-band overshoot ease back to
   * the limit (and the inner content/scrollbars follow the animation) rather
   * than snapping instantly.
   */
  private _springWidth(side: "left" | "right", width: number): void {
    const el = this.querySelector<HTMLElement>(`openp41ge-sidebar[side="${side}"]`);
    if (!el) return;
    el.classList.add("wv-springing");
    this._applyWidth(side, width);
    window.setTimeout(() => {
      el.classList.remove("wv-springing");
    }, 200);
  }

  private _onResizeEnd = (): void => {
    const handle = this._activeHandle;
    this._activeHandle = null;
    document.removeEventListener("mousemove", this._onResizeMove);
    document.removeEventListener("mouseup", this._onResizeEnd);

    // Reset cursor
    document.body.style.cursor = "";

    // If the sidebar rubber-banded past its own max, spring it back to the max.
    if (this._isOverMax && this._overMaxTarget > 0 && handle) {
      this._dragLeftWidth = handle === "left" ? this._overMaxTarget : this._dragLeftWidth;
      this._dragRightWidth = handle === "right" ? this._overMaxTarget : this._dragRightWidth;
      this._springWidth("left", this._dragLeftWidth);
      this._springWidth("right", this._dragRightWidth);
    }
    // If the sidebar rubber-banded below its own min, spring it back to the min.
    if (this._isOverMin && this._overMinTarget > 0 && handle) {
      this._dragLeftWidth = handle === "left" ? this._overMinTarget : this._dragLeftWidth;
      this._dragRightWidth = handle === "right" ? this._overMinTarget : this._dragRightWidth;
      this._springWidth("left", this._dragLeftWidth);
      this._springWidth("right", this._dragRightWidth);
    }

    // Commit the final drag width into reactive state (single render) and persist
    this._leftWidth = this._dragLeftWidth;
    this._rightWidth = this._dragRightWidth;
    localStorage.setItem("openp41ge:sidebar-width-left", String(this._leftWidth));
    localStorage.setItem("openp41ge:sidebar-width-right", String(this._rightWidth));

    // Clear the drag indicator and overrun state.
    if (handle) this._setDragLine(handle, false);
    this._isOverMax = false;
    this._isOverMin = false;
  };

  /** Toggle the shared <drag-line> inside a resize notch (hover / dragging). */
  private _setDragLine(side: "left" | "right", on: boolean): void {
    const line = this.querySelector(`.wv-notch-v.${side}-notch drag-line`);
    if (line) line.toggleAttribute("show", on);
  }

  // ═══ Helpers ─────────────────────────────────────────────────────────

  private _getSystemTabTitle(tabId: string): string {
    const sysTab = this.workspaceData?.systemTabs?.[tabId as SystemTabId];
    if (sysTab?.title) return sysTab.title;
    // Sidebar tabs embed appType in the ID
    const appType = this._getSystemTabAppType(tabId);
    if (appType !== "unknown") {
      const names: Record<string, string> = {
        "workspace-manager": "Workspaces",
        settings: "Settings",
        explorer: "Explorer",
        git: "History",
        search: "Search",
      };
      return names[appType] ?? appType;
    }
    return tabId;
  }

  private _getSystemTabAppType(tabId: string): string {
    const sysTab = this.workspaceData?.systemTabs?.[tabId as SystemTabId];
    if (sysTab?.appType) return sysTab.appType;
    const match = tabId.match(/^editor-sys-([a-z-]+)-\d+$/);
    return match?.[1] ?? "unknown";
  }

  private _getSystemTabPinned(tabId: string): boolean {
    const sysTab = this.workspaceData?.systemTabs?.[tabId as SystemTabId];
    return sysTab?.pinned ?? false;
  }

  // ═══ Grid tab prefix icons ─────────────────────────────────────────────

  /**
   * Compute the prefix icon for a grid tab.
   *
   * Only some tab kinds get icons, per the design decision that grid tabs are
   * otherwise indistinguishable from one another:
   *   - Settings grid tabs (an extension's config editor, Explorer Settings,
   *     a sidebar tab's own settings surface) use the settings gear icon.
   *   - File editor tabs use the same file-type icon as the explorer sidebar.
   *   - Extension tabs use their surface's `tabLabel` icon, if any.
   *
   * All other grid tabs (terminal, etc.) get no icon.
   */
  private _gridTabIcon(tab: {
    appType: string;
    config?: Record<string, unknown>;
  }): string | undefined {
    // Settings grid tabs: their app registration says so.
    const gear = settingsTabIcon(tab.appType);
    if (gear) return gear;

    // File editor tabs: reuse the explorer's file-type icon (by filename).
    if (tab.appType === "file-viewer") {
      const filePath = tab.config?.filePath;
      if (typeof filePath === "string" && filePath) {
        return this._sizeIcon(getFileIcon(this._fileNameFromPath(filePath)), 14);
      }
    }

    // Extension tabs: the surface's tabLabel icon for this tab.
    const extIcon = extensionTabLabel(tab.appType, tab.config)?.icon;
    if (extIcon) return /<svg[^>]*\swidth=/.test(extIcon) ? extIcon : this._sizeIcon(extIcon, 14);

    return undefined;
  }

  /**
   * Material icon SVGs carry only a viewBox (no intrinsic size), so they
   * otherwise render at the browser's default 300x150. Inject explicit
   * width/height (mirroring <file-extension-svg> in the explorer).
   */
  private _sizeIcon(svg: string, size: number): string {
    return svg.replace("<svg", `<svg width="${size}" height="${size}"`);
  }

  private _fileNameFromPath(filePath: string): string {
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : filePath;
  }

  // ═══ Render ──────────────────────────────────────────────────────────

  render(): TemplateResult | typeof nothing {
    const win = this.windowData;
    const ws = this.workspaceData;
    if (!win) return nothing;

    // Build tab-data and active-tab-ids for <tab-grid>
    const tabData: Record<
      string,
      { title: string; content: string; pinned: boolean; icon?: string; description?: string }
    > = {};
    const activeTabIds: Record<string, string> = {};
    for (const p of win.grid.placements) {
      const col = String(p.position.col);
      activeTabIds[col] = p.activeTabId ?? p.tabIds[0] ?? "";
      for (const tabId of p.tabIds) {
        const tidStr = String(tabId);
        const tab = ws?.editorTabs?.[tabId];
        const pinned = tab ? !tab.isPreview : true;
        const extLabel = tab ? extensionTabLabel(tab.appType, tab.config) : undefined;
        tabData[tidStr] = {
          title: extLabel?.title ?? tab?.title ?? "untitled",
          content: "",
          pinned,
          icon: tab ? this._gridTabIcon(tab) : undefined,
          description: extLabel?.description,
        };
      }
    }

    const effectiveCols = Math.max(1, win.grid.cols);
    const placements =
      win.grid.placements.length > 0
        ? win.grid.placements.map((p) => ({ position: { ...p.position }, tabIds: [...p.tabIds] }))
        : [{ position: { row: 0, col: 0 }, tabIds: [] as string[] }];

    // Resolve system tab data for sidebars (shared across the workspace)
    const leftSysTabs = (ws?.sidebar?.leftSidebarTabs ?? []).map((id) => ({
      id,
      title: this._getSystemTabTitle(id),
      appType: this._getSystemTabAppType(id),
      pinned: this._getSystemTabPinned(id),
    }));
    const rightSysTabs = (ws?.sidebar?.rightSidebarTabs ?? []).map((id) => ({
      id,
      title: this._getSystemTabTitle(id),
      appType: this._getSystemTabAppType(id),
      pinned: this._getSystemTabPinned(id),
    }));

    return html`
      <style>
        .sidebar-element-hidden {
          display: none !important;
        }

        /* ── Resize notches (like sidebar notches but owned by windowview) ── */
        .wv-notch-v {
          width: ${NOTCH_WIDTH}px;
          flex-shrink: 0;
          cursor: col-resize;
          position: relative;
          /* Above the sidebars and grid, so the whole drag bar (and its hover
           * highlight) stays grabbable over both. */
          z-index: 1004;
          background: transparent;
          /* Asymmetric negative margins cancel the 7px width to a ZERO-width
             flex track (margin-box 7 - 3 - 4 = 0), so the sidebar border sits
             flush against the grid — no hairline gap — while the 7px element
             and its hover highlight bar still overlap the boundary. */
          margin-left: -${NOTCH_OVERFLOW}px;
          margin-right: -${NOTCH_WIDTH - NOTCH_OVERFLOW}px;
        }
        /* Animated spring-back for the sidebar when released after a rubber-band
           overrun. The class is added just before the width change and removed
           once the transition finishes; during the drag itself it is absent so
           the sidebar tracks the pointer without lag. */
        openp41ge-sidebar.wv-springing {
          transition:
            flex-basis 0.18s ease,
            max-width 0.18s ease;
        }
      </style>
      <div class="flex flex-col w-full h-full bg-surface relative">
        <openp41ge-titlebar
          .windowData=${win}
          .leftSidebarVisible=${ws?.sidebar?.leftSidebarOpen ?? false}
          .rightSidebarVisible=${ws?.sidebar?.rightSidebarOpen ?? false}
        ></openp41ge-titlebar>

        <div class="openp41ge-main-area flex flex-1 overflow-hidden min-h-0 relative">
          <!-- Left sidebar -->
          <openp41ge-sidebar
            side="left"
            .windowId=${win.id}
            .workspaceData=${ws}
            .systemTabs=${leftSysTabs}
            .activeTabId=${win.sidebar?.activeLeftTab ?? null}
            .isOpen=${ws?.sidebar?.leftSidebarOpen ?? false}
            .focused=${this._focus.windowFocused && this._focus.side === "left"}
            class="sidebar-element ${ws?.sidebar?.leftSidebarOpen ? "" : "sidebar-element-hidden"}"
            style="flex: 0 1 ${this._leftWidth}px; max-width: min(${this._leftWidth}px, 35vw)"
          ></openp41ge-sidebar>

          <!-- Left resize notch (between left sidebar and grid) -->
          <div
            class="wv-notch-v left-notch ${ws?.sidebar?.leftSidebarOpen ? "" : "sidebar-element-hidden"}"
            @mousedown=${(e: MouseEvent) => this._onResizeStart(e, "left")}
            @mouseenter=${() => this._setDragLine("left", true)}
            @mouseleave=${() => this._setDragLine("left", false)}
          >
            <drag-line orientation="vertical" style="left:1px"></drag-line>
          </div>

          <!-- Central area: grid always renders -->
          <div class="flex flex-col flex-1 overflow-hidden" style="min-width:280px">
            <div
              class="wv-code openp41ge-grid-area relative overflow-hidden flex-1"
              style="--wv-code-min:200px"
            >
              <tab-grid
                winId=${win.id}
                .cols=${effectiveCols}
                .placements=${placements}
                .tabData=${tabData}
                .activeTabIds=${activeTabIds}
                .edgeLeft=${!(ws?.sidebar?.leftSidebarOpen ?? false)}
                .edgeRight=${!(ws?.sidebar?.rightSidebarOpen ?? false)}
                .focusVisible=${this._focus.windowFocused && this._focus.side === null}
              ></tab-grid>
            </div>
          </div>

          <!-- Right resize notch (between grid and right sidebar) -->
          <div
            class="wv-notch-v right-notch ${ws?.sidebar?.rightSidebarOpen ? "" : "sidebar-element-hidden"}"
            @mousedown=${(e: MouseEvent) => this._onResizeStart(e, "right")}
            @mouseenter=${() => this._setDragLine("right", true)}
            @mouseleave=${() => this._setDragLine("right", false)}
          >
            <drag-line orientation="vertical" style="right:2px"></drag-line>
          </div>

          <!-- Right sidebar -->
          <openp41ge-sidebar
            side="right"
            .windowId=${win.id}
            .workspaceData=${ws}
            .systemTabs=${rightSysTabs}
            .activeTabId=${win.sidebar?.activeRightTab ?? null}
            .isOpen=${ws?.sidebar?.rightSidebarOpen ?? false}
            .focused=${this._focus.windowFocused && this._focus.side === "right"}
            class="sidebar-element ${ws?.sidebar?.rightSidebarOpen ? "" : "sidebar-element-hidden"}"
            style="flex: 0 1 ${this._rightWidth}px; max-width: min(${this._rightWidth}px, 35vw)"
          ></openp41ge-sidebar>
        </div>
      </div>
    `;
  }

  // ═══ Context menu ─────────────────────────────────────────────────────

  private async _updateContextMenu(_win?: Window): Promise<void> {
    if (!this._contextMenu) return;
    const w = _win ?? this.windowData;
    if (!w) return;

    const items: Array<{ label: string; id: string }> = [];
    if (this._contextMenu?.paneId) {
      items.push({ label: "Move to new window", id: "detach-tab-window" });
      items.push({ label: "Close", id: "close-tab" });
    }

    setContextMenuActive(true);
    const blockNextMousedown = (e: MouseEvent) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      document.removeEventListener("mousedown", blockNextMousedown, true);
    };
    document.addEventListener("mousedown", blockNextMousedown, true);
    const id = await window.openp41ge.showContextMenu(items);
    document.removeEventListener("mousedown", blockNextMousedown, true);
    setTimeout(() => setContextMenuActive(false), 0);
    if (!id) {
      this._contextMenu = null;
      return;
    }

    switch (id) {
      case "detach-tab-window":
        if (this._contextMenu?.paneId) {
          window.openp41ge.workspace.detachTab(w.id, this._contextMenu.paneId, {
            x: 100,
            y: 100,
            width: 800,
            height: 600,
          });
        }
        break;
      case "close-tab":
        if (this._contextMenu?.paneId) {
          emitEvent("tab-remove-from-cell", { windowId: w.id, paneId: this._contextMenu.paneId });
        }
        break;
    }
    this._contextMenu = null;
  }
}

customElements.define("openp41ge-windowview", Openp41geWindowView);
