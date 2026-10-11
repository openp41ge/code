/**
 * Event name constants for all DOM CustomEvents dispatched by
 * the <file-editor> web component.
 *
 * Openp41ge listens for these events at the document level.
 */

/** Fired when the file path or display title changes. */
export const EVENT_TITLE_CHANGED = "fe:title-changed" as const;

/** Fired when the content becomes dirty or clean. */
export const EVENT_DIRTY_CHANGED = "fe:dirty-changed" as const;

/** Fired after a successful file save. */
export const EVENT_FILE_SAVED = "fe:file-saved" as const;

/** Fired before the component is torn down (e.g., tab close). */
export const EVENT_REQUEST_CLOSE = "fe:request-close" as const;

// ── Detail type helpers ────────────────────────────────────────────────

export interface TitleChangedDetail {
  title: string;
  filePath: string;
}

export interface DirtyChangedDetail {
  isDirty: boolean;
}

export interface FileSavedDetail {
  filePath: string;
}

export interface RequestCloseDetail {
  filePath: string;
  isDirty: boolean;
}
