/**
 * global-settings-schema — JSON Schema of the platform's own settings
 * (`{ appTheme, updateChannel, lineHeight, editorFontSize, editor, dragConsumers }`, a
 * subset of `UserConfig`): the "Platform" entry of the manager's Settings
 * list, edited in the settings editor (services/settings-sources.ts). It gives
 * the editor its key tooltips, and saves are checked against it.
 */

/** JSON Schema for the global editor settings object. */
export const GLOBAL_SETTINGS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "openp41ge://schema/global-settings",
  title: "Global editor settings",
  type: "object",
  additionalProperties: true,
  description: "Theme, text size, file editor, updates.",
  properties: {
    updateChannel: {
      type: "string",
      enum: ["latest", "alpha", "beta", "rc"],
      description:
        'Auto-update channel. "latest" (stable) only receives stable releases; "alpha" / "beta" / "rc" receive prerelease builds on that track. The channel is read at startup by the main process.',
    },
    appTheme: {
      type: "string",
      enum: ["dark", "light"],
      description:
        'The active editor theme: "dark" or "light". Changes are picked up by every editor the next time it renders.',
    },
    lineHeight: {
      type: "number",
      minimum: 14,
      maximum: 100,
      description:
        "Base line height in pixels for every editor. Both source and settings editors read this globally; no per-editor offsets.",
    },
    editorFontSize: {
      type: "number",
      description: "Base editor font size in pixels. Raised/lowered uniformly across editors.",
    },
    editor: {
      type: "object",
      additionalProperties: false,
      description: "The file editor.",
      properties: {
        maxFileSize: {
          type: "number",
          minimum: 1,
          description:
            'The largest file the editor opens, in bytes (default 52428800, 50 MB). A larger file shows a "too large" message instead.',
        },
        wordWrap: {
          type: "boolean",
          description:
            "Wrap long lines by default. A file's own word-wrap toggle, once used, wins for that file.",
        },
      },
    },
    dragConsumers: {
      type: "object",
      propertyNames: { pattern: "^[^/\\s]+/[^/\\s]+$" },
      additionalProperties: { type: "string" },
      description:
        'Which component opens a dropped item, when more than one can. Keys are payload kinds ("openp41ge/file-path", "<extensionId>/<kind>"); values are consumer ids ("<extensionId>/<consumerId>", or a platform id such as "file-viewer"). A kind not listed opens in the first registered consumer (the platform\'s own, if it has one). Applies immediately, in every window.',
    },
  },
} as const;

export type GlobalSettingsSchema = typeof GLOBAL_SETTINGS_SCHEMA;
