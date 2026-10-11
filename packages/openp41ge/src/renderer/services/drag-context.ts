/**
 * drag-context — shared drag state for context-menu suppression.
 *
 * Extracted from the old tab-drag-handler.ts so the functions survive
 * when that file is deleted. The boolean is used to prevent drag
 * initiation while a context menu is showing.
 */

/** Whether a context menu is currently active (drag suppression). */
let _contextMenuActive = false;

export function setContextMenuActive(active: boolean): void {
  _contextMenuActive = active;
}

export function isContextMenuActive(): boolean {
  return _contextMenuActive;
}

/**
 * Reset module-level tab drag state.
 * Formerly reset the old TabDragHandler's state machine; now a no-op
 * since the new DnD system lives in openp41ge-core-tabs.
 */
export function resetTabDragState(): void {
  // No-op: drag state is managed by openp41ge-core-tabs DragOrchestrator.
}
