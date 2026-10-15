/**
 * system-color-scheme — the OS colour scheme, for the "system" app theme.
 */

/** The OS colour scheme: whether it is dark, and when it changes. */
export interface SystemColorScheme {
  isDark(): boolean;
  /** Call `fn` whenever the scheme changes. Returns unsubscribe function. */
  onChange(fn: () => void): () => void;
}

/** The OS colour scheme as the page's `prefers-color-scheme` reports it
 *  (Electron follows the OS). Without `matchMedia` it is dark, unchanging. */
export class MediaColorScheme implements SystemColorScheme {
  private _query(): MediaQueryList | null {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  }

  isDark(): boolean {
    return this._query()?.matches ?? true;
  }

  onChange(fn: () => void): () => void {
    const query = this._query();
    if (!query) return () => {};
    query.addEventListener("change", fn);
    return () => query.removeEventListener("change", fn);
  }
}
