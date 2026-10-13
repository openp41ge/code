/**
 * editor-settings.ts — the editor settings by kind of editor.
 *
 * `config.json` holds them in three sections: `editor/*` (every editor),
 * `editor/file` (the file editor) and `editor/json` (the JSON editors: the
 * Settings editor, the workspace editor's JSON view). A setting in the
 * editor's own section wins over `editor/*`.
 *
 * The JSON editors are the UI toolkit's `<json-editor>`, used by the platform
 * and by extensions alike, so they follow shared toolkit defaults
 * (`setJsonEditorDefaults`) that `followJsonEditorSettings` keeps in step
 * with the config.
 */

import type { JsonEditorDefaults } from "openp41ge-sdk-uikit/json-editor";

/** A kind of editor with its own settings section. */
export type EditorKind = "file" | "json";

/** Where the settings are read, as far as used here. */
export interface EditorSettingsSource {
  get(key: string): unknown;
}

/** One setting for an editor kind: `editor/<kind>`'s value, else `editor/*`'s. */
export function editorSetting(
  config: EditorSettingsSource,
  kind: EditorKind,
  key: string,
): unknown {
  const own = config.get(`editor/${kind}.${key}`);
  return own !== undefined ? own : config.get(`editor/*.${key}`);
}

/** Whether a config change key (`editor/file`, `editor/*.lineHeight`, …) is an editor setting. */
export function isEditorSettingsKey(key: string): boolean {
  return key.startsWith("editor/");
}

/** A number setting within bounds, else undefined (the editor keeps its own). */
function bounded(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && value >= min && value <= max ? value : undefined;
}

/** The line height (px) for an editor kind, when set and sensible. */
export function editorLineHeight(
  config: EditorSettingsSource,
  kind: EditorKind,
): number | undefined {
  return bounded(editorSetting(config, kind, "lineHeight"), 14, 100);
}

/** The font size (px) for an editor kind, when set and sensible. */
export function editorFontSize(config: EditorSettingsSource, kind: EditorKind): number | undefined {
  return bounded(editorSetting(config, kind, "fontSize"), 8, 40);
}

/**
 * Keep every JSON editor's row height and font size following `editor/json`
 * and `editor/*`: applied now and on each config change. Returns a function
 * that stops following.
 */
export function followJsonEditorSettings(
  config: EditorSettingsSource & { onChange(fn: () => void): () => void },
  apply: (defaults: Partial<JsonEditorDefaults>) => void,
): () => void {
  const update = (): void => {
    const rowHeight = editorLineHeight(config, "json");
    const fontSize = editorFontSize(config, "json");
    apply({
      ...(rowHeight !== undefined ? { rowHeight } : {}),
      ...(fontSize !== undefined ? { fontSize } : {}),
    });
  };
  update();
  return config.onChange(update);
}
