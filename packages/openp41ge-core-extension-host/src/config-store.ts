/**
 * config-store.ts — where the host keeps extension config: the platform's
 * store (over `config.json`), or, without one, each schema's defaults.
 */

import { configDefaults, type ConfigSchema } from "openp41ge-sdk";

/**
 * Where extension config lives (the platform's store over `config.json`). The
 * host hands it each backend's registered schema and reads merged values from
 * it for `ctx.config.get()`.
 */
export interface ExtensionConfigStore {
  /** Record an extension's schema; throws to refuse it (a load error). */
  registerSchema(extensionId: string, schema: ConfigSchema): void;
  /** The extension's merged config (defaults + the user's values). */
  get(extensionId: string): Readonly<Record<string, unknown>>;
}

/** A store without user values: each extension gets its schema's defaults. */
export class DefaultsConfigStore implements ExtensionConfigStore {
  private readonly _schemas = new Map<string, ConfigSchema>();

  registerSchema(extensionId: string, schema: ConfigSchema): void {
    this._schemas.set(extensionId, schema);
  }

  get(extensionId: string): Readonly<Record<string, unknown>> {
    const schema = this._schemas.get(extensionId);
    return schema ? configDefaults(schema) : {};
  }
}
