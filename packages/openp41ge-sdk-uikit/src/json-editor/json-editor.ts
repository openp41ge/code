/**
 * <json-editor> — a smart JSON code editor, styled like the file editor.
 *
 * The whole file is a plain text editor: the raw JSON content lives in an
 * editable <textarea> whose text is rendered underneath by a "content view" —
 * a syntax-highlighted, line-numbered view that the textarea is overlaid on, so
 * only the caret and the highlighted text are visible.
 *
 * Structure-aware helpers layered on top of the text editor:
 *  - Code folding: objects / arrays can be collapsed into a single line that
 *    shows metadata about the subtree. Folding works by hiding the folded lines
 *    from the visible buffer (the textarea keeps the source of truth in
 *    `_text`); edits are reconciled back through a visible↔full offset map.
 *  - Delete buttons: every row has one; on an opening-brace row it deletes the
 *    entire subtree, and hovering highlights every affected row red.
 *  - Click-to-select: clicking a key or string value selects the whole token so
 *    typing immediately replaces it.
 *  - Syntax errors: the offending line number is flagged red.
 *  - Caret clamping: the caret can never sit in leading indentation — clicking
 *    or arrowing into indentation jumps to the first typable character.
 *  - Auto-closing pairs, auto-indent, auto-format (unchanged).
 *
 * The public API is unchanged: `value`, `editedValue`, `rowHeight`, `readonly`
 * and the `json-editor-change` / `json-editor-open` events.
 *
 * Emits:
 *  - `json-editor-change` `{ value }` when the text parses to a new value.
 */

import { LitElement, html, css, unsafeCSS, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { parseJson, type JsonNode, type JsonError } from "./json-parse";
import {
  pathForLine,
  schemaAtPath,
  schemaDescriptionForPath,
  schemaItemHint,
} from "./json-tooltip";
import {
  collectKeySuggestions,
  defaultLiteralForType,
  ownerPathAt,
  suggestContextAt,
  stringAt,
  valueSuggestContextAt,
  type KeySuggestion,
} from "./json-suggest";
import { computeFoldRanges, findEntryAtLine, type FoldRange } from "./json-analyze";
import {
  tokenizeJsonFull,
  selectableRanges,
  type JsonToken,
  type SelectableRange,
} from "./json-tokenize";
import { cloneDeep, getAt, pathKey, summarize, type JsonPath } from "./json-tree";
import { renderMarkdown, isMarkdownFileRef } from "./md-render";
import {
  Gutter,
  lineNumberColumn,
  foldColumn,
  GUTTER_DEFAULT_CSS,
  type GutterRow,
} from "openp41ge-core-editor-gutter";
import { CursorController } from "openp41ge-core-editor-engine/cursor/cursor-controller";
import { PieceTreeTextContentModel } from "openp41ge-core-editor-engine/model/piece-tree-text-content-model";
import type { TextPosition } from "openp41ge-core-editor-engine/model";

export const JSON_EDITOR_CHANGE = "json-editor-change";
export const JSON_EDITOR_OPEN = "json-editor-open";
export const JSON_EDITOR_OVERWRITE = "json-editor-overwrite";

/** Resolves a local Markdown file reference (a relative `*.md` path in a schema
 *  `description`) to the file's Markdown text, or null when it can't be
 *  resolved. May be async. */
export type ResolveResource = (ref: string) => string | Promise<string | null> | null;

/** The unescaped key name from a string token's source text (e.g. `"baseUrl"`
 *  → `baseUrl`), so a hovered key token resolves to a schema path even when the
 *  document didn't parse (no tree to walk). Returns null for non-string tokens. */
function keyNameFromToken(value: string): string | null {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return null;
  const inner = value.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "\\" && i + 1 < inner.length) {
      const n = inner[i + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

export const GUTTER_PAD_PX = 8;
export const DEFAULT_DIGIT_PX = 6.6;
/** Height of one suggestion row (px) — used to position the thin side tooltip. */
export const SUGGEST_ITEM_H = 24;
/** Width of the dedicated fold-chevron gutter (a second column next to the line numbers). */
export const GUTTER_FOLD_PX = 24;
/** How long the cursor must rest on a key before the schema tooltip shows. */
export const TOOLTIP_DELAY_MS = 350;

export function gutterWidthFor(rowCount: number, digitPx: number): number {
  const digits = String(Math.max(1, rowCount)).length;
  return digits * digitPx + GUTTER_PAD_PX * 2;
}

// ─── Defaults-overlay (faded defaults) helpers ─────────────────────────────
// When `showDefaults` is on, the document is the effective (defaults-merged)
// value. Every part that still equals its default is rendered faded; the parts
// that differ (the overrides) render normally in place.

/** Collect the leaf paths where `value` differs from `defaults` (its overrides). */
function collectOverrideLeaves(
  value: unknown,
  def: unknown,
  path: JsonPath,
  out: Set<string>,
): void {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    def !== null &&
    typeof def === "object" &&
    !Array.isArray(def)
  ) {
    for (const key of Object.keys(value)) {
      collectOverrideLeaves(
        (value as Record<string, unknown>)[key],
        (def as Record<string, unknown>)[key],
        [...path, key],
        out,
      );
    }
    return;
  }
  if (JSON.stringify(value) !== JSON.stringify(def)) out.add(pathKey(path));
}

/** True when an override exists at or below `key` (so the line must NOT fade). */
function hasOverrideUnder(overrides: Set<string>, key: string): boolean {
  if (overrides.has(key)) return true;
  if (key === "") return overrides.size > 0;
  const prefix = key + ".";
  for (const q of overrides) {
    if (q.startsWith(prefix)) return true;
  }
  return false;
}

/** Mark every line of subtrees that are entirely at default as faded. */
function markDefaultLines(
  node: JsonNode,
  path: JsonPath,
  faded: Set<number>,
  overrides: Set<string>,
  defaults: unknown,
): void {
  const key = pathKey(path);
  // The document's top-level object (`{}`) always exists and is never an
  // optional value — only its default-valued *subtrees* fade, so the container
  // braces always render solid behind the faded contents.
  if (path.length > 0 && !hasOverrideUnder(overrides, key) && getAt(defaults, path) !== undefined) {
    for (let l = node.line; l <= node.endLine; l++) faded.add(l);
    return;
  }
  if (node.type === "object" && node.members) {
    for (const m of node.members) {
      markDefaultLines(m.value, [...path, m.key], faded, overrides, defaults);
    }
  } else if (node.type === "array" && node.elements) {
    for (let i = 0; i < node.elements.length; i++) {
      markDefaultLines(node.elements[i], [...path, i], faded, overrides, defaults);
    }
  }
}

interface VisibleLine {
  /** Full-text line index (0-based). */
  line: number;
  text: string;
  /** Offset of this line's start within `_visibleText`. */
  start: number;
}

@customElement("json-editor")
export class JsonEditorElement extends LitElement {
  @property({ attribute: false }) value: unknown = undefined;
  @property({ type: Boolean, attribute: "readonly" }) readonly = false;
  @property({ type: Number, attribute: "row-height" }) rowHeight = 20;
  /** JSON Schema describing the document. Hovering an object key shows the
   *  matching property's `description` (tooltip content comes from here). */
  @property({ attribute: false }) schema: unknown = null;
  /** Optional resolver for Markdown file references in schema descriptions
   *  (see `isMarkdownFileRef`): given a local `*.md` path it returns the file's
   *  Markdown text (or null when the resource can't be resolved). The host
   *  wires this to read bundled content or the filesystem. */
  @property({ attribute: false }) resolveResource: ResolveResource | null = null;

  /** The platform defaults for this document. When `showDefaults` is on, every
   *  part of the document that still equals its default (i.e. is not an
   *  override) is rendered faded, while the overridden values render normally
   *  in place — so the user sees what's available and what's been set. */
  @property({ attribute: false }) defaults: unknown = null;
  /** When true (and `defaults` is set), fade default-valued tokens/lines so the
   *  overrides stand out. Defaults to false (show only the document as-is). */
  @property({ type: Boolean, attribute: "show-defaults" }) showDefaults = false;
  /** Dot-joined leaf paths the user has explicitly overridden ("pinned" — set
   *  to a value that happens to equal the default). When `showDefaults` is on,
   *  these paths render normally (not faded) alongside the derived overrides, so
   *  a pinned value is never mistaken for an untouched default. */
  @property({ attribute: false }) explicitPaths: string[] = [];

  /** Full JSON text — the source of truth that gets persisted. */
  @state() private _text = "";
  /** Last successfully parsed value (carried across transiently-invalid text). */
  private _parsedValue: unknown = undefined;
  private _committedJson = "";
  private _digitPx = 0;

  private _root?: JsonNode;
  private _parseError?: JsonError;

  private _folds: FoldRange[] = [];
  /** Open-line indexes of folds currently collapsed. */
  private _folded = new Set<number>();
  private _hiddenLines = new Set<number>();
  private _visibleLines: VisibleLine[] = [];
  private _visibleText = "";
  private _visToFull: number[] = [];
  private _fullLineStarts: number[] = [];

  private _tokens: JsonToken[] = [];
  private _selectables: SelectableRange[] = [];
  /** Full-text line indexes currently highlighted (row hover over an action
   *  button — red for delete, blue for overwrite). */
  private _dangerLines = new Set<number>();
  /** Which accent the current row highlight uses (`delete` red vs `overwrite`
   *  blue). Only meaningful while `_dangerLines` is non-empty. */
  private _highlightKind: "delete" | "overwrite" = "delete";
  /** Full-text line indexes rendered faded in the defaults-overlay view. */
  private _fadedLines = new Set<number>();
  /** Leaf paths (dot-joined) that differ from the defaults (the overrides). */
  private _overrideLeafPaths = new Set<string>();
  /** Full-text line index currently hovered (reveals its delete button). */
  @state() private _hoverLine: number | null = null;
  /** Gutter row key (full-text line, 0-based) of the caret's line — kept in
   *  sync with the textarea selection so the line-number cell highlights like
   *  the file editor's active line. */
  private _activeLine: number | null = null;
  /** Absolute (visible-text) offsets of a matched bracket pair, when the
   *  caret sits on a bracket. */
  private _braceMatch: [number, number] | null = null;
  /** The shared gutter host (openp41ge-core-editor-gutter). */
  private _gutter: Gutter | null = null;
  /** Last row geometry pushed to the gutter, so hover moves don't rebuild. */
  private _gutterVisText = "";
  private _gutterRowH = 0;
  private _gutterW = -1;
  private _gutterFoldW = -1;
  /** Cache for the selection highlight (avoids re-measuring on hover updates). */
  private _lastSelKey: string | null = null;
  private _lastVisText = "";
  /** Cached monospace advance width for the editor font (13px). */
  private _contentCharW = 0;
  /** Cache of the hovered line's tokenization (so mousemove stays cheap). */
  private _ttLine = -1;
  private _ttTokens: ReturnType<typeof tokenizeJsonFull> = [];
  private _ttKeyStarts: Set<number> = new Set();
  /** Schema tooltip delay state — the tooltip shows only after the cursor has
   *  rested on a key for `TOOLTIP_DELAY_MS`, and hides immediately on leaving. */
  private _tooltipHoverKey: string | null = null;
  private _tooltipPending: {
    keyId: string;
    line: number;
    start: number;
    keyLen: number;
    text: string;
    hint: string | null;
  } | null = null;
  /** Monotonic id so a stale async resource load can't paint a tooltip the
   *  cursor has since left. */
  private _tooltipLoadSeq = 0;
  private _tooltipShowTimer: number | null = null;
  /** Key auto-complete state: a visible suggestions list plus the thin side
   *  tooltip. `x`/`y` are the list's top-left in `.je-content` pixels; `tipTop`
   *  is the side tooltip's top (follows the highlighted row). */
  @state() private _suggest: {
    x: number;
    y: number;
    tipTop: number;
    items: KeySuggestion[];
    selected: number;
    /** `key` = completing an object key; `value` = choosing an enum value. */
    kind: "key" | "value";
  } | null = null;
  /** Visible caret offset at which the list was dismissed (see `_dismissSuggest`).
   *  Suppresses the list from instantly re-appearing until the caret moves or
   *  the text is edited. */
  private _suggestSuppress: number | null = null;
  /** Extra caret positions (offsets in `_visibleText`) beyond the primary. */
  /** Extra carets, each with its own selection (anchor + active position). */
  private _carets: { anchor: number; position: number }[] = [];
  /** Primary caret's selection state while in multi-caret mode. */
  private _primaryAnchor = 0;
  private _primaryPosition = 0;
  /** Custom caret layer + elements (file-editor style: 2px bar, blink). */
  private _caretEls: HTMLElement[] = [];
  private _caretVisible = true;
  private _caretRaf: number | null = null;
  /** Whether the textarea currently has focus (carets show only then). */
  private _isFocused = false;
  /** Set when an Alt+Click mousedown added a caret, so `_onClick` skips. */
  private _altClicked = false;
  /** Whether the current mouse interaction is a drag (general highlight).
   *  While dragging, click-to-select of strings is disabled. */
  private _dragMoved = false;
  private _dragStartX = 0;
  private _dragStartY = 0;

  static styles = css`
    ${unsafeCSS(GUTTER_DEFAULT_CSS)}
    :host {
      display: block;
      box-sizing: border-box;
      height: 100%;
      overflow: hidden;
      color: var(--text-primary, #d4d4d4);
      font-family: ui-monospace, "Cascadia Code", "Fira Code", Menlo, Consolas, monospace;
      font-size: 13px;
      background: var(--bg-primary, #1e1e1e);
      text-align: left;
    }
    :host ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    :host ::-webkit-scrollbar-track {
      background: transparent;
    }
    :host ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.16);
      border-radius: 0;
    }
    :host ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.34);
    }

    .je-root {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .je-viewport {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      position: relative;
      background: var(--bg-primary, #1e1e1e);
    }
    .je-inner {
      display: flex;
      align-items: stretch;
      width: 100%;
      min-width: max-content;
      min-height: 100%;
      position: relative;
    }
    /* The gutter is provided by openp41ge-core-editor-gutter (generic 'eg-*'
       classes); the JSON editor styles it to match the file editor. The
       'eg-gutter' host is sticky-left and shrink-wraps its columns. */
    .je-gutter-mount {
      display: contents;
    }
    .eg-gutter {
      position: sticky;
      left: 0;
      z-index: 2;
      display: flex;
      align-items: stretch;
      flex: 0 0 auto;
      background: var(--bg-primary, #1e1e1e);
      user-select: none;
      /* Line-number text — match the file editor (its numbers inherit
         text-primary), not the dimmer text-secondary. */
      color: var(--text-primary, #d4d4d4);
      font-size: 11px;
      /* Colour tokens for the shared gutter default styles (GUTTER_DEFAULT_CSS). */
      --eg-fold-color: var(--je-fold-color, #79c0ff);
    }
    /* Editor-specific gutter bits on top of GUTTER_DEFAULT_CSS: the shared
       default provides cell layout, the fold-cell/chevron structure and the
       unified hover box; the JSON editor only themes it and styles its
       line-number cells. Scoped to the line-number column so the fold
       chevron button keeps the shared centered, full-cell layout. */
    .eg-col--line-numbers .eg-cell {
      justify-content: flex-end;
      padding: 0 8px;
      cursor: pointer;
    }
    .eg-cell {
      transition: background-color 120ms ease;
    }
    /* Error line numbers keep their red tint; the unified hover box merely
       sits over them (below). */
    .eg-cell--err {
      background: rgba(244, 135, 113, 0.28);
      color: #f48771;
    }
    /* The caret's line-number cell (active gutter row) — matches the file
       editor's active-line highlight. Painted by the gutter host when the
       caret moves; kept subtle so error/fold cells still read clearly. */
    .eg-cell.eg-cell--active {
      background: var(--je-active-line-bg, rgba(255, 255, 255, 0.12));
    }

    /* Schema tooltip — shown on key hover. Positioned by the editor near
       the hovered key token; content comes from the JSON Schema property
       "description". */
    .je-tooltip {
      position: absolute;
      z-index: 30;
      max-width: 665px;
      box-sizing: border-box;
      padding: 6px 9px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-primary, #d4d4d4);
      background: var(--bg-secondary, #252526);
      border: 1px solid var(--divider, #454545);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      white-space: normal;
      pointer-events: none;
      display: none;
    }
    /* Rendered Markdown inside the tooltip (schema descriptions + loaded
       resource files). Text outside recognised markers is escaped by the
       renderer, so only these elements carry content. */
    .je-tooltip p {
      margin: 0 0 6px;
    }
    .je-tooltip p:last-child {
      margin-bottom: 0;
    }
    .je-tooltip h1,
    .je-tooltip h2,
    .je-tooltip h3,
    .je-tooltip h4 {
      margin: 6px 0 4px;
      font-weight: 600;
      line-height: 1.3;
    }
    .je-tooltip h1 {
      font-size: 15px;
    }
    .je-tooltip h2 {
      font-size: 14px;
    }
    .je-tooltip h3,
    .je-tooltip h4 {
      font-size: 13px;
    }
    .je-tooltip ul,
    .je-tooltip ol {
      margin: 4px 0;
      padding-left: 18px;
    }
    .je-tooltip li {
      margin: 2px 0;
    }
    .je-tooltip blockquote {
      margin: 6px 0;
      padding: 2px 8px;
      border-left: 3px solid var(--divider, #454545);
      color: var(--text-secondary, #9d9d9d);
    }
    .je-tooltip hr {
      border: 0;
      border-top: 1px solid var(--divider, #454545);
      margin: 8px 0;
    }
    .je-tooltip pre.je-md-code {
      margin: 6px 0;
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--divider, #454545);
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      line-height: 1.45;
    }
    .je-tooltip pre.je-md-code code {
      background: none;
      padding: 0;
      font-size: inherit;
    }
    .je-tooltip code {
      background: rgba(255, 255, 255, 0.12);
      padding: 1px 3px;
      border-radius: 3px;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
    }
    .je-tooltip a {
      color: var(--accent, #4da3ff);
    }
    .je-tooltip .je-tooltip-hint {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-secondary, #9d9d9d);
    }

    .je-content {
      position: relative;
      flex: 1 1 auto;
      min-width: max-content;
    }
    /* Key auto-complete list — appears below the caret when it sits inside a
       key-position string. Shows the schema keys not already set at that
       object; the highlighted row is the one Up/Down will accept. */
    .je-suggest {
      position: absolute;
      z-index: 40;
      box-sizing: border-box;
      min-width: 180px;
      max-width: 340px;
      max-height: 220px;
      overflow-y: auto;
      padding: 4px;
      background: var(--bg-secondary, #252526);
      border: 1px solid var(--divider, #454545);
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
      color: var(--text-primary, #d4d4d4);
      font-size: 13px;
      line-height: 1.4;
    }
    .je-suggest-item {
      height: 24px;
      line-height: 24px;
      padding: 0 8px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .je-suggest-item--sel {
      background: var(--je-suggest-sel-bg, rgba(38, 79, 120, 0.9));
      color: var(--je-suggest-sel-fg, #ffffff);
    }
    /* Thin side tooltip next to the list — same text as the key hover tooltip
       for the highlighted suggestion. */
    .je-suggest-tip {
      position: absolute;
      z-index: 41;
      box-sizing: border-box;
      max-width: 320px;
      padding: 4px 8px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-primary, #d4d4d4);
      background: var(--bg-secondary, #252526);
      border: 1px solid var(--divider, #454545);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      white-space: pre-wrap;
      pointer-events: none;
    }
    .je-lines {
      position: relative;
      white-space: normal;
    }
    /* Rounded selection highlight layer (Monaco-style). It sits behind the
       line text: outer corners get border-radius, inner (wrap) corners get
       small background-colored notches. */
    .je-selection {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }
    .je-segment {
      position: absolute;
      background: var(--je-selection-bg, rgba(38, 79, 120, 0.75));
      pointer-events: none;
      z-index: 1;
    }
    .je-segment.top-left-radius {
      border-top-left-radius: 3px;
    }
    .je-segment.top-right-radius {
      border-top-right-radius: 3px;
    }
    .je-segment.bottom-left-radius {
      border-bottom-left-radius: 3px;
    }
    .je-segment.bottom-right-radius {
      border-bottom-right-radius: 3px;
    }
    .je-corner-piece {
      position: absolute;
      background: var(--je-selection-bg, rgba(38, 79, 120, 0.85));
      pointer-events: none;
      z-index: 2;
    }
    .je-notch {
      position: absolute;
      background: var(--je-bg, var(--bg-primary, #1e1e1e));
      pointer-events: none;
      z-index: 3;
    }
    .je-notch.top-right-radius {
      border-top-right-radius: 3px;
    }
    .je-notch.bottom-right-radius {
      border-bottom-right-radius: 3px;
    }
    .je-notch.top-left-radius {
      border-top-left-radius: 3px;
    }
    .je-notch.bottom-left-radius {
      border-bottom-left-radius: 3px;
    }
    .je-row {
      position: relative;
      display: flex;
      align-items: stretch;
      height: var(--je-row-height, 20px);
    }
    .je-row--danger {
      background: rgba(244, 135, 113, 0.22);
    }
    .je-row--overwrite {
      background: rgba(88, 166, 255, 0.22);
    }
    /* 1px accent border around a highlighted member block (delete/overwrite
       hover). */
    .je-hl-border {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 30;
      box-sizing: border-box;
      border: 1px solid var(--je-hl, #f48771);
      pointer-events: none;
    }
    .je-row--faded .je-line {
      opacity: 0.38;
    }
    .je-row--faded .je-line:hover {
      opacity: 0.6;
    }
    .je-line {
      flex: 1 1 auto;
      min-width: 0;
      height: var(--je-row-height, 20px);
      line-height: var(--je-row-height, 20px);
      padding: 0 10px;
      box-sizing: border-box;
      white-space: pre;
      overflow: hidden;
    }
    .je-fold-meta {
      color: var(--text-secondary, #6e7681);
    }
    .je-brace--match {
      background: rgba(121, 192, 255, 0.22);
      color: #a5d6ff;
      border-radius: 2px;
    }
    .je-actions {
      z-index: 3;
      flex: 0 0 26px;
      width: 26px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 4px;
      box-sizing: border-box;
      pointer-events: none;
    }
    .je-del {
      pointer-events: auto;
      border: none;
      background: transparent;
      color: var(--text-secondary, #6e7681);
      font: inherit;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      padding: 2px;
      opacity: 0;
      transition: opacity 0.12s ease;
    }
    .je-del--show {
      opacity: 1;
    }
    .je-del:hover {
      opacity: 1;
      color: #f48771;
    }
    /* Overwrite (pin this default into user config) button on faded rows. */
    .je-ow {
      pointer-events: auto;
      border: none;
      background: transparent;
      color: var(--text-secondary, #6e7681);
      font: inherit;
      line-height: 1;
      cursor: pointer;
      padding: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.12s ease;
    }
    .je-ow svg {
      stroke: currentColor;
    }
    .je-ow--show {
      opacity: 1;
    }
    .je-ow:hover {
      color: #58a6ff;
      background: var(--bg-active, #37373d);
      border-radius: 3px;
    }

    textarea.je-input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 0 10px;
      border: none;
      outline: none;
      resize: none;
      background: transparent;
      color: transparent;
      caret-color: transparent;
      font: inherit;
      line-height: var(--je-row-height, 20px);
      white-space: pre;
      overflow: hidden;
      word-break: keep-all;
      overscroll-behavior: contain;
      z-index: 1;
      /* The global app shell sets body { user-select: none }; an editor
         must re-enable it or Chromium will not place a caret / select text.
         The native caret + selection are hidden (transparent + ::selection),
         the visible caret/selection are drawn by the custom layers, but the
         underlying placements still need user-select to be selectable - the
         file editor does the same (user-select: text on its viewport). */
      user-select: text;
      -webkit-user-select: text;
    }
    textarea.je-input::selection {
      background: transparent;
      color: transparent;
      -webkit-text-fill-color: transparent;
    }
    /* Custom caret layer — the native textarea caret is hidden and carets
       are rendered here as 2px blinking bars, matching the file editor. */
    .je-caret-layer {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }
    .je-caret {
      position: absolute;
      left: 0;
      top: 0;
      width: 2px;
      background: var(--fe-cursor-color, #d4d4d4);
      pointer-events: none;
    }

    .s-str {
      color: #ce9178;
    }
    .s-var {
      color: #9cdcfe;
    }
    .s-num {
      color: #b5cea8;
    }
    .s-kw {
      color: #569cd6;
    }
    .s-pun {
      color: #d4d4d4;
    }
    .je-key,
    .je-value {
      border-radius: 2px;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this._digitPx = this._effectiveDigitPx();
    if (this._text === "" && this.value !== undefined) {
      this._applyValue();
    } else {
      this._rebuild(false);
      this._applyRowHeight();
    }
    document.addEventListener("selectionchange", this._onSelectionChange);
    this._startCaretBlink();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("selectionchange", this._onSelectionChange);
    this._stopCaretBlink();
    this._caretEls = [];
  }

  /** Track the caret line so the line-number cell lights up as it moves. */
  private _onSelectionChange = (): void => {
    this._syncActiveLine();
    this._renderCarets();
  };

  private _onFocus = (): void => {
    this._isFocused = true;
    this._renderCarets();
    this._syncActiveLine();
    this._updateSuggest();
  };

  /** Recompute and apply the active gutter row from the textarea caret. */
  private _syncActiveLine(): void {
    const ta = this.renderRoot.querySelector(".je-input") as HTMLTextAreaElement | null;
    if (!ta) return;
    // Only highlight the caret's row while the editor actually has focus.
    // On open the textarea's value setter parks the caret at the end, which
    // would otherwise auto-highlight the bottom line number.
    const key = this._isFocused ? this._activeLineFor(ta) : null;
    if (key !== this._activeLine) {
      this._activeLine = key;
      this._gutter?.setActiveRow(key);
    }
  }

  /** The gutter key of the visible line containing the caret. */
  private _activeLineFor(ta: HTMLTextAreaElement): number | null {
    const pos = ta.selectionStart ?? 0;
    const lineIdx = ta.value.slice(0, pos).split("\n").length - 1;
    const v = this._visibleLines[lineIdx];
    return v ? v.line : null;
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("value") && this._formatValue(this.value) !== this._text) {
      this._applyValue();
    }
    if (changed.has("rowHeight")) {
      this._applyRowHeight();
    }
    if (changed.has("showDefaults") || changed.has("defaults") || changed.has("explicitPaths")) {
      this._computeFadedLines();
    }
  }

  /** The parsed value of the current text (last valid parse while transiently
   * invalid). This is what the host should save. */
  get editedValue(): unknown {
    return this._parsedValue;
  }

  // ── State / structure ────────────────────────────────────────────────────

  private _applyValue(): void {
    const text = this._formatValue(this.value);
    this._text = text;
    this._folded.clear();
    const res = parseJson(text);
    if (res.ok) {
      this._parsedValue = res.value;
      this._committedJson = JSON.stringify(res.value);
    } else {
      this._parsedValue = this.value;
      this._committedJson = JSON.stringify(this._parsedValue);
    }
    this._rebuild(false);
  }

  private _applyRowHeight(): void {
    const lh = Math.max(1, Number(this.rowHeight) || 20);
    this.style.setProperty("--je-row-height", lh + "px");
    this.style.setProperty(
      "--je-gutter-w",
      gutterWidthFor(this._lineCount(), this._digitPx) + "px",
    );
    this.style.setProperty("--je-fold-w", GUTTER_FOLD_PX + "px");
  }

  private _formatValue(v: unknown): string {
    if (v === undefined) return "";
    if (v === null) return "null";
    return JSON.stringify(v, null, 2) ?? String(v);
  }

  private _formatText(text: string): string | null {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2) ?? String(parsed);
    } catch {
      return null;
    }
  }

  private _lineCount(): number {
    return this._text.split("\n").length;
  }

  private _effectiveDigitPx(): number {
    if (this._digitPx > 0) return this._digitPx;
    if (typeof document === "undefined") return DEFAULT_DIGIT_PX;
    const s = document.createElement("span");
    s.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font-family:ui-monospace,'Cascadia Code','Fira Code',Menlo,Consolas,monospace;font-size:11px;";
    s.textContent = "0";
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    this._digitPx = w > 0 ? w : DEFAULT_DIGIT_PX;
    return this._digitPx;
  }

  /** Recompute structure (parse → AST / error), fold ranges, and the visible
   * (folded) buffer. Optionally emits `json-editor-change` when a new valid
   * value forms. */
  private _rebuild(emitChange: boolean): void {
    const res = parseJson(this._text);
    let json: string | undefined;
    if (res.ok) {
      this._root = res.root;
      this._parsedValue = res.value;
      this._parseError = undefined;
      json = JSON.stringify(res.value);
    } else {
      this._root = undefined;
      this._parseError = res.error;
    }

    this._folds = computeFoldRanges(this._text);
    const valid = new Set(this._folds.map((f) => f.openLine));
    for (const o of [...this._folded]) if (!valid.has(o)) this._folded.delete(o);

    this._computeVisible();
    this._tokens = tokenizeJsonFull(this._visibleText);
    this._selectables = selectableRanges(this._tokens);
    this._computeFadedLines();

    if (emitChange && json !== undefined && json !== this._committedJson) {
      this._committedJson = json;
      this.dispatchEvent(
        new CustomEvent(JSON_EDITOR_CHANGE, {
          detail: { value: this._parsedValue },
          bubbles: true,
          composed: true,
        }),
      );
    }

    this._applyRowHeight();
    this.requestUpdate();
  }

  /** Recompute which lines are part of a default (non-overridden) subtree so
   *  they render faded when `showDefaults` is on. No fade when the mode is off
   *  or no defaults are supplied. */
  private _computeFadedLines(): void {
    this._fadedLines.clear();
    this._overrideLeafPaths.clear();
    if (!this.showDefaults || this.defaults == null || !this._root) return;
    const overrides = new Set<string>();
    collectOverrideLeaves(this._parsedValue, this.defaults, [], overrides);
    // Explicitly-pinned paths are overrides even when they equal the default.
    for (const p of this.explicitPaths) overrides.add(p);
    this._overrideLeafPaths = overrides;
    const faded = new Set<number>();
    markDefaultLines(this._root, [], faded, overrides, this.defaults);
    this._fadedLines = faded;
  }

  private _computeVisible(): void {
    const lines = this._text.split("\n");
    const hidden = new Set<number>();
    for (const f of this._folds) {
      if (!this._folded.has(f.openLine)) continue;
      for (let i = f.openLine + 1; i <= f.closeLine; i++) hidden.add(i);
    }
    this._hiddenLines = hidden;

    const vis: VisibleLine[] = [];
    let visOff = 0;
    for (let i = 0; i < lines.length; i++) {
      if (hidden.has(i)) continue;
      vis.push({ line: i, text: lines[i], start: visOff });
      visOff += lines[i].length + 1;
    }
    this._visibleLines = vis;
    this._visibleText = vis.map((v) => v.text).join("\n");
    this._ttLine = -1; // invalidate the hovered-line token cache
    this._resetTooltipState();

    // Full-text offset of the start of each line, plus a visible→full offset map.
    const starts: number[] = [];
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      starts.push(off);
      off += lines[i].length + (i < lines.length - 1 ? 1 : 0);
    }
    this._fullLineStarts = starts;

    const visToFull: number[] = new Array(this._visibleText.length + 1);
    let vo = 0;
    for (const v of vis) {
      const fl = starts[v.line];
      for (let k = 0; k < v.text.length; k++) {
        visToFull[vo] = fl + k;
        vo++;
      }
      visToFull[vo] = fl + v.text.length;
      vo++;
    }
    this._visToFull = visToFull;
  }

  private _fullLineOf(offset: number): number {
    let lo = 0;
    let hi = this._fullLineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this._fullLineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private _foldForLine(line: number): FoldRange | undefined {
    return this._folds.find((f) => f.openLine === line);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="je-root">
        <div class="je-viewport">
          <div class="je-inner">
            <div class="je-gutter-mount"></div>
            <div class="je-content">
              <div class="je-selection"></div>
              <div class="je-lines">
                ${this._hlBorder()}${this._visibleLines.map((v) => this._renderRow(v))}
              </div>
              <div class="je-tooltip" role="tooltip"></div>
              ${this._renderSuggest()}
              <textarea
                class="je-input"
                .value=${live(this._visibleText)}
                ?readonly=${this.readonly}
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                @input=${this._onInput}
                @beforeinput=${this._onBeforeInput}
                @keydown=${this._onKeydown}
                @keyup=${this._onKeyup}
                @select=${() => {
                  this._ensureCaretVisible();
                  this._updateSelectionHighlight();
                  this._syncActiveLine();
                  this._renderCarets();
                  this._updateSuggest();
                }}
                @mousedown=${(e: MouseEvent) => this._onMousedown(e)}
                @mousemove=${this._onMouseMove}
                @mouseleave=${this._onMouseLeave}
                @blur=${this._onBlur}
                @focus=${this._onFocus}
                @click=${this._onClick}
              ></textarea>
              <div class="je-caret-layer"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /** Re-render the rounded selection highlight after the DOM settles. */
  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    this._syncGutter();
    this._syncActiveLine();
    this._updateSelectionHighlight();
    this._renderCarets();
    this._positionSuggestTip();
  }

  // ── Gutter (openp41ge-core-editor-gutter) ─────────────────────────────────────

  firstUpdated(): void {
    // The platform's grid/tab mousedown handlers call preventDefault() to
    // prepare for pane drags. That cancels the textarea's NATIVE caret
    // placement (defaultPrevented mousedown → browser never moves the caret),
    // even though user-select is re-enabled. Stop mousedown at the editor root
    // so it never reaches those handlers — matching the file editor's .fe-root
    // guard ("Prevent mousedown from bubbling to grid drag handler").
    this.renderRoot
      .querySelector(".je-root")
      ?.addEventListener("mousedown", (e: Event) => e.stopPropagation());
    const mount = this.renderRoot.querySelector(".je-gutter-mount");
    if (!mount) return;
    this._gutter = new Gutter({
      events: {
        onRowClick: (row) => this._selectLine(row.key),
        onRowSelectRange: (a, b) => this._selectRange(a.key, b.key),
        onHoverChange: (key) => {
          if (this._hoverLine !== key) this._hoverLine = key;
        },
      },
    });
    this._gutter.setColumns([
      lineNumberColumn({
        width: () => gutterWidthFor(this._lineCount(), this._digitPx),
      }),
      foldColumn({
        // Square collapsible buttons: the fold column is as wide as the row
        // is tall, so the full-width chevron button is always a square.
        width: () => Math.max(1, Math.round(Number(this.rowHeight) || 20)),
        onToggle: (line) => this._toggleFold(line),
      }),
    ]);
    mount.appendChild(this._gutter.root);
    this._syncGutter();
  }

  /** Push the visible rows + hover into the shared gutter host. Rebuilds the
   *  row set only when content/row-height changes (hover moves just repaint
   *  the hovered row). */
  private _syncGutter(): void {
    if (!this._gutter) return;
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    const gutterW = gutterWidthFor(this._lineCount(), this._digitPx);
    const foldW = Math.max(1, Math.round(Number(this.rowHeight) || 20));
    if (gutterW !== this._gutterW || foldW !== this._gutterFoldW) {
      this._gutterW = gutterW;
      this._gutterFoldW = foldW;
      this._gutter.reflow();
    }
    if (this._gutterVisText !== this._visibleText || this._gutterRowH !== rowH) {
      this._gutterVisText = this._visibleText;
      this._gutterRowH = rowH;
      this._gutter.setRows(
        this._visibleLines.map((v, i): GutterRow => ({ key: v.line, top: i * rowH, height: rowH })),
        (key) => this._gutterData(key),
      );
      // Rebuilt rows: repaint every cell so the active/hover classes land on
      // the right cells (setRows only styles cells it (re)creates).
      this._gutter.refresh();
    }
  }

  /** Per-row gutter data shared by the built-in columns. */
  private _gutterData(key: number) {
    return {
      error: !!this._parseError && this._parseError.line === key,
      hasChevron: this._foldForLine(key) !== undefined,
      folded: this._folded.has(key),
    };
  }

  /** Select the whole visible line in the editor (click on a line number). */
  private _selectLine(fullLine: number): void {
    const ta = this.renderRoot.querySelector(".je-input") as HTMLTextAreaElement | null;
    const v = this._visibleLines.find((x) => x.line === fullLine);
    if (!ta || !v) return;
    ta.focus();
    this._collapseMulti();
    ta.setSelectionRange(v.start, v.start + v.text.length);
    this._updateBraceMatch(ta);
    this._updateSelectionHighlight();
    this._syncActiveLine();
  }

  /** Select the range of visible lines [a, b] (drag across line numbers). */
  private _selectRange(aLine: number, bLine: number): void {
    const ta = this.renderRoot.querySelector(".je-input") as HTMLTextAreaElement | null;
    const a = this._visibleLines.find((x) => x.line === aLine);
    const b = this._visibleLines.find((x) => x.line === bLine);
    if (!ta || !a || !b) return;
    ta.focus();
    const start = Math.min(a.start, b.start);
    const end = Math.max(a.start + a.text.length, b.start + b.text.length);
    this._collapseMulti();
    ta.setSelectionRange(start, end);
    this._updateBraceMatch(ta);
    this._updateSelectionHighlight();
    this._syncActiveLine();
  }

  /** Build the Monaco-style rounded selection highlight overlay.
   *  Renders EVERY caret's range (primary + extras) as its own rounded set. */
  private _updateSelectionHighlight(): void {
    const ta = this._inputEl();
    const overlay = this.renderRoot.querySelector(".je-selection") as HTMLElement | null;
    if (!ta || !overlay) return;
    const ranges = this._allCarets().map((c) => [c.s, c.e] as [number, number]);
    // Merge overlapping/adjacent ranges so overlapping carets don't double-
    // paint the highlight (one contiguous highlight per overlapped span).
    const merged: [number, number][] = [];
    for (const r of ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push([r[0], r[1]]);
      }
    }
    const key = merged.map((r) => `${r[0]}:${r[1]}`).join("|");
    if (this._lastSelKey === key && this._lastVisText === this._visibleText) return;
    this._lastSelKey = key;
    this._lastVisText = this._visibleText;
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    const rows = this.renderRoot.querySelectorAll(".je-lines .je-row");
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    for (const [s, e] of merged) {
      if (s === e) continue;
      const segs: { rowIndex: number; left: number; right: number }[] = [];
      this._visibleLines.forEach((v, i) => {
        const rowEl = rows[i] as HTMLElement | undefined;
        if (!rowEl) return;
        const lineStart = v.start;
        const lineEnd = v.start + v.text.length;
        const localStart = Math.max(s, lineStart) - lineStart;
        const localEnd = Math.min(e, lineEnd) - lineStart;
        if (localEnd <= localStart || localStart >= v.text.length) return;
        const lineEl = rowEl.querySelector(".je-line");
        if (!lineEl) return;
        const nodes = this._lineTextNodes(lineEl);
        const left = this._boundaryX(lineEl, nodes, Math.max(0, localStart));
        const right = this._boundaryX(lineEl, nodes, Math.min(v.text.length, localEnd));
        segs.push({ rowIndex: i, left, right });
      });
      this._renderSegs(overlay, segs, rowH);
    }
  }

  /** Render one selection's line segments as rounded, intern-joined pieces. */
  private _renderSegs(
    overlay: HTMLElement,
    segs: { rowIndex: number; left: number; right: number }[],
    rowH: number,
  ): void {
    if (segs.length === 0) return;
    const W = 3; // corner piece size
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const prev = i > 0 ? segs[i - 1] : null;
      const next = i + 1 < segs.length ? segs[i + 1] : null;
      const lineNum = this._visibleLines[seg.rowIndex].line;
      const prevAdj = prev && this._visibleLines[prev.rowIndex].line === lineNum - 1;
      const nextAdj = next && this._visibleLines[next.rowIndex].line === lineNum + 1;

      const tl = prevAdj ? this._cornerLeft(seg.left, prev!.left, prev!.right) : "ex";
      const bl = nextAdj ? this._cornerLeft(seg.left, next!.left, next!.right) : "ex";
      const tr = prevAdj ? this._cornerRight(seg.right, prev!.right) : "ex";
      const br = nextAdj ? this._cornerRight(seg.right, next!.right) : "ex";

      const top = seg.rowIndex * rowH;
      const segEl = document.createElement("div");
      let cls = "je-segment";
      if (tl === "ex") cls += " top-left-radius";
      if (tr === "ex") cls += " top-right-radius";
      if (bl === "ex") cls += " bottom-left-radius";
      if (br === "ex") cls += " bottom-right-radius";
      segEl.className = cls;
      segEl.style.left = `${seg.left}px`;
      segEl.style.top = `${top}px`;
      segEl.style.width = `${Math.max(0, seg.right - seg.left)}px`;
      segEl.style.height = `${rowH}px`;
      overlay.appendChild(segEl);

      if (tl === "in") this._renderIntern(overlay, seg.left, top, "left", "top", rowH, W);
      if (bl === "in") this._renderIntern(overlay, seg.left, top, "left", "bottom", rowH, W);
      if (tr === "in") this._renderIntern(overlay, seg.right, top, "right", "top", rowH, W);
      if (br === "in") this._renderIntern(overlay, seg.right, top, "right", "bottom", rowH, W);
    }
  }

  /** FLAT / INTERN / EXTERN for a left corner, vs the adjacent line. */
  private _cornerLeft(x: number, adjLeft: number, adjRight: number): "flat" | "in" | "ex" {
    if (Math.abs(x - adjLeft) < 1) return "flat";
    if (adjLeft < x && x < adjRight) return "in";
    return "ex";
  }

  /** FLAT / INTERN / EXTERN for a right corner, vs the adjacent line. */
  private _cornerRight(x: number, adjRight: number): "flat" | "in" | "ex" {
    if (Math.abs(x - adjRight) < 1) return "flat";
    if (x < adjRight) return "in";
    return "ex";
  }

  /** Render an INTERN corner: a highlight square with a bg-colored notch. */
  private _renderIntern(
    overlay: HTMLElement,
    edgeX: number,
    top: number,
    side: "left" | "right",
    edge: "top" | "bottom",
    rowH: number,
    w: number,
  ): void {
    const x = side === "left" ? edgeX - w : edgeX;
    const y = edge === "top" ? top : top + rowH - w;

    const piece = document.createElement("div");
    piece.className = "je-corner-piece";
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.width = `${w}px`;
    piece.style.height = `${w}px`;
    overlay.appendChild(piece);

    const notch = document.createElement("div");
    const cornerClass =
      side === "left"
        ? edge === "top"
          ? "top-right-radius"
          : "bottom-right-radius"
        : edge === "top"
          ? "top-left-radius"
          : "bottom-left-radius";
    notch.className = `je-notch ${cornerClass}`;
    notch.style.left = `${x}px`;
    notch.style.top = `${y}px`;
    notch.style.width = `${w}px`;
    notch.style.height = `${w}px`;
    overlay.appendChild(notch);
  }

  private _lineTextNodes(lineEl: Element): Text[] {
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (p && p.closest(".je-fold-meta")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    return nodes;
  }

  private _rangePosAt(nodes: Text[], offset: number): { node: Text; off: number } | null {
    for (const n of nodes) {
      if (offset <= n.data.length) return { node: n, off: offset };
      offset -= n.data.length;
    }
    return null;
  }

  /** X of the char boundary at `charIdx`, relative to the line's left edge.
   *  Uses exact glyph measurement (Range rects) when available; falls back
   *  to a constant monospace advance width where DOM layout is unavailable
   *  (e.g. jsdom, headless). */
  private _boundaryX(lineEl: Element, nodes: Text[], charIdx: number): number {
    const lineRect = lineEl.getBoundingClientRect();
    const pos = this._rangePosAt(nodes, charIdx);
    if (!pos) return 10 + charIdx * this._measureCharW();
    try {
      const range = document.createRange();
      range.setStart(pos.node, pos.off);
      range.setEnd(pos.node, pos.off);
      const r = range.getBoundingClientRect();
      if (r && typeof r.left === "number" && Number.isFinite(r.left)) {
        return r.left - lineRect.left;
      }
    } catch {
      /* fall through to monospace fallback */
    }
    return 10 + charIdx * this._measureCharW();
  }

  /** Advance width of a single monospace character, measured lazily. */
  private _measureCharW(): number {
    if (this._contentCharW > 0) return this._contentCharW;
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      this._contentCharW = 7;
      return this._contentCharW;
    }
    const s = document.createElement("span");
    s.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font-family:ui-monospace,'Cascadia Code','Fira Code',Menlo,Consolas,monospace;font-size:13px;";
    s.textContent = "0".repeat(100);
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width / 100;
    s.remove();
    this._contentCharW = w > 0 ? w : 7;
    return this._contentCharW;
  }

  private _renderRow(v: VisibleLine) {
    const fold = this._foldForLine(v.line);
    const isFolded = this._folded.has(v.line);
    const danger = this._dangerLines.has(v.line);
    const hlClass = danger
      ? this._highlightKind === "overwrite"
        ? " je-row--overwrite"
        : " je-row--danger"
      : "";
    const closeRow = /^\s*[}\]]\s*,?\s*$/.test(v.text);
    const faded = this._fadedLines.has(v.line);
    // The top-level object always exists — it is never deleted or overwritten,
    // so its opening line gets no action button, and it is never faded.
    const isRootLine = this._root != null && v.line === this._root.line;
    const showDel = !closeRow && !faded && !isRootLine && this._hoverLine === v.line;
    const showOverwrite = !closeRow && faded && !isRootLine && this._hoverLine === v.line;
    const tokens = tokenizeJsonFull(v.text);
    const { keyStarts, valueStarts } = this._classifyTokens(tokens);
    const meta = isFolded ? html`<span class="je-fold-meta">${this._foldMeta(fold)}</span>` : "";
    // When folded, the open line's own opening brace would sit next to the
    // meta's `{ … }`/`[ … ]` label (a doubled brace). Replace the line's
    // content with just the key prefix (everything before the opening brace)
    // so the fold meta is the only opening-brace replacement visible.
    const openIdx = isFolded
      ? tokens.findIndex((t) => t.kind === "punct" && (t.value === "{" || t.value === "["))
      : -1;
    const content = tokens.map((t, i) => {
      if (isFolded && openIdx >= 0 && i >= openIdx) return "";
      const abs = v.start + t.start;
      const brace =
        !isFolded &&
        this._braceMatch !== null &&
        (this._braceMatch[0] === abs || this._braceMatch[1] === abs);
      return this._renderToken(t, keyStarts, valueStarts, brace);
    });
    // Default (faded) rows are not in the user config yet, so they can't be
    // deleted; instead they offer an "overwrite" affordance that pins the
    // value into the user config (after which it becomes a normal, deletable
    // override). Buttons stay in the DOM and are revealed on hover (opacity).
    const actions =
      closeRow || isRootLine
        ? ""
        : faded
          ? html`<button
              class="je-ow ${showOverwrite ? "je-ow--show" : ""}"
              title="Overwrite this default value"
              @click=${() => this._overwriteAtLine(v.line)}
              @mouseenter=${() => {
                this._hoverLine = v.line;
                this._setRowHighlight(v.line, "overwrite");
              }}
              @mouseleave=${() => this._clearDanger()}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>`
          : html`<button
              class="je-del ${showDel ? "je-del--show" : ""}"
              title="Delete"
              @click=${() => this._deleteAtLine(v.line)}
              @mouseenter=${() => {
                this._hoverLine = v.line;
                this._setRowHighlight(v.line, "delete");
              }}
              @mouseleave=${() => this._clearDanger()}
            >
              ×
            </button>`;
    return html`<div
      class="je-row ${hlClass}${faded ? " je-row--faded" : ""}"
      data-line="${v.line}"
    >
      <div class="je-line">${content}${meta}</div>
      <div class="je-actions">${actions}</div>
    </div>`;
  }

  /** Promote the default value at `fullLine` to an explicit override: emit a
   *  `json-editor-overwrite` event carrying the entry's path and value so the
   *  host can pin it into the user config. */
  private _overwriteAtLine(fullLine: number): void {
    if (this.readonly || !this._root || this._parsedValue === undefined) return;
    const m = findEntryAtLine(this._root, fullLine);
    if (!m) return;
    const path = this._pathToNode(this._root, m.node);
    if (path === null) return;
    this.dispatchEvent(
      new CustomEvent(JSON_EDITOR_OVERWRITE, {
        detail: { path, value: getAt(this._parsedValue, path) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Per-line token classification: which tokens are object keys / scalar
   * values (for click-to-select and affordance classes). */
  private _classifyTokens(tokens: JsonToken[]): {
    keyStarts: Set<number>;
    valueStarts: Set<number>;
  } {
    const keyStarts = new Set<number>();
    const valueStarts = new Set<number>();
    const nonWs = tokens.filter((t) => t.kind !== "ws");
    for (let i = 0; i < nonWs.length; i++) {
      const t = nonWs[i];
      if (t.kind === "string") {
        const nxt = nonWs[i + 1];
        (nxt && nxt.kind === "punct" && nxt.value === ":" ? keyStarts : valueStarts).add(t.start);
      } else if (t.kind === "number" || t.kind === "keyword") {
        valueStarts.add(t.start);
      }
    }
    return { keyStarts, valueStarts };
  }

  private _renderToken(
    t: JsonToken,
    keyStarts: Set<number>,
    _valueStarts: Set<number>,
    braceMatch = false,
  ) {
    if (t.kind === "ws") return t.value;
    let cls = "s-pun";
    if (keyStarts.has(t.start)) cls = "s-var";
    else if (t.kind === "string") cls = "s-str";
    else if (t.kind === "number") cls = "s-num";
    else if (t.kind === "keyword") cls = "s-kw";
    if (braceMatch) cls += " je-brace--match";
    return html`<span class="${cls}">${t.value}</span>`;
  }

  /** Map a mouse x-offset (relative to the textarea) to a column index. */
  private _offsetXToCol(offsetX: number): number {
    const cw = this._measureCharW() > 0 ? this._measureCharW() : 8;
    return Math.max(0, Math.floor((offsetX - 10) / cw));
  }

  /** Show/hide the schema tooltip based on which key the mouse is over.
   *  Driven from the textarea's mousemove (the content spans sit beneath the
   *  overlay and never receive pointer events), so the hovered line's key is
   *  resolved from its column and the parsed tree's path. The tooltip is
   *  anchored to the key's own position (its column/row), not the cursor, and
   *  only appears after the cursor has rested on the key for a short delay.
   */
  private _updateKeyTooltip(idx: number, offsetX: number): void {
    const tip = this.renderRoot.querySelector<HTMLElement>(".je-tooltip");
    if (!tip) {
      this._resetTooltipState();
      return;
    }
    if (!this.schema) {
      this._resetTooltipState();
      return;
    }
    const v = this._visibleLines[idx];
    if (!v) {
      this._resetTooltipState();
      return;
    }
    if (v.line !== this._ttLine) {
      this._ttLine = v.line;
      this._ttTokens = tokenizeJsonFull(v.text);
      this._ttKeyStarts = this._classifyTokens(this._ttTokens).keyStarts;
    }
    const tokens = this._ttTokens;
    const keyStarts = this._ttKeyStarts;
    const col = this._offsetXToCol(offsetX);
    const keyTok = tokens.find(
      (t) => keyStarts.has(t.start) && col >= t.start && col < t.start + t.value.length,
    );
    let text: string | null = null;
    let hint: string | null = null;
    if (keyTok) {
      // Resolve the key's path. Normally from the parsed tree, but fall back to
      // a text scan when the document doesn't parse (a JSON error) so tooltips
      // still appear over the keys of a broken document.
      let path: JsonPath | null = null;
      if (this._root) {
        path = pathForLine(this._root, v.line);
      } else {
        const lineFullStart = this._fullLineStarts[v.line] ?? 0;
        const owner = ownerPathAt(this._text, lineFullStart);
        const keyName = keyNameFromToken(keyTok.value);
        if (owner && keyName !== null) path = [...owner, keyName];
      }
      if (path) {
        const schema = schemaAtPath(this.schema, path);
        // Fall back to an ancestor description so dynamic keys (free-form map
        // entries, arbitrary provider ids) still get a tooltip.
        text = schemaDescriptionForPath(this.schema, path);
        hint = schemaItemHint(schema);
      }
    }
    // Identity of the key under the cursor (line + token start).
    const keyId = keyTok && text ? `${v.line}:${keyTok.start}` : null;
    this._tooltipHoverKey = keyId;

    if (keyId && keyTok && text) {
      // Only (re)arm when the hovered key changed; otherwise leave the running
      // timer / already-shown tooltip alone (so moving within a key doesn't
      // reset the delay).
      if (this._tooltipPending?.keyId !== keyId) {
        this._hideKeyTooltip();
        this._clearTooltipTimer();
        this._tooltipPending = {
          keyId,
          line: v.line,
          start: keyTok.start,
          keyLen: keyTok.value.length,
          text,
          hint,
        };
        this._tooltipShowTimer = window.setTimeout(() => this._tooltipFire(), TOOLTIP_DELAY_MS);
      }
    } else {
      // Off any describable key → cancel the pending show and hide now.
      this._resetTooltipState();
    }
  }

  /** Clear the pending timer, hover key and any visible tooltip. */
  private _resetTooltipState(): void {
    this._clearTooltipTimer();
    this._tooltipPending = null;
    this._tooltipHoverKey = null;
    this._hideKeyTooltip();
  }

  /** Delay elapsed: show the pending key's tooltip if the cursor is still on it.
   *  When the description is a Markdown file reference, the resource is loaded
   *  first (async) and re-checked against the hover state so a stale load can't
   *  paint a tooltip the cursor has since left. */
  private async _tooltipFire(): Promise<void> {
    this._tooltipShowTimer = null;
    const p = this._tooltipPending;
    const seq = ++this._tooltipLoadSeq;
    if (!p || this._tooltipHoverKey !== p.keyId) {
      this._hideKeyTooltip();
      return;
    }
    const v = this._visibleLines.find((x) => x.line === p.line);
    const tip = this.renderRoot.querySelector<HTMLElement>(".je-tooltip");
    if (!v || !tip) {
      this._hideKeyTooltip();
      return;
    }
    const idx = this._visibleLines.indexOf(v);

    // Resolve the tooltip body. Most descriptions are inline Markdown; a
    // Markdown file reference is loaded through `resolveResource`.
    let body: string;
    if (isMarkdownFileRef(p.text) && this.resolveResource) {
      tip.textContent = "\u2026";
      let content: string | null = null;
      try {
        content = await this.resolveResource(p.text);
      } catch {
        content = null;
      }
      // The cursor may have moved on while the resource loaded.
      if (seq !== this._tooltipLoadSeq || this._tooltipHoverKey !== p.keyId) {
        this._hideKeyTooltip();
        return;
      }
      body = content
        ? renderMarkdown(content)
        : `<p>${p.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
    } else {
      body = renderMarkdown(p.text);
    }
    if (p.hint) {
      body += `<div class="je-tooltip-hint">${p.hint
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</div>`;
    }
    if (seq !== this._tooltipLoadSeq || this._tooltipHoverKey !== p.keyId) {
      this._hideKeyTooltip();
      return;
    }
    tip.innerHTML = body;
    tip.style.display = "block";
    // The tooltip may be wide, so it isn't pinned to the key's first column:
    // center it on the key, then clamp it so it never falls left of the content
    // edge and never clips past the viewport's right edge (it can sit further
    // left or further right than the key rather than being cut off).
    const tipW = tip.offsetWidth;
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    const cw = this._measureCharW() > 0 ? this._measureCharW() : 8;
    const keyW = p.keyLen * cw;
    let left = 10 + p.start * cw + (keyW - tipW) / 2;
    const viewport = this.renderRoot.querySelector<HTMLElement>(".je-viewport");
    const content = this.renderRoot.querySelector<HTMLElement>(".je-content");
    if (viewport && content) {
      const vpRight = viewport.getBoundingClientRect().right - content.getBoundingClientRect().left;
      const maxLeft = vpRight - tipW - 4;
      left = Math.min(left, Math.max(0, maxLeft));
    }
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${(idx + 1) * rowH + 2}px`;
  }

  private _clearTooltipTimer(): void {
    if (this._tooltipShowTimer !== null) {
      window.clearTimeout(this._tooltipShowTimer);
      this._tooltipShowTimer = null;
    }
  }

  private _hideKeyTooltip(): void {
    const tip = this.renderRoot.querySelector<HTMLElement>(".je-tooltip");
    if (tip) tip.style.display = "none";
  }

  // ── Key auto-complete (schema suggestions) ──────────────────────────────

  /** Render the suggestions list (below the caret) and the thin side tooltip
   *  for the highlighted row. Nothing is shown when there is no active list. */
  private _renderSuggest(): TemplateResult | typeof nothing {
    const s = this._suggest;
    if (!s) return nothing;
    const tipText = (s.items[s.selected]?.description ?? "").replace(/^\s+/, "") || null;
    const items = s.items.map((it, i) => {
      const sel = i === s.selected ? " je-suggest-item--sel" : "";
      const mousedown = (e: Event) => {
        e.preventDefault();
        this._acceptSuggest(i);
      };
      const enter = () => this._selectSuggest(i);
      // prettier-ignore
      return html`<div class="je-suggest-item${sel}" role="option" data-key=${it.key} @mousedown=${mousedown} @mouseenter=${enter}>${it.label ?? it.key}</div>`;
    });
    // prettier-ignore
    const tip = tipText
      ? html`<div class="je-suggest-tip" role="tooltip" style="left:${s.x + 188}px; top:${s.tipTop}px">${tipText}</div>`
      : nothing;
    return html`
      <div class="je-suggest" role="listbox" style="left:${s.x}px; top:${s.y}px">${items}</div>
      ${tip}
    `;
  }

  /** Recompute whether suggestions should show for the current caret and where
   *  the list should sit. Called after every edit and caret move. */
  private _updateSuggest(): void {
    if (this.readonly || this._carets.length > 0) {
      this._suggest = null;
      return;
    }
    const ta = this._inputEl();
    if (!ta) {
      this._suggest = null;
      return;
    }
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const selectedToken = selStart !== selEnd;
    // If the list was just dismissed at this exact caret (e.g. via Escape),
    // don't re-open it until the caret moves or the text changes.
    if (this._suggestSuppress !== null && selStart === this._suggestSuppress) return;
    this._suggestSuppress = null;
    const fullPos = this._visToFull[selStart];
    if (fullPos === undefined || fullPos === null) {
      this._suggest = null;
      return;
    }
    // Value-position enum suggestions first (e.g. `updateChannel`'s allowed
    // channels), then key auto-complete for key-position strings. The two are
    // mutually exclusive: a quoted string is either a key or a value.
    let items: KeySuggestion[] | null = null;
    let kind: "key" | "value" = "key";
    const valCtx = valueSuggestContextAt(this.schema, this._text, fullPos, selectedToken);
    if (valCtx) {
      items = valCtx.values.map((val) => ({
        key: val,
        description: valCtx.description,
        type: "string",
      }));
      kind = "value";
    } else if (this.schema) {
      const ctx = suggestContextAt(this._text, fullPos);
      if (ctx) {
        items = collectKeySuggestions(this.schema, ctx.ownerPath, this._parsedValue, ctx.prefix);
        kind = "key";
      }
    }
    if (!items || items.length === 0) {
      this._suggest = null;
      return;
    }
    const rowIdx = this._visibleLines.findIndex(
      (v) => selStart >= v.start && selStart <= v.start + v.text.length,
    );
    if (rowIdx < 0) {
      this._suggest = null;
      return;
    }
    const v = this._visibleLines[rowIdx];
    const col = Math.min(selStart - v.start, v.text.length);
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    const cw = this._measureCharW() > 0 ? this._measureCharW() : 8;
    const x = 10 + col * cw;
    const y = (rowIdx + 1) * rowH + 2;
    // Keep the highlight when the available set is unchanged (e.g. navigation)
    // and reset otherwise (e.g. the prefix was edited).
    const prev = this._suggest;
    const sameItems =
      prev !== null &&
      prev.kind === kind &&
      prev.items.length === items.length &&
      prev.items.every((p, i) => p.key === items[i].key);
    const selected = sameItems ? Math.min(prev!.selected, items.length - 1) : 0;
    this._suggest = {
      x,
      y,
      tipTop: y + selected * SUGGEST_ITEM_H,
      items,
      selected,
      kind,
    };
  }

  /** Move the highlighted suggestion (clamped). */
  private _moveSuggestSelection(delta: number): void {
    const s = this._suggest;
    if (!s) return;
    const selected = Math.min(s.items.length - 1, Math.max(0, s.selected + delta));
    if (selected === s.selected) return;
    this._suggest = { ...s, selected, tipTop: s.y + selected * SUGGEST_ITEM_H };
  }

  /** Highlight a suggestion on hover (also swaps the side tooltip). */
  private _selectSuggest(i: number): void {
    const s = this._suggest;
    if (!s || i === s.selected) return;
    this._suggest = { ...s, selected: i, tipTop: s.y + i * SUGGEST_ITEM_H };
  }

  /** Apply the highlighted (or given) suggestion: replace the quoted token
   *  with the key and park the caret after the closing quote. */
  private _acceptSuggest(index?: number): void {
    const s = this._suggest;
    if (!s) return;
    const item = s.items[index ?? s.selected];
    if (!item) return;
    const ta = this._inputEl();
    if (!ta) return;

    // Enum value: replace the whole value string with the chosen literal and
    // park the caret just after its closing quote.
    if (s.kind === "value") {
      const selIn = ta.selectionStart;
      const fullPos = this._visToFull[selIn];
      if (fullPos === undefined || fullPos === null) return;
      const str = stringAt(this._text, fullPos);
      if (!str) return;
      const line = this._fullLineOf(fullPos);
      const lineFullStart = this._fullLineStarts[line];
      const v = this._visibleLines.find((x) => x.line === line);
      if (!v) return;
      const visOpen = v.start + (str.open - lineFullStart);
      const visEnd = visOpen + (str.close - str.open + 1);
      const ins = JSON.stringify(item.key);
      this._replaceRange(ta, visOpen, visEnd, ins);
      const caretOffset = visOpen + ins.length;
      ta.setSelectionRange(caretOffset, caretOffset);
      this._suggest = null;
      this._suggestSuppress = caretOffset;
      this._afterEdit(ta);
      return;
    }

    const pos = ta.selectionStart;
    const fullPos = this._visToFull[pos];
    if (fullPos === undefined || fullPos === null) return;
    const str = stringAt(this._text, fullPos);
    if (!str) return;
    const line = this._fullLineOf(fullPos);
    const lineFullStart = this._fullLineStarts[line];
    const v = this._visibleLines.find((x) => x.line === line);
    if (!v) return;
    const visOpen = v.start + (str.open - lineFullStart);
    const visEnd = visOpen + (str.close - str.open + 1);
    const lit = defaultLiteralForType(item.type);
    const ins = `"${item.key}": ${lit.value}`;
    // A free-form "new key" suggestion has an empty key: park the caret inside
    // the empty quotes so the user types the actual key name.
    const caretOffset =
      item.key === ""
        ? visOpen + 1
        : lit.inside
          ? visOpen + ins.indexOf(lit.value) + 1
          : visOpen + ins.length;
    this._replaceRange(ta, visOpen, visEnd, ins);
    ta.setSelectionRange(caretOffset, caretOffset);
    this._suggest = null;
    // Suppress re-opening at the new caret: for a regular accept the caret sits
    // in the value (not a key), but for a free-form "new key" accept it sits
    // inside the fresh empty key quotes, which is itself a key position.
    this._suggestSuppress = caretOffset;
    this._afterEdit(ta);
  }

  /** Dismiss the suggestions list and remember the caret position so it won't
   *  instantly re-open (the caret is still on an empty quoted key). */
  private _dismissSuggest(): void {
    const ta = this._inputEl();
    this._suggest = null;
    this._suggestSuppress = ta ? ta.selectionStart : null;
  }

  /** Dismiss the suggestions list. */
  private _hideSuggest(): void {
    if (this._suggest) this._suggest = null;
  }

  /** Slide the thin side tooltip flush against the list's right edge (the list
   *  width isn't known at render time, so measure it after the DOM settles). */
  private _positionSuggestTip(): void {
    if (!this._suggest) return;
    const list = this.renderRoot.querySelector<HTMLElement>(".je-suggest");
    const tip = this.renderRoot.querySelector<HTMLElement>(".je-suggest-tip");
    if (!list || !tip) return;
    tip.style.left = `${list.offsetLeft + list.offsetWidth + 8}px`;
  }

  private _foldMeta(fold: FoldRange | undefined): string {
    if (!fold || !this._root) return "";
    const m = findEntryAtLine(this._root, fold.openLine);
    let node = m?.node;
    // findEntryAtLine only matches members/elements, so the ROOT fold (the
    // whole document collapsed onto its first/only row) yields no match. Fall
    // back to the root node when the fold opens on the root's own line.
    if (!node && fold.openLine === this._root.line) node = this._root;
    if (!node || (node.type !== "object" && node.type !== "array")) return "";
    const summary = summarize(node.value as Record<string, unknown> | unknown[]);
    // Render the summary INSIDE the braces — the row is the property key plus
    // this replacement, so the meta's braces are the only ones shown.
    return node.type === "object" ? `{ ${summary} }` : `[ ${summary} ]`;
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  private _onInput(e: Event): void {
    this._afterEdit(e.target as HTMLTextAreaElement);
  }

  /** With multiple carets the native textarea edit is replaced by a manual
   *  edit applied at every caret (see `_multiInsert`/`_multiBackspace`). */
  private _onBeforeInput = (e: InputEvent): void => {
    if (this.readonly || this._carets.length === 0) return;
    const type = e.inputType;
    if (type === "insertText") {
      e.preventDefault();
      this._multiInsert(e.data ?? "");
    } else if (type === "insertLineBreak" || type === "insertParagraph") {
      e.preventDefault();
      this._multiNewline();
    } else if (type === "deleteContentBackward" || type === "deleteWordBackward") {
      e.preventDefault();
      this._multiBackspace();
    } else if (type === "deleteContentForward" || type === "deleteWordForward") {
      e.preventDefault();
      this._multiDelete();
    } else if (type === "insertFromPaste" || type === "insertFromDrop") {
      e.preventDefault();
      this._multiInsert(e.data ?? "");
    }
  };

  private _onBlur = (): void => {
    this._isFocused = false;
    this._suggestSuppress = null;
    this._hideSuggest();
    this._renderCarets();
    this._syncActiveLine();
    const formatted = this._formatText(this._text);
    if (formatted !== null && formatted !== this._text) {
      this._folded.clear();
      this._text = formatted;
      this._rebuild(true);
    }
  };

  /** Reconcile a visible-text edit back into the full text, then rebuild. */
  private _afterEdit(ta: HTMLTextAreaElement): void {
    if (this.readonly) return;
    const newVis = ta.value;
    if (newVis !== this._visibleText) this._applyVisible(newVis);
    this._ensureCaretVisible();
    this._updateBraceMatch(ta);
    this._syncActiveLine();
    this._renderCarets();
    this._updateSuggest();
  }

  private _applyVisible(newVis: string): void {
    const oldVis = this._visibleText;
    // Find the edited region via common prefix/suffix.
    const p = this._commonPrefix(oldVis, newVis);
    const maxS = Math.min(oldVis.length, newVis.length) - p;
    let s = 0;
    while (s < maxS && oldVis[oldVis.length - 1 - s] === newVis[newVis.length - 1 - s]) s++;
    const vStart = p;
    const vEnd = oldVis.length - s;
    const inserted = newVis.slice(p, newVis.length - s);

    const fullStart = this._visToFull[Math.min(vStart, oldVis.length)];
    const fullEnd = this._visToFull[Math.min(vEnd, oldVis.length)];

    // Guard against edits that would swallow folded (hidden) content — expand
    // those folds and leave the text unchanged rather than lose data.
    if (this._editCrossesFolds(fullStart, fullEnd)) {
      this._folded.clear();
      this._computeVisible();
      this._tokens = tokenizeJsonFull(this._visibleText);
      this._selectables = selectableRanges(this._tokens);
      this._applyRowHeight();
      this.requestUpdate();
      return;
    }

    this._text = this._text.slice(0, fullStart) + inserted + this._text.slice(fullEnd);
    this._rebuild(true);
  }

  private _commonPrefix(a: string, b: string): number {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
  }

  /** True when the full-text region being edited spans any hidden (folded)
   *  line — an edit the user can only have made by crossing a fold. */
  private _editCrossesFolds(fullStart: number, fullEnd: number): boolean {
    if (this._hiddenLines.size === 0) return false;
    const sLine = this._fullLineOf(fullStart);
    const eLine = this._fullLineOf(fullEnd);
    for (const l of this._hiddenLines) {
      // Hidden lines strictly between the edit boundaries (the boundary lines
      // themselves are visible so they're not part of a fold's hidden span).
      if (l > sLine && l < eLine) return true;
    }
    return false;
  }

  /** Pretty-print/rebuild the parsed value as 2-space text. */
  private _toggleFold(openLine: number): void {
    if (this._folded.has(openLine)) this._folded.delete(openLine);
    else this._folded.add(openLine);
    this._computeVisible();
    this._tokens = tokenizeJsonFull(this._visibleText);
    this._selectables = selectableRanges(this._tokens);
    this._applyRowHeight();
    this.requestUpdate();
  }

  private _deleteAtLine(fullLine: number): void {
    if (this.readonly || !this._root || this._parsedValue === undefined) return;
    const m = findEntryAtLine(this._root, fullLine);
    if (!m) return;
    // Locate the entry's ACTUAL parent (a nested member may live deep inside
    // the value, e.g. providers.<id>.model) so the delete removes it at the
    // right depth rather than looking for the key at the root.
    const path = this._pathToNode(this._root, m.parent);
    if (path === null) return;
    const next = cloneDeep(this._parsedValue) as unknown;
    const container = path.length === 0 ? next : getAt(next, path);
    if (container == null || typeof container !== "object") return;
    if (m.member && typeof m.member.key === "string" && !Array.isArray(container)) {
      delete (container as Record<string, unknown>)[m.member.key];
    } else if (m.index !== undefined && Array.isArray(container)) {
      container.splice(m.index, 1);
    }
    const text = JSON.stringify(next, null, 2) ?? String(next);
    this._folded.clear();
    this._text = text;
    this._rebuild(true);
  }

  /** Path (object keys / array indices) from the root node down to `target`, or
   * null if `target` isn't reachable from `root`. Used to delete a member at
   * its real nesting depth. */
  private _pathToNode(root: JsonNode, target: JsonNode): JsonPath | null {
    if (root === target) return [];
    if (root.type === "object" && root.members) {
      for (let i = 0; i < root.members.length; i++) {
        const p = this._pathToNode(root.members[i].value, target);
        if (p) return [root.members[i].key, ...p];
      }
    } else if (root.type === "array" && root.elements) {
      for (let i = 0; i < root.elements.length; i++) {
        const p = this._pathToNode(root.elements[i], target);
        if (p) return [i, ...p];
      }
    }
    return null;
  }

  private _setRowHighlight(fullLine: number, kind: "delete" | "overwrite"): void {
    if (!this._root) return;
    const m = findEntryAtLine(this._root, fullLine);
    if (!m) return;
    const set = new Set<number>();
    for (let l = m.line; l <= m.node.endLine; l++) set.add(l);
    this._dangerLines = set;
    this._highlightKind = kind;
    this.requestUpdate();
  }

  /** The visible block of highlighted lines and the accent color for the
   *  delete / overwrite border. Returns null when nothing is highlighted. */
  private _hlBlock(): { top: number; height: number; color: string } | null {
    if (this._dangerLines.size === 0) return null;
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    let first = -1;
    let last = -1;
    for (let i = 0; i < this._visibleLines.length; i++) {
      if (this._dangerLines.has(this._visibleLines[i].line)) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return null;
    return {
      top: first * rowH,
      height: (last - first + 1) * rowH,
      color: this._highlightKind === "overwrite" ? "#58a6ff" : "#f48771",
    };
  }

  /** The 1px accent border shown while a member is highlighted for delete
   *  (red) or overwrite (blue). */
  private _hlBorder(): TemplateResult | typeof nothing {
    const b = this._hlBlock();
    if (!b) return nothing;
    return html`
      <div class="je-hl-border" style="top:${b.top}px; height:${b.height}px; --je-hl:${b.color}"></div>
    `;
  }

  private _clearDanger(): void {
    if (this._dangerLines.size === 0) return;
    this._dangerLines = new Set();
    this._highlightKind = "delete";
    this.requestUpdate();
  }

  /** Track which row the pointer is over so its delete button is revealed. */
  private _onMouseMove = (e: MouseEvent): void => {
    // Detect a drag (general highlight): mouse held and moved beyond a small
    // threshold. A drag disables the click-to-select-of-strings behavior.
    if (e.buttons > 0 && !this._dragMoved) {
      const dx = e.clientX - this._dragStartX;
      const dy = e.clientY - this._dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragMoved = true;
    }
    // While dragging, keep the selection highlight in sync with the cursor.
    // (The native textarea selection is hidden, and the `select` event only
    // fires on release, so the overlay must be repainted as the drag moves.)
    if (this._dragMoved && e.buttons > 0) {
      const ta = this._inputEl();
      if (ta && this._carets.length > 0) {
        // In multi mode the primary selection is driven by the model
        // (anchor/position), so mirror the drag's native selection into it.
        this._primaryAnchor = ta.selectionStart;
        this._primaryPosition = ta.selectionEnd;
      }
      this._updateSelectionHighlight();
    }
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    const idx = Math.floor(e.offsetY / rowH);
    const line = idx >= 0 && idx < this._visibleLines.length ? this._visibleLines[idx].line : null;
    if (line !== this._hoverLine) {
      this._hoverLine = line;
      this.requestUpdate();
    }
    // Schema tooltips follow the mouse over key tokens (the content spans sit
    // beneath the overlay, so this is the only place pointer position is seen).
    this._updateKeyTooltip(idx, e.offsetX);
  };

  private _onMousedown = (e: MouseEvent): void => {
    this._dragMoved = false;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    // Alt+Click adds/toggles a caret WITHOUT moving the primary caret — stop
    // the textarea from collapsing its selection, then place the new caret.
    if (e.altKey && !this.readonly && e.button === 0) {
      e.preventDefault();
      this._altClicked = true;
      const pos = this._clickedPos(e);
      this._toggleCaret(pos);
    }
  };

  /** Map a mousedown on the textarea to an offset in `_visibleText`. */
  private _clickedPos(e: MouseEvent): number {
    const rowH = Math.max(1, Number(this.rowHeight) || 20);
    const idx = Math.floor(e.offsetY / rowH);
    const v = this._visibleLines[Math.max(0, idx)];
    if (!v) return 0;
    const lineStart = v.start;
    const lineLen = v.text.length;
    const cw = this._measureCharW() > 0 ? this._measureCharW() : 8;
    const col = Math.max(0, Math.floor((e.offsetX - 10) / cw));
    return lineStart + Math.min(col, lineLen);
  }

  private _onMouseLeave = (): void => {
    if (this._hoverLine !== null || this._dangerLines.size > 0) {
      this._hoverLine = null;
      this._dangerLines = new Set();
      this._highlightKind = "delete";
      this.requestUpdate();
    }
    this._resetTooltipState();
  };

  // ── Bracket matching (caret on a bracket highlights its pair) ────────────
  private _updateBraceMatch(ta: HTMLTextAreaElement): void {
    const text = this._visibleText;
    const pos = ta.selectionStart;
    const isBr = (c: string) => c === "{" || c === "}" || c === "[" || c === "]";
    let idx = -1;
    if (isBr(text[pos])) idx = pos;
    else if (pos > 0 && isBr(text[pos - 1])) idx = pos - 1;
    const match = idx >= 0 ? this._bracketPair(text, idx) : -1;
    const next: [number, number] | null =
      match >= 0 ? [Math.min(idx, match), Math.max(idx, match)] : null;
    const same =
      (next === null && this._braceMatch === null) ||
      (next !== null &&
        this._braceMatch !== null &&
        next[0] === this._braceMatch[0] &&
        next[1] === this._braceMatch[1]);
    if (same) return;
    this._braceMatch = next;
    this.requestUpdate();
  }

  /** Find the index matching an opening/closing bracket (string-aware). */
  private _bracketPair(text: string, idx: number): number {
    const stack: number[] = [];
    const map = new Map<number, number>();
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") stack.push(i);
      else if (c === "}" || c === "]") {
        const o = stack.pop();
        if (o !== undefined) {
          map.set(o, i);
          map.set(i, o);
        }
      }
    }
    return map.get(idx) ?? -1;
  }

  // ── Key handling ─────────────────────────────────────────────────────────

  private _onKeydown(e: KeyboardEvent): void {
    if (this.readonly) return;
    const ta = e.target as HTMLTextAreaElement;
    const key = e.key;

    // Alt/Option+ArrowUp/Down — move the caret's current line up/down (VS Code).
    // Single-caret only: with multiple carets Alt+Arrow behaves like a plain
    // arrow (it moves all carets), handled by the multi-caret block below.
    if (
      this._carets.length === 0 &&
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (key === "ArrowUp" || key === "ArrowDown")
    ) {
      e.preventDefault();
      e.stopPropagation();
      this._moveLine(ta, key === "ArrowUp" ? -1 : 1);
      return;
    }

    // Key auto-complete is single-caret only: while the list is up, Up/Down
    // move the highlight, Enter/Tab accept it, Escape dismisses, and Left/Right
    // dismiss the list and let the native caret move proceed.
    if (this._carets.length === 0 && this._suggest) {
      if (key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        this._moveSuggestSelection(key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (key === "Enter" || key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        this._acceptSuggest();
        return;
      }
      if (key === "Escape") {
        // Consume Escape while the list is up so it hides the list instead of
        // bubbling to the drawer's document listener and closing the drawer.
        e.preventDefault();
        e.stopPropagation();
        this._dismissSuggest();
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.stopPropagation();
        this._hideSuggest();
        return;
      }
    }

    // Add a caret above/below the primary — works even from a single caret.
    if ((e.ctrlKey || e.metaKey) && e.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
      e.preventDefault();
      this._addCaretAboveBelow(key === "ArrowUp" ? -1 : 1);
      return;
    }

    // With multiple carets, Enter/Tab/Escape are handled here; plain chars &
    // backspace/delete flow through `@beforeinput` so the edit is applied at
    // EVERY caret. Arrow keys move ALL carets; Shift extends each selection.
    if (this._carets.length > 0) {
      if (/^Arrow/.test(key)) {
        e.preventDefault();
        this._moveAllCarets(key, e.shiftKey, e.metaKey || e.ctrlKey);
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        this._multiNewline();
        return;
      }
      if (key === "Tab") {
        e.preventDefault();
        this._multiInsert("  ");
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        this._carets = [];
        this._renderCarets();
        return;
      }
      return;
    }

    // Single caret: Cmd/Ctrl+Arrow is unreliable in the native textarea (and
    // the caret bar wouldn't track the active end), so drive line/document
    // boundary moves through the shared engine too. Plain arrows & Shift stay
    // native.
    if ((e.metaKey || e.ctrlKey) && /^Arrow/.test(key)) {
      e.preventDefault();
      this._singleCmdArrow(ta, key, e.shiftKey);
      return;
    }

    if (key === "Enter") {
      e.preventDefault();
      if (this._enterEmptyPair(ta)) {
        this._afterEdit(ta);
        return;
      }
      this._replaceRange(ta, ta.selectionStart, ta.selectionEnd, "\n" + this._indentAfter(ta));
      this._afterEdit(ta);
      return;
    }
    if (key === "Tab") {
      e.preventDefault();
      this._replaceRange(ta, ta.selectionStart, ta.selectionEnd, "  ");
      this._afterEdit(ta);
      return;
    }
    if (key === "Backspace") {
      if (this._pairBackspace(ta)) {
        e.preventDefault();
        this._afterEdit(ta);
      }
      return;
    }
    if (key === "{") {
      if (this._autoPair(ta, "{", "}")) {
        e.preventDefault();
        this._afterEdit(ta);
      }
      return;
    }
    if (key === "[") {
      if (this._autoPair(ta, "[", "]")) {
        e.preventDefault();
        this._afterEdit(ta);
      }
      return;
    }
    if (key === '"') {
      if (this._autoPairQuote(ta)) {
        e.preventDefault();
        this._afterEdit(ta);
      }
      return;
    }
    if (key === "}" || key === "]") {
      if (this._skipOver(ta, key)) {
        e.preventDefault();
        this._afterEdit(ta);
      }
    }
  }

  private _onKeyup = (e: KeyboardEvent): void => {
    const ta = e.target as HTMLTextAreaElement;
    this._updateBraceMatch(ta);
    this._syncActiveLine();
    this._renderCarets();
    this._updateSuggest();
  };

  private _onClick = (e: Event): void => {
    if (this.readonly) return;
    const ta = e.target as HTMLTextAreaElement;
    // An Alt+Click already added a caret in mousedown — swallow the click.
    if (this._altClicked) {
      this._altClicked = false;
      return;
    }
    // A plain click collapses to the single primary caret.
    if (this._carets.length > 0) this._collapseMulti();
    // A drag (general highlight) disables the click-to-select of strings.
    if (this._dragMoved) {
      this._dragMoved = false;
      this._updateBraceMatch(ta);
      this._syncActiveLine();
      return;
    }
    if (ta.selectionStart !== ta.selectionEnd) {
      this._updateBraceMatch(ta);
      this._syncActiveLine();
      return;
    }
    const pos = ta.selectionStart;
    const r = this._selectableAt(pos);
    if (r) {
      ta.setSelectionRange(r.start, r.end);
      // Clicking a value token selects it — surface its enum suggestions so
      // Up/Down can cycle the allowed values (e.g. the update channel).
      this._updateSuggest();
    }
    this._updateBraceMatch(ta);
    this._syncActiveLine();
  };

  private _selectableAt(pos: number): SelectableRange | null {
    for (const r of this._selectables) {
      // Only auto-select when the caret sits ON the token — strictly within the
      // token's span, not on the whitespace/comma/end-of-line just beyond it.
      // This keeps a click at the end of a property (to type `,`) from
      // selecting the preceding string/value.
      if (pos >= r.start && pos <= r.end) return r;
    }
    return null;
  }

  // ── JSON editing helpers ─────────────────────────────────────────────────

  private _autoPair(ta: HTMLTextAreaElement, open: string, close: string): boolean {
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const pos = ta.selectionStart;
    this._replaceRange(ta, pos, pos, open + close);
    ta.setSelectionRange(pos + 1, pos + 1);
    return true;
  }

  private _autoPairQuote(ta: HTMLTextAreaElement): boolean {
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const text = ta.value;
    const pos = ta.selectionStart;
    if (this._insideString(text, pos)) {
      if (text[pos] === '"') {
        ta.setSelectionRange(pos + 1, pos + 1);
        return true;
      }
      return false;
    }
    this._replaceRange(ta, pos, pos, '""');
    ta.setSelectionRange(pos + 1, pos + 1);
    return true;
  }

  private _skipOver(ta: HTMLTextAreaElement, ch: string): boolean {
    if (ta.value[ta.selectionStart] !== ch) return false;
    ta.setSelectionRange(ta.selectionStart + 1, ta.selectionStart + 1);
    return true;
  }

  private _pairBackspace(ta: HTMLTextAreaElement): boolean {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    if (s !== e || s <= 0) return false;
    const open = value[s - 1];
    const close = value[s];
    if (
      (open === "{" && close === "}") ||
      (open === "[" && close === "]") ||
      (open === '"' && close === '"')
    ) {
      this._replaceRange(ta, s - 1, s + 1, "");
      ta.setSelectionRange(s - 1, s - 1);
      return true;
    }
    return false;
  }

  private _indentAfter(ta: HTMLTextAreaElement): string {
    return this._indentAt(ta.value, ta.selectionStart);
  }

  /** Enter inside an empty `[]`/`{}` pair expands it into a three-line block:
   *  the closing bracket moves onto its own line aligned with the opening
   *  line's indent, and the caret lands on a freshly-indented middle line
   *  ready for the first value. Returns true when handled. */
  private _enterEmptyPair(ta: HTMLTextAreaElement): boolean {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    if (s !== e || s <= 0 || s >= value.length) return false;
    const open = value[s - 1];
    const close = value[s];
    if (!((open === "[" && close === "]") || (open === "{" && close === "}"))) {
      return false;
    }
    const contentIndent = this._indentAt(value, s);
    const closeIndent = this._indentAt(value, s - 1);
    const ins = `\n${contentIndent}\n${closeIndent}`;
    this._replaceRange(ta, s, s, ins);
    ta.setSelectionRange(s + 1 + contentIndent.length, s + 1 + contentIndent.length);
    return true;
  }

  private _indentAt(text: string, pos: number): string {
    const before = text.slice(0, pos);
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = 0; i < before.length; i++) {
      const c = before[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") depth = Math.max(0, depth - 1);
    }
    return "  ".repeat(depth);
  }

  // ── Custom caret rendering (file-editor style: 2px bar, blink) ───────────

  private _inputEl(): HTMLTextAreaElement | null {
    return this.renderRoot.querySelector(".je-input") as HTMLTextAreaElement | null;
  }

  private _defaultCharW(): number {
    return this._measureCharW() > 0 ? this._measureCharW() : 7;
  }

  /** Exit multi-caret mode (collapse to the single primary hover). */
  private _collapseMulti(): void {
    if (this._carets.length > 0) {
      this._carets = [];
      this._renderCarets();
    }
  }

  /** All caret ranges (primary + extras). Neither deduplicates carets that
   *  share a position nor sorts — callers render/merge every caret, and the
   *  edit helpers dedup identical ranges themselves while keeping the 1:1
   *  caret-to-result mapping. Callers that need an ordering sort locally. */
  private _allCarets(): { s: number; e: number; pos: number }[] {
    const ta = this._inputEl();
    let anchor: number;
    let pos: number;
    if (this._carets.length > 0) {
      anchor = this._primaryAnchor;
      pos = this._primaryPosition;
    } else {
      const s = ta?.selectionStart ?? 0;
      const e = ta?.selectionEnd ?? 0;
      // The caret must sit at the ACTIVE end the user is moving. For a
      // backward selection (Shift+ArrowLeft/Shift+ArrowUp) the active end is
      // selectionStart; using selectionEnd would pin the caret to the anchor.
      if (ta?.selectionDirection === "backward") {
        anchor = e;
        pos = s;
      } else {
        anchor = s;
        pos = e;
      }
    }
    const out: { s: number; e: number; pos: number }[] = [
      { s: Math.min(anchor, pos), e: Math.max(anchor, pos), pos },
    ];
    for (const c of this._carets) {
      const cs = Math.min(c.anchor, c.position);
      out.push({ s: cs, e: Math.max(c.anchor, c.position), pos: c.position });
    }
    return out;
  }

  /** Render one `.je-caret` (2px bar) per caret, positioned over the text. */
  private _renderCarets(): void {
    const layer = this.renderRoot.querySelector(".je-caret-layer") as HTMLElement | null;
    const ta = this._inputEl();
    if (!layer || !ta) return;
    layer.style.display = this._isFocused && !this.readonly ? "" : "none";
    if (layer.style.display === "none") return;

    const all = this._allCarets();
    while (this._caretEls.length < all.length) {
      const el = document.createElement("div");
      el.className = "je-caret";
      layer.appendChild(el);
      this._caretEls.push(el);
    }
    while (this._caretEls.length > all.length) {
      const el = this._caretEls.pop()!;
      el.remove();
    }
    const lh = Math.max(1, Number(this.rowHeight) || 20);
    const cw = this._defaultCharW();
    const vis = this._visibleText;
    for (let i = 0; i < all.length; i++) {
      const el = this._caretEls[i];
      const pos = all[i].pos;
      const lineIdx = vis.slice(0, pos).split("\n").length - 1;
      const lineStart = lineIdx > 0 ? vis.lastIndexOf("\n", pos - 1) + 1 : 0;
      const col = pos - lineStart;
      el.style.left = 10 + col * cw + "px";
      el.style.top = lineIdx * lh + "px";
      el.style.height = lh + "px";
      el.style.opacity = this._caretVisible ? "1" : "0";
    }
  }

  private _startCaretBlink(): void {
    if (this._caretRaf !== null || typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      if (!this.isConnected) return;
      const phase = performance.now() % 1000;
      const visible = phase < 500;
      if (visible !== this._caretVisible) {
        this._caretVisible = visible;
        for (const el of this._caretEls) el.style.opacity = visible ? "1" : "0";
      }
      this._caretRaf = requestAnimationFrame(loop);
    };
    this._caretRaf = requestAnimationFrame(loop);
  }

  private _stopCaretBlink(): void {
    if (this._caretRaf !== null) cancelAnimationFrame(this._caretRaf);
    this._caretRaf = null;
    this._caretVisible = true;
    for (const el of this._caretEls) el.style.opacity = "1";
  }

  // ── Multi-caret editing ─────────────────────────────────────────────────

  private _toggleCaret(pos: number): void {
    const ta = this._inputEl();
    const i = this._carets.findIndex((c) => c.anchor === pos && c.position === pos);
    if (i >= 0) {
      this._carets.splice(i, 1);
    } else {
      if (this._carets.length === 0 && ta) {
        // Entering multi mode: capture the primary caret's selection state.
        this._primaryAnchor = ta.selectionStart;
        this._primaryPosition = ta.selectionEnd;
      }
      this._carets.push({ anchor: pos, position: pos });
    }
    this._carets.sort((a, b) => a.position - b.position);
    this._renderCarets();
  }

  /** Ctrl+Alt+Up/Down — add a caret on the line above/below the primary. */
  private _addCaretAboveBelow(dir: -1 | 1): void {
    const ta = this._inputEl();
    const primary = ta?.selectionStart ?? 0;
    const vis = this._visibleText;
    const lineIdx = vis.slice(0, primary).split("\n").length - 1;
    const lineStart = lineIdx > 0 ? vis.lastIndexOf("\n", primary - 1) + 1 : 0;
    const col = primary - lineStart;
    const target = lineIdx + dir;
    const lines = vis.split("\n");
    if (target < 0 || target >= lines.length) return;
    const targetLine = lines[target];
    const targetStart = lines.slice(0, target).reduce((a, l) => a + l.length + 1, 0);
    const pos = targetStart + Math.min(col, targetLine.length);
    if (this._carets.length === 0) {
      this._primaryAnchor = primary;
      this._primaryPosition = ta?.selectionEnd ?? primary;
    }
    if (!this._carets.some((c) => c.position === pos)) {
      this._carets.push({ anchor: pos, position: pos });
      this._carets.sort((a, b) => a.position - b.position);
      this._renderCarets();
    }
  }

  /** Arrow keys in multi mode: delegate the movement/selection command to the
   *  shared CursorController, which applies it to EVERY caret (Shift extends
   *  each selection, Cmd jumps to line/document boundaries). The controller is
   *  seeded from the editor's folding-aware offset caret state and read back
   *  afterwards so the editor keeps ownership of its visible-buffer model. */
  private _moveAllCarets(key: string, extend: boolean, cmd = false): void {
    this._applyArrowCommand(
      [
        { anchor: this._primaryAnchor, position: this._primaryPosition },
        ...this._carets.map((c) => ({ anchor: c.anchor, position: c.position })),
      ],
      key,
      extend,
      cmd,
    );
  }

  /** Single-caret Cmd/Ctrl+Arrow: drive the line/document-boundary move through
   *  the engine too, so the custom caret + selection track the active end
   *  (native textarea Cmd+arrow is unreliable across platforms). */
  private _singleCmdArrow(ta: HTMLTextAreaElement, key: string, extend: boolean): void {
    const backward = ta.selectionDirection === "backward";
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const anchor = backward ? e : s;
    const position = backward ? s : e;
    this._applyArrowCommand([{ anchor, position }], key, extend, true);
  }

  /** Seed a fresh CursorController from offset caret states, dispatch one arrow
   *  command, then write the results back to the primary + extras and refresh
   *  the selection/caret layers. */
  private _applyArrowCommand(
    seed: { anchor: number; position: number }[],
    key: string,
    extend: boolean,
    cmd: boolean,
  ): void {
    const ta = this._inputEl();
    if (!ta) return;
    const controller = new CursorController(
      new PieceTreeTextContentModel("json-editor", this._visibleText),
    );
    controller.setCursorStates(
      seed.map((c) => ({
        position: this._posAt(c.position),
        selectionAnchor: this._posAt(c.anchor),
      })),
    );
    this._applyCursorOp(controller, key, extend, cmd);
    const all = controller.getAllCursors();
    this._primaryAnchor = this._offsetAt(all[0].selectionAnchor);
    this._primaryPosition = this._offsetAt(all[0].position);
    this._carets = all.slice(1).map((c) => ({
      anchor: this._offsetAt(c.selectionAnchor),
      position: this._offsetAt(c.position),
    }));
    ta.setSelectionRange(
      Math.min(this._primaryAnchor, this._primaryPosition),
      Math.max(this._primaryAnchor, this._primaryPosition),
      this._primaryPosition < this._primaryAnchor ? "backward" : "forward",
    );
    this._updateBraceMatch(ta);
    this._updateSelectionHighlight();
    this._syncActiveLine();
    this._renderCarets();
  }

  /** Dispatch an arrow command onto the shared cursor controller. Cmd+arrow
   *  jumps to line/document boundaries; plain arrows step; Shift extends. */
  private _applyCursorOp(
    controller: CursorController,
    key: string,
    extend: boolean,
    cmd: boolean,
  ): void {
    if (cmd) {
      switch (key) {
        case "ArrowLeft":
          extend ? controller.selectToLineStart() : controller.moveToLineStart();
          break;
        case "ArrowRight":
          extend ? controller.selectToLineEnd() : controller.moveToLineEnd();
          break;
        case "ArrowUp":
          extend ? controller.selectToFileStart() : controller.moveToFileStart();
          break;
        case "ArrowDown":
          extend ? controller.selectToFileEnd() : controller.moveToFileEnd();
          break;
      }
    } else {
      switch (key) {
        case "ArrowLeft":
          extend ? controller.selectLeft() : controller.moveLeft();
          break;
        case "ArrowRight":
          extend ? controller.selectRight() : controller.moveRight();
          break;
        case "ArrowUp":
          extend ? controller.selectUp() : controller.moveUp();
          break;
        case "ArrowDown":
          extend ? controller.selectDown() : controller.moveDown();
          break;
      }
    }
  }

  /** Offset → 1-based line/column position within the visible buffer. */
  private _posAt(offset: number): TextPosition {
    const text = this._visibleText;
    const clamped = Math.max(0, Math.min(offset, text.length));
    const lineIdx = text.slice(0, clamped).split("\n").length - 1;
    const lineStart = lineIdx > 0 ? text.lastIndexOf("\n", clamped - 1) + 1 : 0;
    return { lineNumber: lineIdx + 1, column: clamped - lineStart + 1 };
  }

  /** 1-based line/column position → offset within the visible buffer. */
  private _offsetAt(position: TextPosition): number {
    const lines = this._visibleText.split("\n");
    let off = 0;
    const last = Math.max(0, position.lineNumber - 1);
    for (let i = 0; i < last && i < lines.length; i++) off += lines[i].length + 1;
    return off + Math.max(0, position.column - 1);
  }

  /** Apply a (visible-text) edit result across every caret, then rebuild. */
  private _applyMultiResult(out: string, newPos: number[]): void {
    this._applyVisible(out);
    const primary = newPos[0] ?? 0;
    this._carets = newPos.slice(1).map((p) => ({ anchor: p, position: p }));
    this._primaryAnchor = primary;
    this._primaryPosition = primary;
    const ta = this._inputEl();
    if (ta) {
      ta.value = this._visibleText;
      ta.setSelectionRange(primary, primary);
    }
    this._ensureCaretVisible();
    if (ta) this._updateBraceMatch(ta);
    this._syncActiveLine();
    this._updateSelectionHighlight();
    this._renderCarets();
  }

  /** Apply an edit at every caret via a per-caret mutator. Carets that share
   *  the same span (e.g. after Cmd+ArrowUp converged them to one position)
   *  are edited ONCE, but every caret still maps to its own result position
   *  so the caret count and both carets' presence persist. */
  private _multiEdit(
    mutate: (
      s: number,
      e: number,
      vis: string,
    ) => {
      ins: string;
      delStart: number;
      delEnd: number;
      result: number;
    },
  ): void {
    const carets = this._allCarets();
    const vis = this._visibleText;
    const seen = new Set<string>();
    const edits: { delStart: number; delEnd: number; ins: string; s: number }[] = [];
    const resultByKey = new Map<string, number>();
    for (const c of carets) {
      const key = `${c.s}:${c.e}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = mutate(c.s, c.e, vis);
      edits.push({ delStart: r.delStart, delEnd: r.delEnd, ins: r.ins, s: c.s });
      resultByKey.set(key, r.result);
    }
    edits.sort((a, b) => b.s - a.s);
    let out = vis;
    for (const ed of edits) {
      out = out.slice(0, ed.delStart) + ed.ins + out.slice(ed.delEnd);
    }
    const newPos = carets.map((c) => resultByKey.get(`${c.s}:${c.e}`)!);
    this._applyMultiResult(out, newPos);
  }

  /** Insert `data` at every caret (with JSON auto-pair for braces/quotes). */
  private _multiInsert(data: string): void {
    this._multiEdit((s, e, vis) => {
      let ins = data;
      let off = data.length;
      if (data === "{" || data === "[") {
        ins = data + (data === "{" ? "}" : "]");
        off = 1;
      } else if (data === '"') {
        if (this._insideString(vis, e)) ins = '"';
        else ins = '""';
        off = 1;
      } else if (data === "}" || data === "]") {
        if (e === s && vis[e] === data) {
          ins = "";
          off = 1;
        } else {
          ins = data;
          off = 1;
        }
      }
      return { ins, delStart: s, delEnd: e, result: s + off };
    });
  }

  /** Backspace at every caret (deleting a selection, or an adjacent pair). */
  private _multiBackspace(): void {
    this._multiEdit((s, e, vis) => {
      if (e > s) return { ins: "", delStart: s, delEnd: e, result: s };
      if (s <= 0) return { ins: "", delStart: s, delEnd: s, result: 0 };
      const open = vis[s - 1];
      const close = vis[s];
      const pair =
        (open === "{" && close === "}") ||
        (open === "[" && close === "]") ||
        (open === '"' && close === '"');
      if (pair) return { ins: "", delStart: s - 1, delEnd: s + 1, result: s - 1 };
      return { ins: "", delStart: s - 1, delEnd: s, result: s - 1 };
    });
  }

  /** Delete-forward at every caret. */
  private _multiDelete(): void {
    this._multiEdit((s, e, vis) => {
      if (e > s) return { ins: "", delStart: s, delEnd: e, result: s };
      if (s >= vis.length) return { ins: "", delStart: s, delEnd: s, result: s };
      return { ins: "", delStart: s, delEnd: s + 1, result: s };
    });
  }

  /** Enter at every caret (newline + auto-indent). */
  private _multiNewline(): void {
    this._multiEdit((s, _e, vis) => {
      // Expand empty `[]`/`{}` pairs just like the single-caret Enter: the
      // closing bracket moves to its own aligned line, caret to the new
      // indented middle line.
      if (s > 0 && s < vis.length) {
        const open = vis[s - 1];
        const close = vis[s];
        if ((open === "[" && close === "]") || (open === "{" && close === "}")) {
          const ci = this._indentAt(vis, s);
          const cli = this._indentAt(vis, s - 1);
          const ins = `\n${ci}\n${cli}`;
          return { ins, delStart: s, delEnd: s, result: s + 1 + ci.length };
        }
      }
      const ins = "\n" + this._indentAt(vis, s);
      return { ins, delStart: s, delEnd: s, result: s + ins.length };
    });
  }

  private _insideString(text: string, pos: number): boolean {
    let inStr = false;
    let escaped = false;
    for (let i = 0; i < pos; i++) {
      const c = text[i];
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = !inStr;
    }
    return inStr;
  }

  private _replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string): void {
    ta.setRangeText(text, start, end, "end");
  }

  /** Alt/Option+ArrowUp/Down — swap the caret's current line with the line
   *  above/below (VS Code), keeping the caret at the same column on the moved
   *  line. Operates on the visible text (the textarea value); `_afterEdit`
   *  reconciles the change with the full/parsed text. */
  private _moveLine(ta: HTMLTextAreaElement, dir: number): void {
    const value = ta.value;
    const caret = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const col = caret - lineStart;

    // 0-based index of the caret's line.
    let lineIdx = 0;
    for (let i = 0; i < caret; i++) if (value[i] === "\n") lineIdx++;

    // Split into line units, each keeping its trailing newline (the last unit
    // may have none), so the text reassembles exactly.
    const units: string[] = [];
    let last = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "\n") {
        units.push(value.slice(last, i + 1));
        last = i + 1;
      }
    }
    if (last < value.length) units.push(value.slice(last));

    const target = lineIdx + dir;
    if (target < 0 || target >= units.length) return; // boundary — no-op

    const tmp = units[lineIdx];
    units[lineIdx] = units[target];
    units[target] = tmp;
    const newVal = units.join("");
    ta.value = newVal;

    // Move the caret to the same column on the moved line.
    let movedStart = 0;
    for (let i = 0; i < target; i++) movedStart += units[i].length;
    const movedLen = units[target].endsWith("\n")
      ? Math.max(0, units[target].length - 1)
      : units[target].length;
    ta.setSelectionRange(
      movedStart + Math.min(col, movedLen),
      movedStart + Math.min(col, movedLen),
    );

    this._afterEdit(ta);
  }

  /** Keep the caret line in view within the scroll container. */
  private _ensureCaretVisible = (): void => {
    const ta = this.renderRoot.querySelector("textarea.je-input") as
      HTMLTextAreaElement | undefined;
    const vp = this.renderRoot.querySelector(".je-viewport") as HTMLElement | undefined;
    if (!ta || !vp) return;
    const lh = Math.max(1, Number(this.rowHeight) || 20);
    const line = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
    const top = line * lh;
    if (top < vp.scrollTop) vp.scrollTop = top;
    else if (top + lh > vp.scrollTop + vp.clientHeight) vp.scrollTop = top + lh - vp.clientHeight;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "json-editor": JsonEditorElement;
  }
}
