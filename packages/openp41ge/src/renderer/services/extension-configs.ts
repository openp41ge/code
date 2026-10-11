/**
 * extension-configs.ts — the renderer side of extension config (AGENTS.md
 * §2.9): the cache behind each surface's `host.config`.
 *
 * At load, a renderer entry's `registerConfigSchema` schema is sent to main
 * (which stores the values and merges them with the schema's defaults) and
 * the merged values are read once, so `host.config.get()` is synchronous.
 * Main broadcasts every change of an extension's merged config; the cache
 * takes it and calls that extension's subscribers.
 */

import type { ConfigSchema, ExtensionConfig, SurfaceConfigHost } from "openp41ge-sdk";

/** A change of one extension's merged config (main → every window). */
export interface ExtensionConfigChange {
  readonly extensionId: string;
  readonly config: ExtensionConfig;
}

/** What the config editor needs for one extension (main's `describe`). */
export interface ExtensionConfigDescription {
  readonly schema: ConfigSchema;
  readonly defaults: Record<string, unknown>;
  readonly overrides: Record<string, unknown>;
}

/** The `extension-config:*` IPC bridge (`window.openp41ge.extension.config`). */
export interface ExtensionConfigBridge {
  registerSchema(id: string, schema: ConfigSchema): Promise<void>;
  get(id: string): Promise<ExtensionConfig>;
  describe(id: string): Promise<ExtensionConfigDescription | null>;
  set(id: string, overrides: Record<string, unknown>): Promise<void>;
  onChanged(fn: (change: ExtensionConfigChange) => void): () => void;
}

export class ExtensionConfigs {
  private readonly _values = new Map<string, ExtensionConfig>();
  private readonly _listeners = new Map<string, Set<(config: ExtensionConfig) => void>>();

  constructor(private readonly _bridge: ExtensionConfigBridge) {
    _bridge.onChanged(({ extensionId, config }) => {
      this._values.set(extensionId, config);
      for (const fn of this._listeners.get(extensionId) ?? []) fn(config);
    });
  }

  /** Send the renderer entry's schema (when it registered one), then cache
   *  the merged values. Rejects when main refuses the schema. */
  async load(extensionId: string, schema: ConfigSchema | null): Promise<void> {
    if (schema) await this._bridge.registerSchema(extensionId, schema);
    this._values.set(extensionId, await this._bridge.get(extensionId));
  }

  /** The `host.config` of an extension's surfaces. */
  hostFor(extensionId: string, openEditor: () => void): SurfaceConfigHost {
    return {
      get: () => this._values.get(extensionId) ?? {},
      subscribe: (fn) => {
        let set = this._listeners.get(extensionId);
        if (!set) this._listeners.set(extensionId, (set = new Set()));
        set.add(fn);
        return () => set.delete(fn);
      },
      openEditor,
    };
  }
}

/** The bridge where the preload provides none (tests, a bare page). */
const INERT_BRIDGE: ExtensionConfigBridge = {
  registerSchema: async () => undefined,
  get: async () => ({}),
  describe: async () => null,
  set: async () => {
    throw new Error("extension config is not available");
  },
  onChanged: () => () => undefined,
};

let shared: ExtensionConfigs | null = null;

/** This window's extension config cache. */
export function extensionConfigs(): ExtensionConfigs {
  shared ??= new ExtensionConfigs(window.openp41ge?.extension?.config ?? INERT_BRIDGE);
  return shared;
}
