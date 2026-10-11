/**
 * Manages the undo/redo stack for text edits.
 * States are stored as plain-text snapshots captured before each edit.
 */
export interface IUndoManager {
  /** Push a pre-edit state onto the undo stack. Clears any redo states. */
  push(state: string): void;

  /** Pop the undo stack and return the previous state, or null if empty. */
  undo(): string | null;

  /** Pop the redo stack and return the next state, or null if empty. */
  redo(): string | null;

  /** Save a post-edit state for the redo stack (called by the editor on undo). */
  saveForRedo(state: string): void;

  /** Save a state for re-undo on the main stack (called by the editor on redo). */
  saveForUndo(state: string): void;

  /** Clear both undo and redo stacks. */
  clear(): void;

  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly size: number;
}
