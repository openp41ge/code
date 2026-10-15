/**
 * settings-sources.ts — where the settings editor (`config-editor`) reads and
 * writes. One editor serves every settings schema; this routes by id:
 *
 *   - `openp41ge` (`PLATFORM_SETTINGS_ID`) — the platform's own global
 *     settings: a slice of `config.json`'s top level (`PLATFORM_SETTINGS_KEYS`),
 *     described by `GLOBAL_SETTINGS_SCHEMA`. Values are checked against that
 *     schema before anything is written.
 *     Its `dragConsumers` offers the kinds registered now, each with a menu
 *     of the consumers registered for it (`DragConsumerChoices`).
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

/** The registered drag consumers (the drag consumer registry). */
export interface DragConsumerChoices {
  /** Each kind a drop can open, with its consumers' ids (the first: the default). */
  choices(): ReadonlyMap<string, readonly string[]>;
  /** Call `fn` when they change. Returns unsubscribe function. */
  onChange(fn: () => void): () => void;
}

const SCHEMA = GLOBAL_SETTINGS_SCHEMA as unknown as ConfigSchema;

type Choices = ReadonlyMap<string, readonly string[]>;

/** `dragConsumers` as the registered consumers allow it: a menu per kind
 *  registered now, and the user's choice for a kind nothing registers now
 *  (kept, read-only, until reset). */
function dragConsumersSchema(choices: Choices, saved: unknown): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [kind, ids] of choices) {
    properties[kind] = { type: "string", enum: [...ids], default: ids[0] };
  }
  if (saved !== null && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [kind, id] of Object.entries(saved)) {
      if (kind in properties) continue;
      properties[kind] = {
        type: "string",
        enum: [id],
        readOnly: true,
        description:
          "Not registered: nothing installed opens this kind now, so this choice does nothing until something does. Reset removes it.",
      };
    }
  }
  return {
    ...(GLOBAL_SETTINGS_SCHEMA.properties.dragConsumers as Record<string, unknown>),
    properties,
    additionalProperties: false,
  };
}

/** The platform settings' schema: `dragConsumers` from `choices` (none: any
 *  kind and id, as the static schema allows). */
function platformSchema(choices: Choices | null, saved: unknown): ConfigSchema {
  if (!choices) return SCHEMA;
  return {
    ...SCHEMA,
    properties: {
      ...(SCHEMA.properties as Record<string, unknown>),
      dragConsumers: dragConsumersSchema(choices, saved),
    },
  } as ConfigSchema;
}

/** What each kind opens in when the user has not chosen. */
function dragConsumersDefaults(choices: Choices): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kind, ids] of choices) if (ids[0] !== undefined) out[kind] = ids[0];
  return out;
}

function pick(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PLATFORM_SETTINGS_KEYS) if (key in doc) out[key] = doc[key];
  return out;
}

/** The settings editor's bridge: the platform's settings under
 *  `PLATFORM_SETTINGS_ID`, extensions' config under their ids. Given the
 *  registered drag `consumers`, `dragConsumers` offers only those. */
export function settingsBridge(
  extension: ExtensionConfigBridge,
  platform: PlatformConfigBridge,
  consumers?: DragConsumerChoices,
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
      const choices = consumers?.choices() ?? null;
      return {
        schema: platformSchema(choices, overrides.dragConsumers),
        defaults: choices
          ? { ...pick(defaults), dragConsumers: dragConsumersDefaults(choices) }
          : pick(defaults),
        overrides: pick(overrides),
      };
    },
    async set(id, doc) {
      if (id !== PLATFORM_SETTINGS_ID) return extension.set(id, doc);
      const choices = consumers?.choices() ?? null;
      const saved = choices ? (await platform.getOverrides()).dragConsumers : undefined;
      const errors = configErrors(platformSchema(choices, saved), pick(doc));
      if (errors.length > 0) throw new Error(`Invalid settings: ${errors.join("; ")}`);
      // A leaf written explicitly is kept even when it equals its default (a
      // pin); a key missing from the document is cleared.
      for (const key of PLATFORM_SETTINGS_KEYS) await platform.set(key, doc[key]);
    },
    onChanged(fn: (change: ExtensionConfigChange) => void) {
      const offExtension = extension.onChanged(fn);
      const platformChanged = () => fn({ extensionId: PLATFORM_SETTINGS_ID, config: {} });
      const offPlatform = platform.onChanged(platformChanged);
      const offConsumers = consumers?.onChange(platformChanged);
      return () => {
        offExtension();
        offPlatform();
        offConsumers?.();
      };
    },
  };
}
