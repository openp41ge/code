/**
 * Controls the bottom-bar status display showing size and dirty state.
 */
export interface IStatusBar {
  /** Mount the status bar, finding its target element inside root. */
  mount(root: HTMLElement): void;
  /** Unmount / detach the status bar. */
  unmount(): void;
  setSize(size: string): void;
  setHasChanges(dirty: boolean): void;
  setFormatter(handler: () => void): void;
  clearFormatter(): void;
  showEmpty(message: string): void;
  restore(): void;
}
