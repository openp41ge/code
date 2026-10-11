/**
 * ExtensionConfigService — extension config (AGENTS.md §2.9) over the user's
 * `config.json`.
 *
 * Each extension registers one JSON Schema (`registerConfigSchema`, from its
 * backend entry via the extension host, or its renderer entry over IPC). The
 * user's values live in `config.json` under `extensions.<extensionId>` — only
 * what the user wrote; the schema's `default`s fill in the rest. Both sides
 * read the merged values (`ctx.config.get()`, `host.config.get()`), and every
 * change to an extension's merged config is reported, whether it came from the
 * editor, another window, or the file edited by hand.
 */

import {
  configDefaults,
  configErrors,
  mergeConfig,
  validateConfigSchema,
  type ConfigSchema,
} from "openp41ge-sdk";
import type { ExtensionConfigStore } from "openp41ge-core-extension-host";

/** The part of ConfigService this service uses. */
export interface ConfigStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  onChange(callback: () => void): () => void;
}

/** What the config editor needs for one extension. */
export interface ExtensionConfigDescription {
  readonly schema: ConfigSchema;
  readonly defaults: Record<string, unknown>;
  /** The user's values (what is stored). */
  readonly overrides: Record<string, unknown>;
}

export type ExtensionConfigListener = (
  extensionId: string,
  config: Readonly<Record<string, unknown>>,
) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class ExtensionConfigService implements ExtensionConfigStore {
  private readonly _schemas = new Map<string, ConfigSchema>();
  /** The last merged config reported per extension (JSON), to report changes only. */
  private readonly _last = new Map<string, string>();
  private readonly _listeners = new Set<ExtensionConfigListener>();

  constructor(private readonly _storage: ConfigStorage) {
    this._storage.onChange(() => {
      for (const id of this._schemas.keys()) this._report(id);
    });
  }

  /** Record an extension's schema (a newer one replaces it). Throws if invalid. */
  registerSchema(extensionId: string, schema: ConfigSchema): void {
    validateConfigSchema(schema);
    this._schemas.set(extensionId, schema);
    this._report(extensionId);
  }

  /** The schema, defaults and stored values, or null without a schema. */
  describe(extensionId: string): ExtensionConfigDescription | null {
    const schema = this._schemas.get(extensionId);
    if (!schema) return null;
    return { schema, defaults: configDefaults(schema), overrides: this._overrides(extensionId) };
  }

  /** The merged config: the schema's defaults plus the user's values. */
  get(extensionId: string): Readonly<Record<string, unknown>> {
    const schema = this._schemas.get(extensionId);
    if (!schema) return {};
    return mergeConfig(configDefaults(schema), this._overrides(extensionId));
  }

  /**
   * Replace the user's values. Throws (storing nothing) when the extension has
   * no schema or the merged values do not match it.
   */
  setOverrides(extensionId: string, overrides: Record<string, unknown>): void {
    const schema = this._schemas.get(extensionId);
    if (!schema) throw new Error(`'${extensionId}' has no config schema`);
    const errors = configErrors(schema, mergeConfig(configDefaults(schema), overrides));
    if (errors.length > 0) throw new Error(errors.join("\n"));
    this._storage.set(`extensions.${extensionId}`, overrides);
  }

  /** Called with an extension's new merged config on each change. */
  onChange(listener: ExtensionConfigListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _overrides(extensionId: string): Record<string, unknown> {
    const stored = this._storage.get(`extensions.${extensionId}`);
    return isPlainObject(stored) ? stored : {};
  }

  private _report(extensionId: string): void {
    const merged = this.get(extensionId);
    const json = JSON.stringify(merged);
    const previous = this._last.get(extensionId);
    this._last.set(extensionId, json);
    if (previous === undefined || previous === json) return;
    for (const listener of this._listeners) listener(extensionId, merged);
  }
}
