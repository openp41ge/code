import type { CloneProgress, CloneResult } from "./types";

/**
 * Wraps a clone operation with progress tracking and abort capability.
 */
export class CloneSession {
  private _progressFns: Set<(progress: CloneProgress) => void> = new Set();
  private _destroyFn: (() => void) | null = null;

  constructor(
    readonly promise: Promise<CloneResult>,
    onProgress: (fn: (progress: CloneProgress) => void) => () => void,
    destroy: () => void,
  ) {
    this._destroyFn = destroy;
    onProgress((p) => {
      for (const fn of this._progressFns) {
        fn(p);
      }
    });
  }

  /** Register a progress callback. Returns an unsubscribe function. */
  onProgress(fn: (progress: CloneProgress) => void): () => void {
    this._progressFns.add(fn);
    return () => {
      this._progressFns.delete(fn);
    };
  }

  /** Abort the clone. */
  destroy(): void {
    this._destroyFn?.();
    this._destroyFn = null;
  }
}
