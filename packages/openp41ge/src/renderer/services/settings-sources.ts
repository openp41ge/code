/**
 * settings-sources.ts — where the settings editor (`config-editor`) reads and
 * writes. One editor serves every settings schema; this routes by id:
 *
 *   - `openp41ge` (`PLATFORM_SETTINGS_ID`) — the platform's own global
 *     settings: a slice of `config.json`'s top level (`PLATFORM_SETTINGS_KEYS`),
 *     described by `GLOBAL_SETTINGS_SCHEMA`. Values are checked against that
 *     schema before anything is written.
 *   - any other id — that extension's config (`extension-config:*`).
 */

import { configErrors, type ConfigSchema } from "openp41ge-sdk";
import { GLOBAL_SETTINGS_SCHEMA } from "../models/global-settings-schema";
import type { ExtensionConfigBridge, ExtensionConfigChange } from "./extension-configs";

/** The id of the platform's own settings in the settings editor and list. */
export const PLATFORM_SETTINGS_ID = "openp41ge";

/** The platform settings the editor shows (the rest of config.json belongs
 *  to sub-packages and extensions). */
export const PLATFORM_SETTINGS_KEYS = [
  "appTheme",
  "updateChannel",
  "editor/*",
  "editor/file",
  "editor/json",
  "dragConsumers",
] as const;

/** The platform config IPC (`window.openp41ge.config`), as far as used here. */
export interface PlatformConfigBridge {
  getDefaults(): Promise<Record<string, unknown>>;
  getOverrides(): Promise<Record<string, unknown>>;
  /** Write a key; `undefined` clears it. */
  set(key: string, value: unknown): Promise<void>;
  onChanged(fn: () => void): () => void;
}

const SCHEMA = GLOBAL_SETTINGS_SCHEMA as unknown as ConfigSchema;

function pick(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PLATFORM_SETTINGS_KEYS) if (key in doc) out[key] = doc[key];
  return out;
}

/** The settings editor's bridge: the platform's settings under
 *  `PLATFORM_SETTINGS_ID`, extensions' config under their ids. */
export function settingsBridge(
  extension: ExtensionConfigBridge,
  platform: PlatformConfigBridge,
): ExtensionConfigBridge {
  return {
    registerSchema: (id, schema) => extension.registerSchema(id, schema),
    get: (id) => extension.get(id),
    async describe(id) {
      if (id !== PLATFORM_SETTINGS_ID) return extension.describe(id);
      const [defaults, overrides] = await Promise.all([
        platform.getDefaults(),
        platform.getOverrides(),
      ]);
      return { schema: SCHEMA, defaults: pick(defaults), overrides: pick(overrides) };
    },
    async set(id, doc) {
      if (id !== PLATFORM_SETTINGS_ID) return extension.set(id, doc);
      const errors = configErrors(SCHEMA, pick(doc));
      if (errors.length > 0) throw new Error(`Invalid settings: ${errors.join("; ")}`);
      // A leaf written explicitly is kept even when it equals its default (a
      // pin); a key missing from the document is cleared.
      for (const key of PLATFORM_SETTINGS_KEYS) await platform.set(key, doc[key]);
    },
    onChanged(fn: (change: ExtensionConfigChange) => void) {
      const offExtension = extension.onChanged(fn);
      const offPlatform = platform.onChanged(() =>
        fn({ extensionId: PLATFORM_SETTINGS_ID, config: {} }),
      );
      return () => {
        offExtension();
        offPlatform();
      };
    },
  };
}
