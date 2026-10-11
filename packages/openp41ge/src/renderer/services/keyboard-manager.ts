import type { IKeyboardManager, IKeyboardBinding } from "../interfaces/keyboard-manager";

/**
 * Keyboard shortcut manager with registration pattern.
 *
 * Replaces the centralized switch statement in app.ts.
 * New shortcuts are added via .register(), satisfying OCP.
 *
 * Modal lockdown: when one or more confirmation modals are active,
 * handleKeyDown() returns early, suppressing ALL registered shortcuts.
 * The modal's own document-level keydown listener handles Enter,
 * Escape, and Tab focus trapping.
 *
 * Shortcut suppression after window refocus: the event controller's
 * keyboard/suppress handler sets suppressUntil. handleKeyDown checks
 * it and ignores shortcuts within the suppression window.
 */
export class KeyboardManager implements IKeyboardManager {
  private readonly _bindings: IKeyboardBinding[] = [];
  private _modalCount = 0;

  /**
   * Timestamp before which keyboard shortcuts should be suppressed.
   * Set by the event controller's keyboard/suppress handler on window focus.
   */
  suppressUntil: number = 0;

  get isModalActive(): boolean {
    return this._modalCount > 0;
  }

  pushModal(): void {
    this._modalCount++;
  }

  popModal(): void {
    this._modalCount = Math.max(0, this._modalCount - 1);
  }

  register(binding: IKeyboardBinding): void {
    this._bindings.push(binding);
  }

  unregister(binding: IKeyboardBinding): void {
    const idx = this._bindings.indexOf(binding);
    if (idx >= 0) {
      this._bindings.splice(idx, 1);
    }
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    // When a modal is active, suppress ALL registered shortcuts.
    if (this._modalCount > 0) {
      return false;
    }

    // Suppress shortcuts for a brief period after window refocus.
    // Prevents phantom Alt+Tab/Cmd+Tab key releases from being
    // interpreted as Meta+Shift+P (openProject) or other shortcuts.
    if (this.suppressUntil > 0 && Date.now() < this.suppressUntil) {
      return false;
    }

    // Modifier bitmask: ctrl=1, alt=2, shift=4, meta=8
    const mask =
      (e.ctrlKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.shiftKey ? 4 : 0) | (e.metaKey ? 8 : 0);

    for (const binding of this._bindings) {
      const keyMatch =
        binding.key === e.key ||
        (mask & 4 && binding.key.toLowerCase() === e.key.toLowerCase()) ||
        (mask & 2 && binding.code === e.code);
      if (binding.modifiers === mask && keyMatch && binding.code === e.code) {
        e.preventDefault();
        binding.handler();
        return true;
      }
    }

    return false;
  }

  getBindings(): IKeyboardBinding[] {
    return [...this._bindings];
  }
}
