/**
 * ─── Unified Drag System ─────────────────────────────────────────────────
 *
 * Three parallel drag systems (TabDragHandler, GridDragHandler, FileDropHandler)
 * are unified into a single coordinator pattern with DI.
 *
 * Key OO insight:
 *   - Each drag SOURCE provides its own ghost visual (tab button shape for tabs,
 *     file icon for files, repo icon for repos, etc.)
 *   - Each drop TARGET provides its own indicator UI (tab-insert marker, split
 *     overlay, blue openp41ge-highlight outline, etc.)
 *   - The DragHandler is an ORCHESTRATOR — it finds targets under the cursor
 *     and delegates visual feedback to the source and target.
 *
 * For tests, TestDragHandler exposes simulateDrag(source, target), skipping
 * the mouse-event layer entirely.
 *
 * ─── Drag Source ─────────────────────────────────────────────────────────
 */

/** Data payload identifying what is being dragged */
export type DragSourceData =
  | { type: "tab"; tabId: string; winId: string; worksetId: string; title?: string }
  | { type: "openp41ge-tab"; tabId: string; winId: string; worksetId: string; title?: string };

/**
 * A drag source provides:
 *   - The data payload
 *   - A ghost element that follows the cursor
 *   - Lifecycle hooks (drag start, drag end)
 */
export interface IDragSource {
  readonly type: string;

  /** Create the ghost element that follows the cursor during drag */
  createGhost(): HTMLElement;

  /** The data payload — what is being dragged */
  getDragData(): DragSourceData;

  /** Called when the drag starts (after threshold is met) */
  onDragStart(): void;

  /** Called when the drag ends (success, cancel, or dropped) */
  onDragEnd(result: DragResult): void;
}

/**
 * ─── Drop Target ─────────────────────────────────────────────────────────
 */

/** Visual feedback a target returns when a source hovers over it */
export interface TargetFeedback {
  /** CSS class(es) to set on the target element */
  cssClass?: string;
  /** Whether to show a ghost overlay (for grid drops) */
  showGhost?: boolean;
  /** Ghost configuration (passed to GhostRenderer) */
  ghostConfig?: Record<string, unknown>;
  /** Re-usable indicator element key — target creates/manages its own DOM */
  indicatorKey?: string;
  /** True while the cursor is over a tab bar (vs the cell/sidebar body). The
   *  host fades the drag ghost / softens the drop box so the tab-bar insert
   *  line reads clearly. */
  overTabBar?: boolean;
}

/**
 * A drop target provides its own visual feedback and handles the drop.
 */
export interface IDropTarget {
  readonly type: string;

  /** The DOM element for this target (for hit-testing and coordinate space) */
  readonly element: HTMLElement;

  /**
   * Called while a source hovers over this target.
   * The target returns visual feedback (indicators, highlights, overlays).
   * Return null if the drop should be rejected.
   */
  onHover(source: IDragSource, clientX: number, clientY: number): TargetFeedback | null;

  /**
   * Called when the source is dropped on this target.
   * The target performs the workspace operations.
   */
  onDrop(source: IDragSource, clientX: number, clientY: number): Promise<DragResult>;

  /**
   * Called when the cursor leaves this target.
   * The target cleans up its visual indicators.
   */
  onLeave(): void;
}

/**
 * ─── Drag Handler (Orchestrator) ────────────────────────────────────────
 *
 * The central coordinator. Production: RealDragHandler listens for
 * mouse events. Test: TestDragHandler just calls simulateDrag() directly.
 */
export interface IDragHandler {
  /**
   * Programmatic drag — the only method tests need.
   * Tests construct a DragSource and DragTarget and call this directly.
   */
  simulateDrag(source: IDragSource, target: IDropTarget): Promise<DragResult>;

  /**
   * Start a drag from a source (called by RealDragHandler on mousedown).
   * The handler manages the ghost, tracks cursor, finds targets, delegates
   * feedback, and dispatches the drop.
   */
  startDrag(source: IDragSource, clientX: number, clientY: number): void;

  /** Cancel the current drag (escape key, context menu) */
  cancelDrag(): void;

  /** Whether a drag is in progress */
  readonly isDragging: boolean;
}

/**
 * Result of a completed drag operation.
 */
export type DragResult = { success: true } | { success: false; reason?: string };
