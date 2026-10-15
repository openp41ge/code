/**
 * Renderer-side ConfigService — loads config on startup, caches in memory,
 * provides typed accessors, emits events on change.
 *
 * On mount, calls window.openp41ge.config.getAll() to populate the cache.
 * Changes are debounced and re-fetched from the main process.
 */

import { createLogger } from "openp41ge-core-logger";

import { MediaColorScheme, type SystemColorScheme } from "./system-color-scheme";

const log = createLogger("openp41ge", "config-service");

// ─── Config type (mirrors main process types) ────────────────────────────

export interface UserConfig {
  version: number;
  /** "system" follows the OS colour scheme. */
  appTheme: "system" | "dark" | "light";
  /** Auto-update channel — "latest" (stable) or a prerelease track ("alpha"/"beta"/"rc"). */
  updateChannel: "latest" | "alpha" | "beta" | "rc";
  /** Settings every editor follows; `editor/file` / `editor/json` win over
   *  these (see `editor-settings.ts`). */
  "editor/*": { lineHeight: number; fontSize: number };
  /** The file editor's settings. */
  "editor/file": {
    lineHeight?: number;
    fontSize?: number;
    /** Max file size in bytes the editor will open (larger files show a "too large" message). */
    maxFileSize: number;
    /** Whether the file editor wraps long lines by default. */
    wordWrap: boolean;
    /** Saving a file removes spaces and tabs at the end of its lines. */
    trimTrailingWhitespace: boolean;
    /** Saving a non-empty file ends it with a newline. */
    insertFinalNewline: boolean;
  };
  /** The JSON editors' overrides. */
  "editor/json": { lineHeight?: number; fontSize?: number };
}

// ─── ConfigService ───────────────────────────────────────────────────────

export class ConfigService {
  /** Whether the applied theme follows the OS colour scheme's changes yet. */
  private _followingScheme = false;

  constructor(private readonly _scheme: SystemColorScheme = new MediaColorScheme()) {}

  private _config: UserConfig | null = null;
  private _loaded = false;
  private _loadPromise: Promise<void> | null = null;
  private _changeListeners = new Set<(config: UserConfig) => void>();
  private _keyListeners = new Map<string, Set<(value: unknown) => void>>();

  /** Load config from the main process via IPC. Idempotent — safe to call early. */
  async load(): Promise<void> {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._doLoad();
    return this._loadPromise;
  }

  private async _doLoad(): Promise<void> {
    try {
      // Renderer-only / browser dev runs without the Electron preload bridge,
      // so config can't be fetched. Skip gracefully instead of erroring (the
      // error-capture overlay treats console.error as a blocking failure).
      if (typeof window.openp41ge === "undefined") {
        log.warn("preload bridge not available, skipping config load");
        this._loaded = false;
        return;
      }
      const raw = await window.openp41ge.config.getAll();
      this._config = raw as UserConfig;
      this._loaded = true;
      log.info("config loaded");
      this._bindOnChanged();
    } catch (err) {
      log.error("failed to load config:", err, { skipToast: true });
      this._loaded = false;
    }
  }

  /** Whether config has been loaded from the main process. */
  get loaded(): boolean {
    return this._loaded;
  }

  /** Mirror config changes written by ANOTHER window (main-process broadcast).
   *  Updates this window's cache and dispatches the same local
   *  `openp41ge:config-changed` event so editors/listeners react, exactly as if
   *  the change had been made here. */
  private _bindOnChanged(): void {
    const bridge = (window as unknown as { openp41ge?: { config?: { onChanged?: Function } } })
      .openp41ge?.config;
    if (!bridge || typeof bridge.onChanged !== "function") return;
    try {
      bridge.onChanged((incoming: unknown) => {
        const detail = (incoming ?? {}) as { key?: string; value?: unknown };
        const key = detail.key;
        if (!key) return;
        // Update the local cache in place.
        if (this._config) {
          const keys = key.split(".");
          let obj = this._config as unknown as Record<string, unknown>;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") obj[keys[i]] = {};
            obj = obj[keys[i]] as Record<string, unknown>;
          }
          obj[keys[keys.length - 1]] = detail.value;
        }
        this._notifyAll();
        this._notifyKey(key, detail.value);
        document.dispatchEvent(
          new CustomEvent("openp41ge:config-changed", {
            detail: { key, value: detail.value },
            bubbles: true,
            composed: true,
          }),
        );
      });
    } catch (err) {
      log.debug("config onChanged subscribe failed:", err);
    }
  }

  /** Get a specific key (dot-separated, e.g., "editor/file.maxFileSize"). */
  get(key: string): unknown {
    if (!this._config) return undefined;
    const keys = key.split(".");
    let obj: unknown = this._config;
    for (const k of keys) {
      if (obj === null || obj === undefined) return undefined;
      if (typeof obj === "object" && k in (obj as Record<string, unknown>)) {
        obj = (obj as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }
    return obj;
  }

  /** Get the entire config object. */
  getAll(): UserConfig | null {
    return this._config;
  }

  /** The raw platform defaults (NOT merged with user overrides). Settings
   *  editors use these to render the faded defaults overlay and to compute
   *  which values the user has actually overridden. */
  async getDefaults(): Promise<UserConfig | null> {
    try {
      if (typeof window.openp41ge === "undefined") return null;
      return (await window.openp41ge.config.getDefaults()) as UserConfig;
    } catch (err) {
      log.debug("renderer config getDefaults failed:", err);
      return null;
    }
  }

  /** The raw persisted overrides (values the user wrote, including pinned
   *  defaults) — used to seed the settings editors' override view. */
  async getOverrides(): Promise<UserConfig | null> {
    try {
      if (typeof window.openp41ge === "undefined") return null;
      return (await window.openp41ge.config.getOverrides()) as UserConfig;
    } catch (err) {
      log.debug("renderer config getOverrides failed:", err);
      return null;
    }
  }

  /** Set a config key (dot-separated) via IPC, updates cache, emits events. */
  async set(key: string, value: unknown): Promise<void> {
    try {
      await window.openp41ge.config.set(key, value);
      // Update local cache
      const keys = key.split(".");
      if (this._config) {
        let obj = this._config as unknown as Record<string, unknown>;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") {
            obj[keys[i]] = {};
          }
          obj = obj[keys[i]] as Record<string, unknown>;
        }
        obj[keys[keys.length - 1]] = value;
      }
      // Notify
      this._notifyAll();
      this._notifyKey(key, value);
      // Dispatch DOM event for cross-component communication
      document.dispatchEvent(
        new CustomEvent("openp41ge:config-changed", {
          detail: { key, value },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      log.error(`failed to set config key "${key}":`, err, { skipToast: true });
    }
  }

  /** Get the default syntax theme ID. */
  getSyntaxTheme(): string {
    return "openp41ge-dark";
  }

  /** Get the app theme setting ("system" | "dark" | "light"). */
  getAppTheme(): UserConfig["appTheme"] {
    const theme = this._config?.appTheme;
    return theme === "system" || theme === "light" ? theme : "dark";
  }

  /** The theme shown: the setting, or for "system" the OS colour scheme's. */
  getResolvedAppTheme(): "dark" | "light" {
    const theme = this.getAppTheme();
    if (theme !== "system") return theme;
    return this._scheme.isDark() ? "dark" : "light";
  }

  /** Subscribe to all config changes. Returns unsubscribe function. */
  onChange(callback: (config: UserConfig) => void): () => void {
    this._changeListeners.add(callback);
    return () => this._changeListeners.delete(callback);
  }

  /** Subscribe to changes for a specific key. Returns unsubscribe function. */
  onKeyChange(key: string, callback: (value: unknown) => void): () => void {
    if (!this._keyListeners.has(key)) {
      this._keyListeners.set(key, new Set());
    }
    this._keyListeners.get(key)!.add(callback);
    return () => this._keyListeners.get(key)?.delete(callback);
  }

  /** Apply the current app theme to the document. From then on, while the
   *  setting is "system", the theme changes with the OS colour scheme. */
  applyAppTheme(): void {
    const theme = this.getResolvedAppTheme();
    document.documentElement.setAttribute("data-app-theme", theme);
    log.info("app theme applied:", theme);
    if (this._followingScheme) return;
    this._followingScheme = true;
    this._scheme.onChange(() => {
      if (this.getAppTheme() === "system") this.applyAppTheme();
    });
  }

  // ── Private ──────────────────────────────────────────────────────────

  private _notifyAll(): void {
    if (!this._config) return;
    for (const fn of this._changeListeners) {
      try {
        fn(this._config);
      } catch (err) {
        log.error("change listener error:", err, { skipToast: true });
      }
    }
  }

  private _notifyKey(key: string, value: unknown): void {
    const listeners = this._keyListeners.get(key);
    if (listeners) {
      for (const fn of listeners) {
        try {
          fn(value);
        } catch (err) {
          log.error("key change listener error:", err, { skipToast: true });
        }
      }
    }
  }
}
