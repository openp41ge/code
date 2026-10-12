/**
 * <tab-grid> — renders a grid of columns, each containing <tab-bar> and
 * <tab-content>. Handles boundary detection, ghost overlays, drop handling,
 * and pin state management.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { GridDropTarget } from "openp41ge-core-tabs/targets/grid-drop-target";
import { GhostManager, type GhostPreview } from "openp41ge-core-tabs/ghost-manager";
import { computeDropTarget } from "openp41ge-core-tabs/boundary";
import type { IDragSource, TargetFeedback, GhostFactory } from "openp41ge-core-tabs/interfaces";
import type { TabBar } from "./tab-bar";
import type { TabContent } from "./tab-content";
import "./tab-bar";
import "./tab-content";
import { OverlayScrollbar } from "openp41ge-core-scrollbar";
// The cell-divider hover affordance is the shared <drag-line> (opaque blue),
// shown on hover / drag of the resize handle.
import "../drop-indicator/drag-line";
import "../drop-indicator/drop-box";

/** Bottom-space reserved for the floating horizontal grid scrollbar (px),
 *  exposed as `--grid-bb-reserve` so bottom bars — including those living in
 *  shadow DOM (e.g. the Agents chat-bottombar), which the scoped <style> can't
 *  pierce — can nudge their content up via `padding-bottom: var(--grid-bb-reserve)`.
 *  Matches the value used by the scoped `.grid-hover-reserve` rule. */
const GRID_BB_RESERVE_PX = 10;

export interface GridState {
  winId: string;
  cols: number;
  placements: Array<{
    position: { row: number; col: number };
    tabIds: string[];
  }>;
  tabData: Record<
    string,
    {
      title: string;
      content: string;
      pinned?: boolean;
      ephemeral?: boolean;
      ephemeralPinned?: boolean;
      /** Optional prefix icon (SVG markup) rendered before the tab title. */
      icon?: string;
      /** Optional muted text after the title and a dot (e.g. a worktree tab's repository). */
      description?: string;
    }
  >;
  activeTabIds: Record<string, string>;
}

export class TabGrid extends LitElement {
  @property({ type: String }) winId: string = "";
  @property({ type: Number }) cols: number = 1;
  /** Whether the grid's leftmost column sits flush with the window's left
   *  edge (no left sidebar). Bottom bars can nudge their edge-flush button
   *  8px inward via the `--grid-edge-left-pad` custom prop. */
  @property({ type: Boolean }) edgeLeft: boolean = false;
  /** Whether the grid's rightmost column sits flush with the window's right
   *  edge (no right sidebar). See `--grid-edge-right-pad`. */
  @property({ type: Boolean }) edgeRight: boolean = false;
  @property({ type: Array }) placements: Array<{
    position: { row: number; col: number };
    tabIds: string[];
  }> = [];
  @property({ type: Object }) tabData: Record<
    string,
    {
      title: string;
      content: string;
      pinned?: boolean;
      ephemeral?: boolean;
      ephemeralPinned?: boolean;
      /** Optional prefix icon (SVG markup) rendered before the tab title. */
      icon?: string;
      /** Optional muted text after the title and a dot (e.g. a worktree tab's repository). */
      description?: string;
    }
  > = {};
  @property({ type: Object }) activeTabIds: Record<string, string> = {};
  @property({ type: Function }) ghostFactory: GhostFactory | undefined = undefined;
  /** Forwarded to each <tab-bar> as its `showAdd` flag (renders a trailing
   *  “＋” button that bubbles `tab-bar-add`). */
  @property({ type: Boolean }) barShowAdd: boolean = false;
  /** Whether the focused cell's active tab shows the focus line. The host
   *  clears it while the window is blurred or its focus is outside the grid;
   *  the focused cell is kept, so the line returns to the same tab. */
  @property({ type: Boolean }) focusVisible: boolean = true;

  set gridState(state: GridState | null) {
    if (!state) return;
    this.winId = state.winId;
    this.cols = state.cols;
    this.placements = state.placements;
    this.tabData = state.tabData;
    this.activeTabIds = state.activeTabIds;
  }
  get gridState(): GridState | null {
    return {
      winId: this.winId,
      cols: this.cols,
      placements: this.placements,
      tabData: this.tabData,
      activeTabIds: this.activeTabIds,
    };
  }

  // Double-click detection for pinning unpinned tabs
  // Activation is immediate; the timer only tracks whether to pin on a second click.
  private _focusedCol: number = 0;
  private _pendingDblClickTabId: string = "";
  private _pendingDblClickTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _DOUBLE_CLICK_DELAY = 300;

  private _dropTarget: GridDropTarget | null = null;
  private _ghostManager = new GhostManager();

  /** Per-column flex-basis widths (px). 0 means auto/shared. */
  @state() private _cellWidths: number[] = [];
  private _resizeCol = -1;
  /** Column whose cell divider is currently hovered (drives the drag line). */
  @state() private _hoverResizeCol = -1;
  /** Column currently springing back into range after a rubber-band overrun. */
  @state() private _snapbackCol = -1;
  private _resizeStartX = 0;
  private _resizeStartWidth = 200;
  private _onCellResizeMove: ((e: PointerEvent) => void) | null = null;
  private _onCellResizeUp: ((e: PointerEvent) => void) | null = null;
  /** Floating horizontal overlay scrollbar for the grid (no layout space). */
  private _gridHScrollbar: OverlayScrollbar | null = null;
  private _boundOnClick: ((e: MouseEvent) => void) | null = null;
  private _boundOnDragOver: ((e: DragEvent) => void) | null = null;
  private _boundOnDragLeave: ((e: DragEvent) => void) | null = null;
  private _boundOnDrop: ((e: DragEvent) => void) | null = null;
  private _boundOnGridSplit: ((e: Event) => void) | null = null;
  private _boundOnGridMove: ((e: Event) => void) | null = null;
  private _boundOnTabBarMoveCell: ((e: Event) => void) | null = null;
  private _boundOnTabBarReorder: ((e: Event) => void) | null = null;
  private _boundOnGridPin: ((e: Event) => void) | null = null;
  private _boundOnSidebarFocus: ((e: Event) => void) | null = null;
  private _boundOnGridEnter: ((e: PointerEvent) => void) | null = null;
  private _boundOnGridLeave: ((e: PointerEvent) => void) | null = null;
  private _gridResizeObserver: ResizeObserver | null = null;
  /** Watches the grid container's subtree so overflow can be re-detected when
   *  cells/tabs/content change without the container's own box size changing. */
  private _gridMutationObserver: MutationObserver | null = null;
  private _gridMutationFrame = 0;

  /** Whether the grid content overflows horizontally (shows a floating bar). */
  private _gridHasHScroll = false;

  get dropTarget(): GridDropTarget | null {
    return this._dropTarget;
  }

  /**
   * The max width a cell may be dragged to — 50% of the window width, so the
   * divider cannot be dragged past the window's midpoint. Held as a property
   * (not the grid's own width) so overshoot, clamping, and window-shrink
   * reflow all share one source of truth.
   */
  private _cellMaxWidth(): number {
    return Math.round(window.innerWidth * 0.5);
  }

  getBarForCol(col: number): TabBar | null {
    return this.renderRoot?.querySelector(`tab-bar[col="${col}"]`) as TabBar | null;
  }

  getContentForCol(col: number): TabContent | null {
    return this.renderRoot?.querySelector(`tab-content[col="${col}"]`) as TabContent | null;
  }

  mountController(tabId: string, element: HTMLElement): boolean {
    for (const p of this.placements) {
      if (p.tabIds.includes(tabId)) {
        const content = this.getContentForCol(p.position.col);
        if (content) return content.mountController(tabId, element);
        break;
      }
    }
    return false;
  }

  unmountController(tabId: string, element: HTMLElement): boolean {
    for (const p of this.placements) {
      if (p.tabIds.includes(tabId)) {
        const content = this.getContentForCol(p.position.col);
        if (content) return content.unmountController(tabId, element);
        break;
      }
    }
    return false;
  }

  getControllerContainer(tabId: string): HTMLElement | null {
    for (const p of this.placements) {
      if (p.tabIds.includes(tabId)) {
        const content = this.getContentForCol(p.position.col);
        if (content) return content.getControllerContainer(tabId);
        break;
      }
    }
    return null;
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._setupDropTarget();
    this._attachHorizontalScrollbar();
    this._setupGridHover();
  }

  /**
   * Drive the hover-reserve behaviour: watch for horizontal overflow and react
   * to the pointer entering/leaving the grid so content can shift up/shrink to
   * make room for the floating horizontal scrollbar.
   */
  private _setupGridHover(): void {
    // The pointer enter/leave listeners are added in connectedCallback so they
    // survive reconnects; here we watch the scroll container so we always know
    // whether the grid overflows horizontally (i.e. shows a floating bar).
    const target = this.querySelector<HTMLElement>(".grid-container");
    if (target && !this._gridResizeObserver) {
      this._gridResizeObserver = new ResizeObserver(() => this._updateGridHScrollState());
      this._gridResizeObserver.observe(target);
    }
    // The overlay scrollbar detects overflow via a subtree MutationObserver on
    // the container (its own box size doesn't change when cells/tabs grow).
    // Mirror that here so `_gridHasHScroll` never goes stale; rAF-debounced so
    // editor keystrokes don't force a synchronous layout on every mutation.
    if (target && !this._gridMutationObserver) {
      this._gridMutationObserver = new MutationObserver(() => {
        if (this._gridMutationFrame) return;
        this._gridMutationFrame = requestAnimationFrame(() => {
          this._gridMutationFrame = 0;
          this._updateGridHScrollState();
        });
      });
      this._gridMutationObserver.observe(target, { childList: true, subtree: true });
    }
    this._updateGridHScrollState();
  }

  updated(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has("winId") ||
      changedProperties.has("cols") ||
      changedProperties.has("placements")
    ) {
      this._setupDropTarget();
    }
    if (changedProperties.has("cols")) {
      // Reset per-cell widths when the column count changes.
      this._cellWidths = [];
    }
    // Recompute the floating horizontal scrollbar after any re-render.  Cell
    // width changes / tab add-remove alter the grid `scrollWidth` without
    // changing the container's own box size or child-list, which the overlay's
    // observers don't catch — so refresh its thumb geometry here.
    this._gridHScrollbar?.update();
    this._updateGridHScrollState();
    // A re-render may have recreated the scroll container, so re-apply the
    // hover-reserve class (bars stay put; only bar content shifts).
    this._updateGridHoverReserve();
  }

  // The (this as X) casts are duck-type properties consumed by
  // the host application (openp41ge) via querySelector + Openp41geGridElement cast.
  private _setupDropTarget() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).pageData = {
      id: "tab-grid-" + this.winId,
      grid: {
        cols: this.cols,
        placements: this.placements.length > 0 ? this.placements : this._generatePlacements(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).winId = this.winId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._lastActiveCellCol = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._getNextTabForCell = (col: number, tabId: string) => {
      const placement = this.placements[col];
      if (!placement) return undefined;
      const idx = placement.tabIds.indexOf(tabId);
      return placement.tabIds[idx + 1] || placement.tabIds[idx - 1];
    };

    this._dropTarget = new GridDropTarget(this, this.winId, null);
  }

  private _generatePlacements(): Array<{
    position: { row: number; col: number };
    tabIds: string[];
  }> {
    const result: Array<{
      position: { row: number; col: number };
      tabIds: string[];
    }> = [];
    for (let i = 0; i < this.cols; i++) {
      const existing = this.placements.find((p) => p.position.col === i);
      if (existing) {
        result.push(existing);
      } else {
        result.push({ position: { row: 0, col: i }, tabIds: [] });
      }
    }
    return result;
  }

  // ── Pin state management ─────────────────────────────────────────────

  private _setPinned(tabId: string, pinned: boolean, ephemeral?: boolean): void {
    const current = this.tabData[tabId];
    if (!current) return;
    if (ephemeral) {
      // Ephemeral pin toggle — keep isEphemeral, just toggle ephemeralPinned
      if ((current.ephemeralPinned ?? false) === pinned) return;
      this.tabData = {
        ...this.tabData,
        [tabId]: { ...current, ephemeralPinned: pinned },
      };
    } else {
      if ((current.pinned ?? true) === pinned) return;
      this.tabData = {
        ...this.tabData,
        [tabId]: { ...current, pinned },
      };
    }
  }

  // ── Tab click handler ────────────────────────────────────────────────

  private _handleTabClick(tabBtn: HTMLElement): void {
    const tabId = tabBtn.getAttribute("data-tab-id") || "";
    const tabBarEl = tabBtn.closest?.("tab-bar");
    if (!tabBarEl) return;

    const tabBarElement = tabBarEl as HTMLElement & { winId?: string; col?: number };
    const tabWinId = tabBarElement.winId || "";
    const tabCol = tabBarElement.col ?? 0;

    const tabData = this.tabData[tabId];
    const isUnpinned = tabData && (tabData.pinned ?? true) === false;

    if (isUnpinned) {
      // Second click on the same unpinned tab within the delay → pin it
      if (tabId === this._pendingDblClickTabId && this._pendingDblClickTimer) {
        clearTimeout(this._pendingDblClickTimer);
        this._pendingDblClickTimer = null;
        this._pendingDblClickTabId = "";
        this._setPinned(tabId, true);
        this.dispatchEvent(
          new CustomEvent("grid-pin", {
            bubbles: true,
            detail: { winId: tabWinId, tabId, pinned: true },
          }),
        );
        return;
      }

      // Clear any pending timer for a different tab
      if (this._pendingDblClickTimer) {
        clearTimeout(this._pendingDblClickTimer);
        this._pendingDblClickTimer = null;
      }

      // Start a timer; if no second click arrives, it silently expires
      this._pendingDblClickTabId = tabId;
      this._pendingDblClickTimer = setTimeout(() => {
        this._pendingDblClickTimer = null;
        this._pendingDblClickTabId = "";
      }, this._DOUBLE_CLICK_DELAY);
    }

    // Activate immediately (no delay)
    this.dispatchEvent(
      new CustomEvent("grid-activate", {
        bubbles: true,
        detail: { winId: tabWinId, tabId, col: tabCol },
      }),
    );

    // Focus this column
    this._focusedCol = tabCol;
    this.requestUpdate();

    // Scroll to the tab
    const bar = this.getBarForCol(tabCol);
    bar?.scrollToTab(tabId);
  }

  // ── Ghost overlay management ──────────────────────────────────────────

  showGhostOverlay(preview: GhostPreview) {
    this._ghostManager.showGhost(this, preview);
  }

  hideGhostOverlay() {
    this._ghostManager.hideGhost(this);
  }

  computeDropFeedback(
    clientX: number,
    clientY: number,
    dragSource: IDragSource,
  ): TargetFeedback | null {
    if (!this._dropTarget) return null;
    return this._dropTarget.onHover(dragSource, clientX, clientY);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    this.style.position = "relative";
    this._setupListeners();
    this._boundOnGridEnter = () => {
      // Recompute overflow fresh at the moment of pointer-enter so the reserve
      // class reflects the CURRENT scroll state (not a stale value from an
      // earlier render, e.g. before controllers/content had been mounted).
      this._updateGridHScrollState();
    };
    this._boundOnGridLeave = () => {
      // Remainder of the reserve state is driven purely by overflow; nothing
      // to toggle here. Kept so the enter/leave listeners stay symmetric.
    };
    this.addEventListener("pointerenter", this._boundOnGridEnter);
    this.addEventListener("pointerleave", this._boundOnGridLeave);
    window.addEventListener("resize", this._onWindowResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownListeners();
    if (this._boundOnGridEnter) {
      this.removeEventListener("pointerenter", this._boundOnGridEnter);
      this._boundOnGridEnter = null;
    }
    if (this._boundOnGridLeave) {
      this.removeEventListener("pointerleave", this._boundOnGridLeave);
      this._boundOnGridLeave = null;
    }
    this._gridResizeObserver?.disconnect();
    this._gridResizeObserver = null;
    this._gridMutationObserver?.disconnect();
    this._gridMutationObserver = null;
    if (this._gridMutationFrame) {
      cancelAnimationFrame(this._gridMutationFrame);
      this._gridMutationFrame = 0;
    }
    window.removeEventListener("resize", this._onWindowResize);
    this._gridHScrollbar?.destroy();
    this._gridHScrollbar = null;
  }

  /**
   * When the window shrinks, any cell wider than 50% of the new viewport must
   * be pulled back into range so a previously-dragged cell never exceeds the
   * new midpoint.
   */
  private _onWindowResize = (): void => {
    const max = this._cellMaxWidth();
    const widths = this._cellWidths.map((w) => (w > max ? max : w));
    if (widths.some((w, i) => w !== this._cellWidths[i])) {
      this._cellWidths = widths;
    }
    this._updateGridHScrollState();
  };

  private _setupListeners(): void {
    // ── Tab click: activate ─────────────────────────────────
    this._boundOnClick = (e: MouseEvent) => {
      // Only match actual tab buttons (role="tab"), not content panes with data-tab-id
      const tabBtn = (e.target as HTMLElement).closest?.("[role='tab'][data-tab-id]");
      if (tabBtn && tabBtn instanceof HTMLElement) {
        if ((e.target as HTMLElement).closest?.(".tab-close")) return;
        this._handleTabClick(tabBtn);
        return;
      }

      // Click in content area — track column focus
      const cell = (e.target as HTMLElement).closest?.(".grid-cell");
      if (cell) {
        const col = parseInt(cell.getAttribute("data-cell-col") || "", 10);
        if (!isNaN(col)) {
          this._focusedCol = col;
          this.requestUpdate();
          this.dispatchEvent(
            new CustomEvent("grid-focus-col", {
              bubbles: true,
              detail: { winId: this.winId, col },
            }),
          );
        }
      }
    };
    this.addEventListener("click", this._boundOnClick);

    // ── Auto-pin on drag events ─────────────────────────────
    this._boundOnGridSplit = (e: Event) => {
      const { tabId, winId } = (e as CustomEvent).detail || {};
      if (tabId) {
        const isEphemeral = !!this.tabData[tabId]?.ephemeral;
        this._setPinned(tabId, true, isEphemeral || undefined);
        this.dispatchEvent(
          new CustomEvent("grid-pin", {
            bubbles: true,
            detail: { winId, tabId, pinned: true, ephemeral: isEphemeral || undefined },
          }),
        );
      }
    };
    this.addEventListener("grid-split", this._boundOnGridSplit);

    this._boundOnGridMove = (e: Event) => {
      const { tabId, sourceWinId } = (e as CustomEvent).detail || {};
      if (tabId) {
        const isEphemeral = !!this.tabData[tabId]?.ephemeral;
        this._setPinned(tabId, true, isEphemeral || undefined);
        this.dispatchEvent(
          new CustomEvent("grid-pin", {
            bubbles: true,
            detail: {
              winId: sourceWinId,
              tabId,
              pinned: true,
              ephemeral: isEphemeral || undefined,
            },
          }),
        );
      }
    };
    this.addEventListener("grid-move", this._boundOnGridMove);

    this._boundOnTabBarMoveCell = (e: Event) => {
      const { tabId, targetWinId } = (e as CustomEvent).detail || {};
      if (tabId) {
        const isEphemeral = !!this.tabData[tabId]?.ephemeral;
        this._setPinned(tabId, true, isEphemeral || undefined);
        this.dispatchEvent(
          new CustomEvent("grid-pin", {
            bubbles: true,
            detail: {
              winId: targetWinId,
              tabId,
              pinned: true,
              ephemeral: isEphemeral || undefined,
            },
          }),
        );
      }
    };
    this.addEventListener("tab-bar-move-cell", this._boundOnTabBarMoveCell);

    this._boundOnTabBarReorder = (e: Event) => {
      const { tabId, winId } = (e as CustomEvent).detail || {};
      if (tabId) {
        const isEphemeral = !!this.tabData[tabId]?.ephemeral;
        this._setPinned(tabId, true, isEphemeral || undefined);
        this.dispatchEvent(
          new CustomEvent("grid-pin", {
            bubbles: true,
            detail: { winId, tabId, pinned: true, ephemeral: isEphemeral || undefined },
          }),
        );
      }
    };
    this.addEventListener("tab-bar-reorder", this._boundOnTabBarReorder);

    // ── Handle grid-pin from external systems ───────────────
    this._boundOnGridPin = (e: Event) => {
      const { tabId, pinned, ephemeral: isEphemeralPin } = (e as CustomEvent).detail || {};
      if (tabId !== undefined) {
        this._setPinned(tabId, pinned ?? true, isEphemeralPin);
      }
    };
    this.addEventListener("grid-pin", this._boundOnGridPin);

    // ── Listen for sidebar focus changes ───────────────────
    this._boundOnSidebarFocus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sidebarFocused: boolean };
      if (detail.sidebarFocused && this._focusedCol !== -1) {
        this._focusedCol = -1;
        this.requestUpdate();
      }
    };
    document.addEventListener("sidebar-focus-change", this._boundOnSidebarFocus);

    // ── Native file drop support ──────────────────────────────
    this._boundOnDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const types = e.dataTransfer.types ?? [];
      if (
        types.includes("Files") ||
        types.includes("text/uri-list") ||
        types.includes("text/plain")
      ) {
        e.preventDefault();
        // File drags use effectAllowed="move", so set dropEffect="move".
        e.dataTransfer.dropEffect = "move";
        this._showFileDropGhost(e);
      }
    };
    this.addEventListener("dragover", this._boundOnDragOver);

    this._boundOnDragLeave = (e: DragEvent) => {
      if (!(e.relatedTarget instanceof HTMLElement) || !this.contains(e.relatedTarget)) {
        this._ghostManager.hideGhost(this);
        this._hideBarIndicators();
      }
    };
    this.addEventListener("dragleave", this._boundOnDragLeave);

    this._boundOnDrop = (e: DragEvent) => {
      this._ghostManager.hideGhost(this);
      this._hideBarIndicators();
      if (!e.dataTransfer) return;

      // ── File drop ────────────────────────────────────────────
      const filePaths: string[] = [];
      if (e.dataTransfer.files?.length) {
        for (const file of Array.from(e.dataTransfer.files)) {
          filePaths.push(file.name);
        }
      }
      const textData = e.dataTransfer.getData("text/plain");
      if (textData && filePaths.length === 0) {
        filePaths.push(textData);
      }

      // Fallback: tree drag data stored by story's tree-drag-start handler
      if (filePaths.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const treePath = (window as any).__treeDragFilePath;
        if (treePath) {
          filePaths.push(treePath);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__treeDragFilePath = null;
        }
      }

      if (filePaths.length > 0) {
        e.preventDefault();
        e.stopPropagation();

        // If drop is on a tab bar, add to that cell without splitting
        if (this._isOverTabBar(e)) {
          const tabBarEl = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest?.("tab-bar") as unknown as {
            col?: number;
            getInsertionIndex?: (x: number) => number;
          };
          const col = tabBarEl?.col ?? 0;
          const insertAt = tabBarEl?.getInsertionIndex ? tabBarEl.getInsertionIndex(e.clientX) : -1;
          for (const filePath of filePaths) {
            this.dispatchEvent(
              new CustomEvent("grid-open-tab", {
                bubbles: true,
                detail: {
                  winId: this.winId,
                  tabType: "file-viewer",
                  tabConfig: { filePath },
                  targetCol: col,
                  insertAt,
                  pinned: true,
                },
              }),
            );
          }
          return;
        }

        const rect = this.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const pos = computeDropTarget(this, relX, rect.width, this.cols);

        for (const filePath of filePaths) {
          if (pos.isBoundary) {
            const splitCol =
              pos.boundaryIndex === 0
                ? 0
                : pos.boundaryIndex >= this.cols
                  ? this.cols - 1
                  : pos.col;
            const splitLeft =
              pos.boundaryIndex === 0
                ? true
                : pos.boundaryIndex >= this.cols
                  ? false
                  : pos.col >= pos.boundaryIndex;
            this.dispatchEvent(
              new CustomEvent("grid-open-tab", {
                bubbles: true,
                detail: {
                  winId: this.winId,
                  tabType: "file-viewer",
                  tabConfig: { filePath },
                  targetCol: splitCol,
                  isBoundary: true,
                  splitCol,
                  splitLeft,
                  pinned: true,
                },
              }),
            );
          } else {
            this.dispatchEvent(
              new CustomEvent("grid-open-tab", {
                bubbles: true,
                detail: {
                  winId: this.winId,
                  tabType: "file-viewer",
                  tabConfig: { filePath },
                  targetCol: pos.col,
                  pinned: true,
                },
              }),
            );
          }
        }
      }
    };
    this.addEventListener("drop", this._boundOnDrop);
  }

  private _isOverTabBar(e: DragEvent): boolean {
    // Check from shadow root first (document.elementFromPoint only sees
    // the grid host, hiding tab-bar elements inside shadow DOM).
    const root = this.renderRoot;
    if (root && "elementFromPoint" in root) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el = (root as any).elementFromPoint(e.clientX, e.clientY);
      if (el instanceof HTMLElement && el.closest("tab-bar")) return true;
    }
    // Fallback: document-level elementFromPoint (works for light DOM tab-bars)
    const docEl = document.elementFromPoint(e.clientX, e.clientY);
    if (docEl instanceof HTMLElement && docEl.closest("tab-bar")) return true;
    return false;
  }

  private _hideBarIndicators(): void {
    this.querySelectorAll("tab-bar").forEach((bar) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tb = bar as any;
      if (tb.hideDropIndicator) tb.hideDropIndicator();
    });
  }

  private _showFileDropGhost(e: DragEvent): void {
    // Show tab bar indicator when cursor is over the tab bar
    if (this._isOverTabBar(e)) {
      this._ghostManager.hideGhost(this);
      const tabBar = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest?.("tab-bar") as unknown as { showDropIndicator?: (x: number) => void };
      if (tabBar?.showDropIndicator) {
        tabBar.showDropIndicator(e.clientX);
      }
      return;
    }
    // Not over tab bar — ensure tab bar indicators are hidden
    this._hideBarIndicators();

    const rect = this.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const pos = computeDropTarget(this, relX, rect.width, this.cols);

    if (pos.isBoundary) {
      const splitCol =
        pos.boundaryIndex === 0 ? 0 : pos.boundaryIndex >= this.cols ? this.cols - 1 : pos.col;
      const splitLeft =
        pos.boundaryIndex === 0
          ? true
          : pos.boundaryIndex >= this.cols
            ? false
            : pos.col >= pos.boundaryIndex;
      this._ghostManager.showGhost(this, {
        cols: this.cols,
        activeCol: pos.col,
        boundaryIndex: pos.boundaryIndex,
        splitCol,
        splitLeft,
        isFileDrop: true,
      });
    } else {
      this._ghostManager.showGhost(this, {
        cols: this.cols,
        activeCol: pos.col,
        isFileDrop: true,
      });
    }
  }

  private _teardownListeners(): void {
    if (this._boundOnClick) {
      this.removeEventListener("click", this._boundOnClick);
      this._boundOnClick = null;
    }
    if (this._pendingDblClickTimer) {
      clearTimeout(this._pendingDblClickTimer);
      this._pendingDblClickTimer = null;
      this._pendingDblClickTabId = "";
    }
    if (this._boundOnGridSplit) {
      this.removeEventListener("grid-split", this._boundOnGridSplit);
      this._boundOnGridSplit = null;
    }
    if (this._boundOnGridMove) {
      this.removeEventListener("grid-move", this._boundOnGridMove);
      this._boundOnGridMove = null;
    }
    if (this._boundOnTabBarMoveCell) {
      this.removeEventListener("tab-bar-move-cell", this._boundOnTabBarMoveCell);
      this._boundOnTabBarMoveCell = null;
    }
    if (this._boundOnTabBarReorder) {
      this.removeEventListener("tab-bar-reorder", this._boundOnTabBarReorder);
      this._boundOnTabBarReorder = null;
    }
    if (this._boundOnGridPin) {
      this.removeEventListener("grid-pin", this._boundOnGridPin);
      this._boundOnGridPin = null;
    }
    if (this._boundOnSidebarFocus) {
      document.removeEventListener("sidebar-focus-change", this._boundOnSidebarFocus);
      this._boundOnSidebarFocus = null;
    }
    if (this._boundOnDragOver) {
      this.removeEventListener("dragover", this._boundOnDragOver);
      this._boundOnDragOver = null;
    }
    if (this._boundOnDragLeave) {
      this.removeEventListener("dragleave", this._boundOnDragLeave);
      this._boundOnDragLeave = null;
    }
    if (this._boundOnDrop) {
      this.removeEventListener("drop", this._boundOnDrop);
      this._boundOnDrop = null;
    }
  }

  /**
   * Attach a floating horizontal OverlayScrollbar to the grid.
   *
   * The native horizontal bar on `.grid-container` (overflow-x:auto) reserves
   * ~15px of layout height at the bottom, which shrinks every grid cell and
   * pushes each tab's bottom/status bar upward.  Hiding it and replacing it
   * with the shared overlay scrollbar lets the bar float OVER the bottom of
   * the grid (over the per-tab status bars) instead of consuming space. It
   * stays visible whenever the grid overflows horizontally — the bottom-bar
   * content is nudged up (see the grid-hover-reserve rules) so it never sits
   * underneath the bar.
   */
  /**
   * Recompute whether the grid content overflows horizontally. When it does,
   * the floating horizontal scrollbar is shown and the grid content moves up
   * slightly to reserve space for it (so it no longer covers the per-tab
   * bottom bars).
   */
  private _updateGridHScrollState(): void {
    const target = this.querySelector<HTMLElement>(".grid-container");
    if (!target) return;
    const has = target.scrollWidth > target.clientWidth + 1;
    if (has !== this._gridHasHScroll) {
      this._gridHasHScroll = has;
      // The floating bar visibility depends on overflow, so re-apply the
      // reserve class (which only nudges the bottom-bar content, NOT the bars).
      this._updateGridHoverReserve();
    }
  }

  /**
   * Toggle the hover-reserve class on the grid container. Whenever the grid
   * content overflows horizontally — i.e. the floating horizontal scrollbar is
   * present — the bottom-bar CONTENT is nudged up (via scoped CSS: bottom
   * padding = scrollbar height, content vertically centred above it) so the
   * scrollbar never covers it. The bars themselves stay pinned in place.
   */
  private _updateGridHoverReserve(): void {
    const target = this.querySelector<HTMLElement>(".grid-container");
    if (!target) return;
    target.classList.toggle("grid-hover-reserve", this._gridHasHScroll);
    // Expose the reserve amount as a CSS custom property. It inherits across
    // shadow boundaries, so bottom bars rendered in shadow DOM (e.g. the
    // Agents chat-bottombar, which the scoped <style> cannot pierce) can react
    // via `padding-bottom: var(--grid-bb-reserve)`.
    target.style.setProperty(
      "--grid-bb-reserve",
      this._gridHasHScroll ? `${GRID_BB_RESERVE_PX}px` : "0px",
    );
  }

  private _attachHorizontalScrollbar(): void {
    // (Re)bind the floating horizontal overlay bar to the grid's scroll area.
    this._gridHScrollbar?.destroy();
    this._gridHScrollbar = null;
    const target = this.querySelector(".grid-container") as HTMLElement | null;
    if (!target || !target.isConnected) return;
    this._gridHScrollbar = OverlayScrollbar.attach(target, {
      axis: "horizontal",
      // The grid host is position:relative and does not itself scroll, so the
      // track floats over the bottom edge of the grid (over the status bars)
      // rather than inside the scrolling content where it would move sideways.
      container: this,
      inset: { left: "0", right: "0", bottom: "0" },
      // Keep the bar visible whenever the grid overflows horizontally. The
      // bottom-bar content is already nudged up (see the grid-hover-reserve
      // rules), so the bar never covers it and there is no reason to fade it
      // out after the cursor leaves — it stays put the whole time.
      autoHide: false,
      size: 9,
      hoverSize: 10,
      zIndex: 1001,
    });
  }

  render() {
    const gridStyle =
      "display:flex;flex-direction:row;height:100%;background:var(--bg-primary, #161616);overflow-x:auto;overflow-y:hidden;";

    return html`
      <style>
        .grid-resize-handle {
          flex-shrink: 0;
          width: 5px;
          /* Asymmetric negative margins cancel the 5px width to a ZERO-width
             flex track (margin-box 5 - 2 - 3 = 0) so the 1px cell separator
             stays at the boundary without pushing cells; the 5px handle still
             overlays it, ~2px on each side. */
          margin-left: -2px;
          margin-right: -3px;
          cursor: col-resize;
          position: relative;
          /* Paint above all cell content (gutter group, cursor blink, drop
             indicator, etc. use z-index ≤ 100) so the drag bar and its blue
             indicator are never drawn under a neighbouring cell — and the
             whole 5px strip stays grabbable/visible. */
          z-index: 1000;
        }
        /* The blue indicator is the shared <drag-line> (opacity driven by the
           show attribute, toggled on hover / drag); it tracks the cell
           divider's top edge. */
        .grid-resize-handle drag-line {
          left: 0;
        }
        /* Animated spring-back for a cell returning from a rubber-band overrun.
           The class is present only during the return (set on release, cleared
           shortly after), so during the active drag the cell tracks the pointer
           without lag. */
        .grid-cell.sdw-snapback {
          transition: flex-basis 0.18s ease;
        }
        /* Whenever the grid overflows horizontally (a horizontal scrollbar is
           present), keep the per-tab bottom bars pinned in place (cells do NOT
           shift) but move the CONTENT inside the bars up — bottom padding
           equals the scrollbar height and the content stays vertically centred
           above it — so the floating scrollbar never covers it. !important
           overrides the components' inline padding (e.g. fe-status-bar's
           'padding:0 0 0 8px'), which would otherwise beat this rule. */
        .grid-container.grid-hover-reserve fe-status-bar .sbb-row,
        .grid-container.grid-hover-reserve [data-bottom-bar],
        .grid-container.grid-hover-reserve .bottom-bar {
          box-sizing: border-box;
          transition: padding-bottom 0.18s ease;
          padding-bottom: 10px !important;
        }
        /* Keep bottom-bar action buttons (icon / text) FULL height when the
           bar reserves space for the floating scrollbar. The bar's bottom
           padding would otherwise shrink any height:100% button (because
           border-box padding eats into the content box), so we pin the button
           to the bar's full 34px and top-align it — it stays exactly where it
           was — while its own bottom padding shifts the icon/text up so it
           clears the scrollbar. Only the icon moves up, never the button.
           box-sizing is forced !important because some edge buttons (e.g. the
           file-editor's word-wrap toggle, which reaches the window edge via an
           inline content-box + edge padding) set box-sizing inline; a plain
           border-box here would still be beaten by that inline style, letting
           content-box padding-bottom:10px grow the button to 44px and push it
           out of the bar, misaligning it against its 34px siblings. */
        .grid-container.grid-hover-reserve fe-status-bar .sbb-row .p41ge-icon-btn,
        .grid-container.grid-hover-reserve [data-bottom-bar] .p41ge-icon-btn,
        .grid-container.grid-hover-reserve [data-bottom-bar] .level-btn,
        .grid-container.grid-hover-reserve .bottom-bar .p41ge-icon-btn,
        .grid-container.grid-hover-reserve .bottom-bar .level-btn {
          min-height: 34px;
          align-self: flex-start;
          transition: padding-bottom 0.18s ease;
          padding-bottom: 10px !important;
          box-sizing: border-box !important;
        }
      </style>
      <div class="grid-container" style=${gridStyle}>
        ${Array.from(
          { length: this.cols },
          (_, i) =>
            html`${this._renderColumn(i)}${i < this.cols - 1 ? this._renderResizeHandle(i) : ""}`,
        )}
      </div>
    `;
  }

  private _renderResizeHandle(colIndex: number): TemplateResult {
    const shown = this._hoverResizeCol === colIndex || this._resizeCol === colIndex;
    return html`
      <div
        class="grid-resize-handle ${this._resizeCol === colIndex ? "dragging" : ""}"
        data-resize-col=${colIndex}
        @pointerdown=${(e: PointerEvent) => this._onCellResizeStart(e, colIndex)}
        @pointerenter=${() => {
          if (this._hoverResizeCol !== colIndex) this._hoverResizeCol = colIndex;
        }}
        @pointerleave=${() => {
          if (this._hoverResizeCol === colIndex) this._hoverResizeCol = -1;
        }}
        @dblclick=${(e: MouseEvent) => this._onCellResizeDblClick(e)}
        title="Drag to resize column. Double-click to equalize all columns"
      >
        <drag-line orientation="vertical" ?show=${shown}></drag-line>
      </div>
    `;
  }

  /**
   * Double-clicking any column divider re-lays the cells out to share space
   * evenly. Clearing `_cellWidths` makes every column fall back to `flex:1`, so
   * they divide the grid equally (e.g. 2 cells → divider at the centre).
   */
  private _onCellResizeDblClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._cellWidths = [];
    this.requestUpdate();
  }

  private _onCellResizeStart(e: PointerEvent, colIndex: number): void {
    e.preventDefault();
    e.stopPropagation();
    const cell = this.querySelector(
      `.grid-cell[data-cell-col="${colIndex}"]`,
    ) as HTMLElement | null;
    this._resizeCol = colIndex;
    this._resizeStartX = e.clientX;
    this._resizeStartWidth =
      cell?.getBoundingClientRect().width ?? this._cellWidths[colIndex] ?? 200;
    this._onCellResizeMove = (ev: PointerEvent) => {
      const dx = ev.clientX - this._resizeStartX;
      const min = 200;
      const max = this._cellMaxWidth();
      // Rubber-band once the cell passes its min/max so the drag gives way
      // elastically instead of hitting a hard wall; it springs back on release.
      let next = this._resizeStartWidth + dx;
      if (max && next > max) next = max + (next - max) * 0.2;
      else if (next < min) next = min - (min - next) * 0.2;
      const widths = this._cellWidths.slice();
      widths[colIndex] = next;
      this._cellWidths = widths;
      this.requestUpdate();
    };
    this._onCellResizeUp = () => {
      if (this._onCellResizeMove) window.removeEventListener("pointermove", this._onCellResizeMove);
      if (this._onCellResizeUp) window.removeEventListener("pointerup", this._onCellResizeUp);
      this._onCellResizeMove = null;
      this._onCellResizeUp = null;
      // Snap the cell back into its allowed range if the drag overshot a limit,
      // animating the return to the limit via the snapback class.
      const min = 200;
      const max = this._cellMaxWidth();
      const cur = this._cellWidths[this._resizeCol];
      if (cur !== undefined) {
        const clamped = Math.max(min, Math.min(max, cur));
        if (clamped !== cur) {
          const widths = this._cellWidths.slice();
          widths[this._resizeCol] = clamped;
          this._snapbackCol = this._resizeCol;
          this._cellWidths = widths;
          window.setTimeout(() => {
            this._snapbackCol = -1;
          }, 260);
        }
      }
      this._resizeCol = -1;
      this.requestUpdate();
    };
    window.addEventListener("pointermove", this._onCellResizeMove);
    window.addEventListener("pointerup", this._onCellResizeUp);
  }

  private _renderColumn(colIndex: number) {
    const w = this._cellWidths[colIndex];
    const flex = w ? `flex:0 0 ${w}px;` : "flex:1;";
    // The active drag + the spring-back need the 200px floor relaxed so the
    // elastic overshoot (below the min) and the animated return are visible;
    // otherwise `min-width:200px` hard-clamps the rendered width and hides the
    // rubber band entirely.
    const minW =
      colIndex === this._resizeCol || colIndex === this._snapbackCol
        ? "min-width:0"
        : "min-width:200px";
    // Expose whether this cell touches the window's rounded corner so a tab's
    // bottom-bar edge button can move 8px inward. Custom props inherit across
    // shadow boundaries, so bottom bars in shadow DOM can use them directly.
    const leftPad = this.edgeLeft && colIndex === 0 ? "8px" : "0px";
    const rightPad = this.edgeRight && colIndex === this.cols - 1 ? "8px" : "0px";
    const colStyle = `display:flex;flex-direction:column;${minW};${flex}border-right:${colIndex < this.cols - 1 ? "1px solid #333" : "none"};overflow:hidden;--grid-edge-left-pad:${leftPad};--grid-edge-right-pad:${rightPad};`;
    const placement = this.placements.find((p) => p.position.col === colIndex);
    const tabIds = placement ? placement.tabIds : [];
    const activeTabId = this.activeTabIds[String(colIndex)] || tabIds[0] || "";

    return html`
      <div
        class="grid-cell ${this._snapbackCol === colIndex ? "sdw-snapback" : ""}"
        data-cell-col=${colIndex}
        style=${colStyle}
      >
        <tab-bar
          .tabIds=${tabIds}
          .tabs=${this.tabData}
          .activeTabId=${activeTabId}
          .winId=${this.winId}
          .col=${colIndex}
          .focused=${colIndex === this._focusedCol}
          .focusVisible=${this.focusVisible}
          .showAdd=${this.barShowAdd}
        ></tab-bar>
        <tab-content
          .tabIds=${tabIds}
          .activeTabId=${activeTabId}
          .tabs=${this.tabData}
          col=${colIndex}
          style="flex:1;display:flex;flex-direction:column;overflow:hidden;"
        ></tab-content>
      </div>
    `;
  }
}

if (!customElements.get("tab-grid")) {
  customElements.define("tab-grid", TabGrid);
}
