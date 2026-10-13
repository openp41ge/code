/**
 * openp41ge-sdk-uikit/json-editor — smart, structured JSON layout component.
 *
 * Re-exports the <json-editor> web component, its event names, and the pure
 * tree/highlight helpers so consumers (and tests) can use them.
 */

export {
  JsonEditorElement,
  setJsonEditorDefaults,
  JSON_EDITOR_CHANGE,
  JSON_EDITOR_OPEN,
  JSON_EDITOR_OVERWRITE,
} from "./json-editor";

export { gutterWidthFor, GUTTER_PAD_PX, GUTTER_FOLD_PX, DEFAULT_DIGIT_PX } from "./json-editor";

export {
  cloneDeep,
  sortJsonKeys,
  getAt,
  setAt,
  deleteEntry,
  renameKey,
  addEntry,
  isComposite,
  isArray,
  summarize,
  pathKey,
  pathFromKey,
  leafPaths,
  pinnedPaths,
  stripDefaults,
  mergeDefaults,
} from "./json-tree";
export type { JsonPath } from "./json-tree";

export { tokenizeJsonText, highlightJsonToHtml, JSON_SCOPE_CLASS } from "./json-highlight";
export type { JsonToken, JsonScope } from "./json-highlight";

export { parseJson, JsonParseError } from "./json-parse";
export type { JsonNode, JsonError, JsonObjectMember, ParseResult } from "./json-parse";
export { computeFoldRanges, findEntryAtLine } from "./json-analyze";
export type { FoldRange, EntryMatch } from "./json-analyze";
export {
  stringAt,
  ownerPathAt,
  suggestContextAt,
  collectKeySuggestions,
  defaultLiteralForType,
} from "./json-suggest";
export type { KeyStringContext, KeySuggestion } from "./json-suggest";
export {
  pathForLine,
  schemaAtPath,
  schemaDescription,
  schemaDescriptionForPath,
  schemaItemHint,
} from "./json-tooltip";
export type { JsonPath as TooltipPath, PathSeg } from "./json-tooltip";
export { tokenizeJsonFull, selectableRanges } from "./json-tokenize";
export type { JsonToken as JsonTokenFull, SelectableRange } from "./json-tokenize";

export { renderMarkdown, isMarkdownFileRef, highlightCodeBlock } from "./md-render";
export type { ResolveResource, JsonEditorDefaults } from "./json-editor";
