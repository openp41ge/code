/**
 * payload-cross-window.ts — source-driven cross-window payload drops.
 *
 * During a drag the SOURCE window keeps focus and receives the release; other
 * windows only draw the indicator from forwarded positions. So, as with tab
 * drags (`_tryCrossWindowDrop`), the source completes a drop over another
 * window: it asks the main process to hit-test (`drag.check`) and maps the hit
 * to a `grid-open-tab` for the target window. The existing tabs event handler
 * then dispatches the workspace operation with the target window id.
 *
 * Only another window showing the SAME workspace (or, like the source, none)
 * qualifies — the source's dispatcher owns that layout — and only when the
 * source's `contexts` allow a window.
 */

import type { PayloadDragData, PayloadOpen } from "../openp41ge-tabs-adapter";

/** One open window, as listed by `windowManager.openWindowSummaries()`. */
export interface WindowSummary {
  readonly windowId: string;
  readonly workspacePath: string | null;
}

/** The `drag.check` result: the hit target in the window under the cursor. */
export interface DragCheckResult {
  readonly windowId: string;
  readonly target: Record<string, unknown> | null;
}

/** The `grid-open-tab` detail to fire for the target window. */
export interface CrossWindowOpenDetail {
  readonly winId: string;
  readonly tabType: string;
  readonly tabConfig: Record<string, unknown>;
  readonly targetCol: number;
  /** Tab-bar index, for a release over the target cell's tab bar. */
  readonly insertAt?: number;
  readonly isBoundary?: boolean;
  readonly splitCol?: number;
  readonly splitLeft?: boolean;
  readonly pinned: true;
}

export type CrossWindowPayloadDrop =
  /** Released outside every window. */
  | { readonly kind: "outside" }
  /** Released over the source window: the local drop handles it. */
  | { readonly kind: "local" }
  /** Open in another window. */
  | { readonly kind: "open"; readonly detail: CrossWindowOpenDetail }
  /** Released over another window where it cannot open. */
  | { readonly kind: "none" };

export interface CrossWindowPayloadDropInput {
  readonly check: DragCheckResult | null;
  readonly myWinId: string;
  readonly windows: readonly WindowSummary[];
  readonly data: PayloadDragData;
  /** Kind → consumer resolution for a grid (`DragConsumerRegistry.resolve`). */
  readonly resolve: (data: PayloadDragData) => PayloadOpen | null;
}

const NONE: CrossWindowPayloadDrop = { kind: "none" };

export function resolveCrossWindowPayloadDrop(
  input: CrossWindowPayloadDropInput,
): CrossWindowPayloadDrop {
  const { check, myWinId, windows, data } = input;
  if (!check) return { kind: "outside" };
  if (check.windowId === myWinId) return { kind: "local" };
  if (!data.crossWindow) return NONE;

  const mine = windows.find((w) => w.windowId === myWinId);
  const theirs = windows.find((w) => w.windowId === check.windowId);
  if (!mine || !theirs || theirs.workspacePath !== mine.workspacePath) return NONE;
  if (!data.contexts.includes("workspace")) return NONE;

  const target = check.target;
  if (!target) return NONE;
  const winId = typeof target.winId === "string" ? target.winId : check.windowId;

  let placement: Pick<
    CrossWindowOpenDetail,
    "targetCol" | "insertAt" | "isBoundary" | "splitCol" | "splitLeft"
  >;
  if (target.type === "tab-bar") {
    placement = {
      targetCol: typeof target.col === "number" ? target.col : 0,
      ...(typeof target.dropIndex === "number" && target.dropIndex >= 0
        ? { insertAt: target.dropIndex }
        : {}),
    };
  } else if (target.type === "grid-move") {
    placement = { targetCol: typeof target.col === "number" ? target.col : 0 };
  } else if (target.type === "grid-split") {
    const splitCol = typeof target.splitCol === "number" ? target.splitCol : 0;
    const splitLeft = typeof target.splitLeft === "boolean" ? target.splitLeft : true;
    placement = { targetCol: splitCol, isBoundary: true, splitCol, splitLeft };
  } else {
    return NONE;
  }

  const open = input.resolve(data);
  if (!open) return NONE;
  return {
    kind: "open",
    detail: { winId, tabType: open.appType, tabConfig: open.tabConfig, ...placement, pinned: true },
  };
}
