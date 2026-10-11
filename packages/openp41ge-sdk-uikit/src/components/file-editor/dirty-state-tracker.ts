/**
 * DirtyStateTracker — O(1) dirty-state tracking for the file editor.
 *
 * Phase 1B of the large-file-performance plan. Replaces the per-keystroke full
 * string comparison (`model.getValue() === this._savedContent`) with a version
 * comparison.
 *
 * Correctness contract: it compares the current document version against the
 * version recorded at the last save/clean point. This only works because the
 * underlying model RESTORES `versionId` on undo/redo (Monaco semantics — see
 * `openp41ge-core-editor-engine` `piece-tree-text-content-model.ts` and its
 * regression tests). With that in place an undo back to the saved document
 * reports clean; a document that permanently diverges stays dirty.
 */

export interface IDirtyStateTracker {
  readonly isDirty: boolean;
  /** Feed the model's current versionId after a content change. Returns isDirty. */
  notifyContentChanged(currentVersionId: number): boolean;
  /** Record the version at the save/clean point. */
  markSaved(currentVersionId: number): void;
  /** Drop both the baseline and the current version. */
  reset(): void;
}

export class VersionBasedDirtyTracker implements IDirtyStateTracker {
  private _savedVersionId = -1;
  private _currentVersionId = -1;

  get isDirty(): boolean {
    return (
      this._savedVersionId >= 0 &&
      this._currentVersionId >= 0 &&
      this._currentVersionId !== this._savedVersionId
    );
  }

  notifyContentChanged(currentVersionId: number): boolean {
    this._currentVersionId = currentVersionId;
    return this.isDirty;
  }

  markSaved(currentVersionId: number): void {
    this._savedVersionId = currentVersionId;
    this._currentVersionId = currentVersionId;
  }

  reset(): void {
    this._savedVersionId = -1;
    this._currentVersionId = -1;
  }
}
