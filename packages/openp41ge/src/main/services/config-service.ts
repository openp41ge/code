/**
 * ConfigService — reads/writes `<openp41geDir>/.config/config.json` from the main process.
 *
 * The .config directory is dot-prefixed so it doesn't appear as a project
 * in the app-data root (projects are direct subdirectories like
 * ~/.openp41ge-code/myproject/; the dev build uses ~/.openp41ge-code-dev/).
 *
 * On startup:
 * - If the file exists, it is read and parsed.
 * - If the file is missing, a config with defaults is created.
 * - External edits are detected via fs.watchFile.
 *
 * Write strategy: atomic write (temp file + rename) to prevent corruption.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "openp41ge-core-logger";
import { captureError } from "./sentry.js";
import { APP_DATA_DIR_PRODUCTION } from "./app-data-dir.js";

const log = createLogger("openp41ge", "ConfigService");

// ─── Default config ──────────────────────────────────────────────────────

/** Settings every kind of editor follows (`editor/*`). */
export interface SharedEditorSettings {
  /** Line height (px). */
  lineHeight: number;
  /** Font size (px). */
  fontSize: number;
}

export interface UserConfig {
  version: number;
  /** "system" follows the OS colour scheme. */
  appTheme: "system" | "dark" | "light";
  /** Auto-update channel — "latest" (stable) or a prerelease track ("alpha"/"beta"/"rc").
   *  The default stable channel never receives prerelease builds. */
  updateChannel: "latest" | "alpha" | "beta" | "rc";
  /** Settings every editor follows (file and JSON editors); a kind's own
   *  section (`editor/file`, `editor/json`) wins over these. */
  "editor/*": SharedEditorSettings;
  /** The file editor's settings. */
  "editor/file": Partial<SharedEditorSettings> & {
    /** Max file size in bytes the editor will open (larger files show a "too large" message). */
    maxFileSize: number;
    /** Whether the file editor wraps long lines by default (a file's own toggle wins). */
    wordWrap: boolean;
    /** Saving a file removes spaces and tabs at the end of its lines. */
    trimTrailingWhitespace: boolean;
    /** Saving a non-empty file ends it with a newline. */
    insertFinalNewline: boolean;
  };
  /** The JSON editors' (Settings editor, workspace editor) overrides. */
  "editor/json": Partial<SharedEditorSettings>;
  /**
   * Which consumer opens a dropped payload kind, when more than one can:
   * kind (`namespace/kind`) → consumer id (`<extensionId>/<id>`, or a bare
   * platform id). Unset kinds use the first registered consumer.
   */
  dragConsumers: Record<string, string>;
  /**
   * Which extension's definition of a binary the scoped terminal runs, when
   * more than one defines it: binary → extension id. Unset binaries use an
   * official extension's definition (or the only one).
   */
  commandBinaries: Record<string, string>;
  /** The scoped terminal's limits for every run. */
  terminal: {
    /** A run is stopped after this many seconds. */
    timeoutSeconds: number;
    /** Output past this many KB is dropped. */
    maxOutputKb: number;
  };
}

/** Default max file size the editor opens: 50 MB (VSCode's files.maxFileSize default). */
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Derive the update channel implied by an installed version's prerelease
 * segment, so a prerelease build defaults to its own track out of the box:
 *   "0.1.0-alpha.10"  -> "alpha"
 *   "0.1.0-beta.3"    -> "beta"
 *   "0.1.0-rc.1"      -> "rc"
 *   "0.1.0"           -> "latest" (stable)
 *
 * GitHub's `releases/latest` endpoint only resolves NON-prerelease releases,
 * so a build whose channel is "latest" against a repo that has only alpha
 * prereleases would fail the update check with
 * ERR_UPDATER_LATEST_VERSION_NOT_FOUND (the endpoint 302 -> /releases -> 406
 * for a JSON accept header). Defaulting a prerelease build to its own track
 * keeps the startup check on the atom-feed walk, which resolves fine.
 */
export function updateChannelForVersion(version: string): UserConfig["updateChannel"] {
  const m = /-(alpha|beta|rc)(?:\.|$)/i.exec(version ?? "");
  return m ? (m[1].toLowerCase() as UserConfig["updateChannel"]) : "latest";
}

const DEFAULT_CONFIG: UserConfig = {
  version: 1,
  appTheme: "dark",
  updateChannel: "latest",
  "editor/*": { lineHeight: 20, fontSize: 14 },
  "editor/file": {
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    wordWrap: false,
    trimTrailingWhitespace: true,
    insertFinalNewline: true,
  },
  "editor/json": {},
  dragConsumers: {},
  commandBinaries: {},
  terminal: { timeoutSeconds: 60, maxOutputKb: 256 },
};

/** The agents extension's id: its config section takes the retired
 *  platform `agent` settings (see `_migrateConfig`). */
const AGENTS_EXTENSION_ID = "openp41ge-extension-agents";

/** The Explorer extension's id: its config section takes the retired
 *  platform `explorer` settings (see `_migrateConfig`). */
const EXPLORER_EXTENSION_ID = "openp41ge-extension-explorer";

/**
 * Old editor setting → where it is now, newest name first (when two old
 * names hold a value, the first one moved wins).
 */
const MOVED_EDITOR_SETTINGS: ReadonlyArray<readonly [from: string, to: string]> = [
  ["lineHeight", "editor/*.lineHeight"],
  ["editor.lineHeight", "editor/*.lineHeight"],
  ["editorFontSize", "editor/*.fontSize"],
  ["fontSize", "editor/*.fontSize"],
  ["editor.fontSize", "editor/*.fontSize"],
  ["editor.maxFileSize", "editor/file.maxFileSize"],
  ["editor.wordWrap", "editor/file.wordWrap"],
  ["editor.trimTrailingWhitespace", "editor/file.trimTrailingWhitespace"],
  ["editor.insertFinalNewline", "editor/file.insertFinalNewline"],
];

/** The value at a dot path (`a.b`), or undefined. */
function readPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const key of dotPath.split(".")) {
    if (!cur || typeof cur !== "object" || !(key in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Set the value at a dot path, creating sections on the way. */
function writePath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** Remove the value at a dot path (its section is left in place). */
function deletePath(obj: Record<string, unknown>, dotPath: string): void {
  const keys = dotPath.split(".");
  const parent = readPath(obj, keys.slice(0, -1).join("."));
  const target = keys.length === 1 ? obj : parent;
  if (target && typeof target === "object") {
    delete (target as Record<string, unknown>)[keys[keys.length - 1]];
  }
}

/** A provider's legacy `model` becomes `defaultModel` (unless that is set),
 *  and the legacy `providerId` becomes `defaultProviderId`. */
function renameLegacyKeys(agent: Record<string, unknown>): void {
  if ("providerId" in agent) {
    if (agent.defaultProviderId === undefined) agent.defaultProviderId = agent.providerId;
    delete agent.providerId;
  }
  const providers = agent.providers;
  if (!providers || typeof providers !== "object") return;
  for (const provider of Object.values(providers) as Array<Record<string, unknown>>) {
    if (provider && typeof provider === "object" && "model" in provider) {
      if (
        typeof provider.model === "string" &&
        (provider.defaultModel === undefined || provider.defaultModel === "")
      ) {
        provider.defaultModel = provider.model;
      }
      delete provider.model;
    }
  }
}

// ─── Helper: reduce a config to its overrides (defaults are implied) ─────

/**
 * Return a copy of `value` with every leaf equal to its `defaults` entry
 * removed — the overrides-only shape that is persisted to disk. Defaults are
 * implied by the platform, so they don't need to be stored; the config file
 * holds only what the user explicitly set. Arrays and primitives are leaves: an
 * entry is kept when it differs from the default.
 *
 * `explicitKeys` (dot-joined leaf paths the user explicitly "pinned") are kept
 * even when they equal the default — a pinned value is stored so a future
 * default change won't silently move it.
 */
function toOverrides(
  value: unknown,
  defaults: unknown = DEFAULT_CONFIG,
  explicitKeys?: Set<string>,
  path = "",
): unknown {
  if (Array.isArray(value)) {
    if (path !== "" && explicitKeys?.has(path)) return value;
    return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value;
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const def = (
      defaults && typeof defaults === "object" && !Array.isArray(defaults) ? defaults : {}
    ) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const dv = src[key];
      if (dv === undefined) continue;
      const cur = path ? `${path}.${key}` : key;
      if (Array.isArray(dv)) {
        if (path !== "" && explicitKeys?.has(cur)) out[key] = dv;
        else if (JSON.stringify(dv) !== JSON.stringify(def[key])) out[key] = dv;
      } else if (dv !== null && typeof dv === "object") {
        const pruned = toOverrides(dv, def[key], explicitKeys, cur);
        if (pruned !== undefined && Object.keys(pruned as object).length > 0) out[key] = pruned;
      } else if (
        JSON.stringify(dv) !== JSON.stringify(def[key]) ||
        (explicitKeys?.has(cur) ?? false)
      ) {
        out[key] = dv;
      }
    }
    return out;
  }
  return JSON.stringify(value) === JSON.stringify(defaults) ? undefined : value;
}

/** Collect the dot-joined leaf paths of a config value (the paths the user has
 *  explicitly written). Used to remember pins (values equal to their default)
 *  across a restart so they aren't pruned by `toOverrides`. */
function collectLeafPaths(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectLeafPaths(value[i], `${prefix}[${i}]`, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectLeafPaths(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.add(prefix);
  return out;
}

// ─── Helper: deep merge ──────────────────────────────────────────────────

/** Recursively sort every object key alphabetically so the persisted config
 *  (and the overrides the renderer seeds its settings editors with) reads in
 *  a stable, predictable order. Array element order is preserved. */
function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v)) as T;
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out as T;
  }
  return value;
}

/** The overrides-only config with its keys sorted alphabetically — used both
 *  for the persisted file and for the renderer's settings-editor seed. */
function sortedOverrides(
  config: UserConfig,
  explicitKeys: Set<string>,
  defaults: UserConfig,
): Record<string, unknown> {
  return sortKeys(toOverrides(config, defaults, explicitKeys)) as Record<string, unknown>;
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      if (
        typeof val === "object" &&
        !Array.isArray(val) &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(
          result[key] as unknown as Record<string, unknown>,
          val as unknown as Record<string, unknown>,
        ) as unknown as T[keyof T];
      } else {
        result[key] = val as T[keyof T];
      }
    }
  }
  return result;
}

// ─── ConfigService ───────────────────────────────────────────────────────

export class ConfigService {
  /** The platform defaults, with `updateChannel` set from the installed build
   *  (see `updateChannelForVersion`). Kept distinct from the module-level
   *  `DEFAULT_CONFIG` so a prerelease build's implied channel isn't persisted
   *  as a user override. */
  private readonly _platformDefaults: UserConfig;
  private _config: UserConfig;
  /** Dot-joined leaf paths the user has explicitly set (from the file and from
   *  `set`). Pins (values equal to their default) are kept in this set so
   *  `toOverrides` doesn't prune them and they survive a restart. */
  private _explicitKeys = new Set<string>();
  private _configPath: string;
  private _configDir: string;
  private _watchHandle: fs.FSWatcher | null = null;
  private _changeListeners = new Set<(config: UserConfig) => void>();

  /** Allow OPENP41GE_DIR override (used in tests).
   *  @param updateChannel The platform-default update channel. Callers pass
   *  `updateChannelForVersion(app.getVersion())` so a prerelease build (e.g.
   *  v0.1.0-alpha.10) checks its own track; tests/dev default to "latest". */
  constructor(openp41geDir?: string, updateChannel: UserConfig["updateChannel"] = "latest") {
    // Callers pass the resolved app-data root. `~/.openp41ge-code` is only a safety
    // default for direct construction without the resolved root.
    const baseDir = openp41geDir ?? path.join(os.homedir(), APP_DATA_DIR_PRODUCTION);
    this._configDir = path.join(baseDir, ".config");
    this._configPath = path.join(this._configDir, "config.json");
    this._platformDefaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as UserConfig;
    this._platformDefaults.updateChannel = updateChannel;
    this._config = structuredClone(this._platformDefaults);
  }

  /** Load config from disk on startup. Creates with defaults if missing. */
  init(): void {
    try {
      if (!fs.existsSync(this._configDir)) {
        fs.mkdirSync(this._configDir, { recursive: true });
      }

      if (fs.existsSync(this._configPath)) {
        const raw = fs.readFileSync(this._configPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<UserConfig>;
        this._config = deepMerge({ ...structuredClone(this._platformDefaults) }, parsed);
        // Everything in the file is explicitly set, so remember its leaf paths
        // as pins/overrides so they aren't pruned by `toOverrides`.
        this._explicitKeys = collectLeafPaths(parsed);
        if (this._migrateConfig(this._config)) {
          // Persist the migrated shape back to disk so legacy keys (e.g. the
          // provider-level `model` field) are physically removed and don't
          // reappear on the next load.
          this._writeAtomic(this._config);
        }
        log.info("config-loaded", { source: "file", path: this._configPath });
      } else {
        this._explicitKeys.clear();
        this._writeAtomic(this._config);
        log.info("config-initialized", { source: "defaults", path: this._configPath });
      }

      this._watch();
    } catch (err) {
      // Recoverable — falls back to defaults. warn (not error) so it doesn't
      // forward to the renderer's error capture.
      log.warn("init error:", err);
      captureError(err, {
        tags: { operation: "config.load" },
        extra: { configPath: path.basename(this._configPath) },
        level: "warning",
      });
      this._config = structuredClone(this._platformDefaults);
    }
  }

  /** Get the entire config or a specific key (dot-separated). */
  get(key?: string): unknown {
    log.debug("config-get", { key: key ?? "(all)" });
    if (!key) return this._config;
    return this._resolveKey(key);
  }

  /** Get the entire config object. */
  getAll(): UserConfig {
    return this._config;
  }

  /** The raw platform defaults (NOT merged with user overrides). The renderer
   *  uses these to render the faded defaults overlay in settings editors and
   *  to compute what the user has actually overridden. */
  getDefaults(): UserConfig {
    return JSON.parse(JSON.stringify(this._platformDefaults)) as UserConfig;
  }

  /** The raw persisted overrides — the values the user explicitly wrote (incl.
   *  pinned values equal to their default). This is the exact shape stored on
   *  disk, so settings editors can distinguish user-written values from implied
   *  defaults. */
  getOverrides(): UserConfig {
    return sortedOverrides(
      this._config,
      this._explicitKeys,
      this._platformDefaults,
    ) as unknown as UserConfig;
  }

  /** Set a config key (dot-separated) and persist to disk. */
  set(key: string, value: unknown): void {
    log.debug("config-set", { key, value });
    // An externally-set LEAF value is treated as explicit (a "pin"): it's
    // stored even when it equals the default, so a future default change won't
    // move it. Bulk container writes (e.g. saving the whole `agent` object) are
    // NOT pinned — their default-valued leaves are still pruned, preserving the
    // overrides-only persistence.
    if (key && !(value !== null && typeof value === "object" && !Array.isArray(value))) {
      this._explicitKeys.add(key);
    }
    const keys = key.split(".");
    let obj: Record<string, unknown> = this._config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]] as Record<string, unknown>;
    }
    obj[keys[keys.length - 1]] = value;
    // Strip any legacy keys (e.g. the provider-level `model`) before writing so
    // a stale editor/renderer can never re-persist them.
    this._migrateConfig(this._config);
    this._writeAtomic(this._config);
    this._notify();
  }

  /** Subscribe to config changes. Returns unsubscribe function. */
  onChange(callback: (config: UserConfig) => void): () => void {
    this._changeListeners.add(callback);
    return () => this._changeListeners.delete(callback);
  }

  /** Destroy — stop file watcher, clear listeners. */
  destroy(): void {
    if (this._watchHandle) {
      this._watchHandle.close();
      this._watchHandle = null;
    }
    this._changeListeners.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private _resolveKey(key: string): unknown {
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

  /** Atomic write: write the overrides-only config to temp file, then rename.
   *  Defaults are implied by the platform, so the file stores only what the
   *  user has explicitly set (keys equal to their default are pruned). */
  private _writeAtomic(config: UserConfig): void {
    try {
      if (!fs.existsSync(this._configDir)) {
        fs.mkdirSync(this._configDir, { recursive: true });
      }
      const tmpPath = this._configPath + ".tmp";
      fs.writeFileSync(
        tmpPath,
        JSON.stringify(
          sortedOverrides(config, this._explicitKeys, this._platformDefaults),
          null,
          2,
        ),
        "utf-8",
      );
      fs.renameSync(tmpPath, this._configPath);
    } catch (err) {
      log.warn("write error:", err);
      captureError(err, {
        tags: { operation: "config.save" },
        extra: { configPath: path.basename(this._configPath) },
        level: "error",
      });
    }
  }

  /** Watch for external file changes. */
  private _watch(): void {
    try {
      if (!fs.existsSync(this._configPath)) return;
      // Use watchFile for cross-platform compatibility
      fs.watchFile(this._configPath, { interval: 2000 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
          try {
            const raw = fs.readFileSync(this._configPath, "utf-8");
            const parsed = JSON.parse(raw) as Partial<UserConfig>;
            this._config = deepMerge({ ...structuredClone(this._platformDefaults) }, parsed);
            if (this._migrateConfig(this._config)) {
              this._writeAtomic(this._config);
            }
            this._notify();
          } catch {
            // Ignore parse errors during rapid writes
          }
        }
      });
    } catch (err) {
      log.warn("watch error:", err);
    }
  }

  /** Promote stale/legacy config keys into the current shape. Returns true when
   *  the config was changed (so the caller can persist the cleaned shape).
   *
   *  Renames the provider-level default model from the legacy `model` key to
   *  `defaultModel` (so it reads as the default, distinct from the `models`
   *  list). Any `model` key on a provider is stale now, so it is always
   *  removed — the value is promoted to `defaultModel` only when `defaultModel`
   *  is not already set. */
  private _migrateConfig(config: UserConfig): boolean {
    let changed = false;
    // The platform's agent settings are the agents extension's config now
    // (`extensions.<id>`): move them there — renaming a provider's legacy
    // `model` to `defaultModel` and `providerId` to `defaultProviderId` on
    // the way — unless the extension already
    // has its own, which wins.
    const cfg = config as unknown as Record<string, unknown>;
    const agent = cfg.agent;
    if (agent !== undefined) {
      if (agent && typeof agent === "object" && !Array.isArray(agent)) {
        renameLegacyKeys(agent as Record<string, unknown>);
        const extensions = (cfg.extensions ??= {}) as Record<string, unknown>;
        if (extensions[AGENTS_EXTENSION_ID] === undefined) {
          extensions[AGENTS_EXTENSION_ID] = agent;
        }
      }
      delete cfg.agent;
      changed = true;
    }
    // Likewise the platform's Explorer settings are the Explorer extension's
    // config now; its own section, when present, wins.
    const explorer = cfg.explorer;
    if (explorer !== undefined) {
      if (explorer && typeof explorer === "object" && !Array.isArray(explorer)) {
        const extensions = (cfg.extensions ??= {}) as Record<string, unknown>;
        if (extensions[EXPLORER_EXTENSION_ID] === undefined) {
          extensions[EXPLORER_EXTENSION_ID] = explorer;
        }
      }
      delete cfg.explorer;
      changed = true;
    }
    // Retired settings nothing read: syntax themes (and the editor font
    // family, dropped with the old `editor` section below).
    if ("syntaxThemes" in cfg) {
      delete cfg.syntaxThemes;
      changed = true;
    }
    if (this._moveEditorSettings(cfg)) changed = true;
    return changed;
  }

  /**
   * Move the editor settings from their old keys into `editor/*` (every
   * editor) and `editor/file` (the file editor). A value the user already
   * wrote at the new key wins; a moved value stays explicit (so one pinned at
   * its default is kept). The old `editor` section is dropped. Returns true
   * when anything moved.
   */
  private _moveEditorSettings(cfg: Record<string, unknown>): boolean {
    let changed = false;
    for (const [from, to] of MOVED_EDITOR_SETTINGS) {
      const value = readPath(cfg, from);
      if (value === undefined) continue;
      deletePath(cfg, from);
      this._explicitKeys.delete(from);
      changed = true;
      if (this._explicitKeys.has(to)) continue;
      writePath(cfg, to, value);
      this._explicitKeys.add(to);
    }
    if ("editor" in cfg) {
      delete cfg.editor;
      for (const key of [...this._explicitKeys]) {
        if (key.startsWith("editor.")) this._explicitKeys.delete(key);
      }
      changed = true;
    }
    return changed;
  }

  private _notify(): void {
    for (const fn of this._changeListeners) {
      try {
        fn(this._config);
      } catch (err) {
        log.warn("listener error:", err);
      }
    }
  }
}
