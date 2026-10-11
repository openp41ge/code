/**
 * Reactive application state for the core system.
 *
 * Components subscribe via observe() and re-render when notify() is called.
 * All state updates happen through terminal handlers (never through direct mutation
 * from components).
 */
export class AppState {
  // ── Focus ────────────────────────────────────────────
  windowFocused = false;
  focusedSide: "left" | "right" | null = null;

  // ── Layout ───────────────────────────────────────────
  sidebarWidths: Record<string, number> = { left: 300, right: 350 };

  // ── Workspace ────────────────────────────────────────
  activeRepoId: string | null = null;
  openWorkspaceFilePath: string | null = null;

  // ── Shortcuts ────────────────────────────────────────
  shortcutsSuppressedUntil = 0;

  // ── Observers ────────────────────────────────────────
  private _observers = new Set<() => void>();

  /** Subscribe to state changes. Returns unsubscribe function. */
  observe(cb: () => void): () => void {
    this._observers.add(cb);
    return () => {
      this._observers.delete(cb);
    };
  }

  /** Notify all observers that state has changed. */
  notify(): void {
    for (const cb of this._observers) {
      cb();
    }
  }

  /** Snapshot current state for debug logging. */
  snapshot(): AppStateSnapshot {
    return {
      windowFocused: this.windowFocused,
      focusedSide: this.focusedSide,
      sidebarWidths: { ...this.sidebarWidths },
      activeRepoId: this.activeRepoId,
      openWorkspaceFilePath: this.openWorkspaceFilePath,
      shortcutsSuppressedUntil: this.shortcutsSuppressedUntil,
    };
  }
}

/** Singleton instance. */
export const appState = new AppState();

export interface AppStateSnapshot {
  windowFocused: boolean;
  focusedSide: "left" | "right" | null;
  sidebarWidths: Record<string, number>;
  activeRepoId: string | null;
  openWorkspaceFilePath: string | null;
  shortcutsSuppressedUntil: number;
}
