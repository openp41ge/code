/**
 * Core interfaces for the openp41ge-core-tabs package.
 *
 * No Electron/IPC dependencies.  Cross-window integration is handled
 * via CustomEvents fired on `document`.
 */

// ─── Drag Source Data ─────────────────────────────────────────────────────

/**
 * A typed extension payload drag. `payload` is an extension-API `DragPayload`
 * (kept structural here so this package does not depend on the contract);
 * `contexts` / `crossWindow` come from the source declaration. The host
 * resolves it to a consumer via `setPayloadOpenResolver`.
 */
export interface PayloadDragData {
  type: "payload";
  payload: { kind: string } & Record<string, unknown>;
  sourceId: string;
  contexts: readonly string[];
  crossWindow?: boolean;
  title?: string;
}

/** What a resolved payload opens: an app type and its tab config. */
export interface PayloadOpen {
  appType: string;
  tabConfig: Record<string, unknown>;
}

/**
 * Host-injected: resolve a payload drag over a grid to the consumer that opens
 * it, or null when nothing may open it there (no consumer, or the grid's
 * window context is not in the source's contexts).
 */
export type PayloadOpenResolver = (
  data: PayloadDragData,
  target: { winId: string; element: HTMLElement },
) => PayloadOpen | null;

export type DragSourceData =
  | PayloadDragData
  | { type: "tab"; tabId: string; winId: string; worksetId: string; title?: string }
  | { type: "openp41ge-tab"; tabId: string; winId: string; worksetId: string; title?: string }
  | { type: "system-tab"; tabId: string; side: string; winId: string; title?: string }
  | { type: "manager-tab"; tabId: string; winId: string; title?: string }
  | { type: "file"; filePath: string; fileName?: string }
  | {
      type: "open-tab";
      appType: string;
      title?: string;
      tabConfig?: Record<string, unknown>;
    };

// ─── Ghost Factory ─────────────────────────────────────────────────────────

export type GhostFactory = () => HTMLElement;

// ─── Drag Source ──────────────────────────────────────────────────────────

export interface IDragSource {
  readonly type: string;
  createGhost(): HTMLElement;
  getDragData(): DragSourceData;
  onDragStart(): void;
  onDragEnd(result: DragResult): void;
}

// ─── Drop Target ──────────────────────────────────────────────────────────

export interface TargetFeedback {
  cssClass?: string;
  showGhost?: boolean;
  ghostConfig?: Record<string, unknown>;
  indicatorKey?: string;
  /** True while the cursor is over a tab bar (vs the cell/sidebar body). The
   *  host uses this to fade the drag ghost / soften the drop box so the
   *  tab-bar insert line reads clearly. */
  overTabBar?: boolean;
}

export interface IDropTarget {
  readonly type: string;
  readonly element: HTMLElement;
  onHover(source: IDragSource, clientX: number, clientY: number): TargetFeedback | null;
  onDrop(source: IDragSource, clientX: number, clientY: number): Promise<DragResult>;
  onLeave(): void;
}

// ─── Drag Result ──────────────────────────────────────────────────────────

export type DragResult = { success: true } | { success: false; reason?: string };

// ─── Drag Handler (for orchestrator) ──────────────────────────────────────

export interface IDragHandler {
  simulateDrag(source: IDragSource, target: IDropTarget): Promise<DragResult>;
  startDrag(source: IDragSource, clientX: number, clientY: number): void;
  cancelDrag(): void;
  readonly isDragging: boolean;
}
