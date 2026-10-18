/**
 * global-settings-schema — JSON Schema of the platform's own settings
 * (`{ appTheme, updateChannel, "editor/*", "editor/file", "editor/json", dragConsumers,
 * commandBinaries, terminal }`, a
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
  description: "Theme, editors, updates.",
  properties: {
    updateChannel: {
      type: "string",
      enum: ["latest", "alpha", "beta", "rc"],
      description:
        'Auto-update channel. "latest" (stable) only receives stable releases; "alpha" / "beta" / "rc" receive prerelease builds on that track. The channel is read at startup by the main process.',
    },
    appTheme: {
      type: "string",
      enum: ["system", "dark", "light"],
      description:
        'The app theme: "dark", "light", or "system" to follow the OS (and switch when the OS does).',
    },
    "editor/*": {
      type: "object",
      additionalProperties: false,
      description:
        "Settings every editor follows (the file editor and the JSON editors). An editor's own section, editor/file or editor/json, wins over these.",
      properties: {
        lineHeight: {
          type: "number",
          minimum: 14,
          maximum: 100,
          description: "Line height in pixels.",
        },
        fontSize: {
          type: "number",
          minimum: 8,
          maximum: 40,
          description: "Font size in pixels.",
        },
      },
    },
    "editor/file": {
      type: "object",
      additionalProperties: false,
      description: "The file editor. Line height and font size here win over editor/*.",
      properties: {
        lineHeight: {
          type: "number",
          minimum: 14,
          maximum: 100,
          description: "Line height in pixels.",
        },
        fontSize: {
          type: "number",
          minimum: 8,
          maximum: 40,
          description: "Font size in pixels.",
        },
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
        trimTrailingWhitespace: {
          type: "boolean",
          description:
            "When a file is saved, remove the spaces and tabs at the end of its lines (default true).",
        },
        insertFinalNewline: {
          type: "boolean",
          description:
            "When a file is saved, end it with a newline if it does not already (default true; an empty file stays empty).",
        },
      },
    },
    "editor/json": {
      type: "object",
      additionalProperties: false,
      description:
        "The JSON editors (the Settings editor, the workspace editor's JSON view). Line height and font size here win over editor/*.",
      properties: {
        lineHeight: {
          type: "number",
          minimum: 14,
          maximum: 100,
          description: "Line height in pixels.",
        },
        fontSize: {
          type: "number",
          minimum: 8,
          maximum: 40,
          description: "Font size in pixels.",
        },
      },
    },
    dragConsumers: {
      type: "object",
      propertyNames: { pattern: "^[^/\\s]+/[^/\\s]+$" },
      additionalProperties: { type: "string" },
      description:
        "Which component opens a dropped item, for each kind of item that something registered can open. A kind opens in the first component registered for it (the platform's own, if it has one) unless another is chosen here. Applies immediately, in every window.",
    },
    commandBinaries: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Which extension's definition of a binary the terminal runs, when more than one extension defines it: binary → extension id. Unset, an official extension's definition is used (or the only one); a binary several other extensions define stays off until one is chosen.",
    },
    terminal: {
      type: "object",
      additionalProperties: false,
      description: "The terminal's limits for every command it runs (for you and for agents).",
      properties: {
        timeoutSeconds: {
          type: "number",
          minimum: 1,
          maximum: 3600,
          default: 60,
          description: "A command is stopped after this many seconds.",
        },
        maxOutputKb: {
          type: "number",
          minimum: 1,
          maximum: 10240,
          default: 256,
          description: "Output past this many KB is dropped, for a command typed in the terminal.",
        },
        agentMaxOutputKb: {
          type: "number",
          minimum: 1,
          maximum: 10240,
          default: 32,
          description:
            "Output past this many KB is dropped, for a command an agent runs (it goes into the model's context; the agent is told to narrow the command).",
        },
      },
    },
  },
} as const;

export type GlobalSettingsSchema = typeof GLOBAL_SETTINGS_SCHEMA;
