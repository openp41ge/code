/**
 * PayloadDragSource — drag source for an extension's typed `DragPayload`
 * (started by the extension drag service via `startPayloadDrag`).
 *
 * As with file / git-entry rows, the visible ghost is the main-process
 * `DragGhostManager` window rendered from a captured bitmap of the source
 * element, so the in-DOM ghost is invisible and the source element is left
 * untouched (its opacity must not change before capture).
 */

import type { IDragSource, DragResult, PayloadDragData } from "../../openp41ge-tabs-adapter";

export class PayloadDragSource implements IDragSource {
  readonly type = "payload";

  constructor(private readonly _data: PayloadDragData) {}

  createGhost(): HTMLElement {
    const ghost = document.createElement("div");
    ghost.style.cssText =
      "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px;z-index:-1;";
    return ghost;
  }

  getDragData(): PayloadDragData {
    return this._data;
  }

  onDragStart(): void {
    // The source element stays at full opacity: the ghost bitmap is captured
    // from it after this fires.
  }

  onDragEnd(_result: DragResult): void {
    // Nothing to clean up — the in-DOM ghost is removed by the orchestrator.
  }
}
