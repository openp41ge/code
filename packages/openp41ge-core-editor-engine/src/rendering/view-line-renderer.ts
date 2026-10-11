/**
 * renderViewLine — produces HTML output from line content, tokens, and decorations.
 *
 * This is the core rendering function for the file editor. It walks the tokens
 * for a line, wraps each token segment in a styled <span>, and produces a
 * CharacterMapping that maps output DOM positions back to input text offsets.
 *
 * The CharacterMapping is critical for cursor positioning — when the hidden
 * TextArea is placed at a screen pixel position, the mapping tells us which
 * text offset that pixel corresponds to.
 *
 * Returns:
 *   - html: The rendered HTML string for the line
 *   - characterMapping: Array mapping each output character position to its
 *     corresponding input text offset
 */

import type { IToken } from "openp41ge-core-syntax-highlighting/line-tokens";
import { StandardTokenType } from "openp41ge-core-syntax-highlighting/line-tokens";
import { StringBuilder } from "../view/string-builder";

/**
 * The output of a single line render.
 */
export interface RenderLineOutput {
  /** Rendered HTML string. */
  readonly html: string;
  /**
   * Maps each output character position (0-based) to an input text offset.
   * The length of this array equals the number of visible output characters,
   * which may differ from input length due to whitespace rendering,
   * tab expansion, or control character display.
   */
  readonly characterMapping: Uint32Array;
  /** The number of visible columns (for scroll width calculation). */
  readonly visibleColumnCount: number;
}

/**
 * CSS class names for token types.
 */
const TOKEN_CLASSES: Record<number, string> = {
  [StandardTokenType.Other]: "token-other",
  [StandardTokenType.Comment]: "token-comment",
  [StandardTokenType.String]: "token-string",
  [StandardTokenType.RegEx]: "token-regex",
};

/**
 * CSS class names for font styles.
 */
const FONT_STYLE_CLASSES: Record<number, string> = {
  0: "", // None
  1: "token-italic", // Italic
  2: "token-bold", // Bold
  3: "token-italic-bold", // Italic + Bold
  4: "token-underline", // Underline
  5: "token-italic-underline",
  6: "token-bold-underline",
  7: "token-italic-bold-underline",
};

/**
 * Render a single line of text with tokens into HTML.
 *
 * @param lineContent - The raw text of the line.
 * @param tokens - Token array for the line (from tokenization system).
 * @param tabSize - Number of spaces per tab.
 * @param bracketDepths - Optional map of bracket depths for bracket pair
 *   colorization. Keys are "${lineNumber}:${startIndex}" format, values
 *   are depth levels (0, 1, 2, ...). When provided, bracket characters
 *   get an additional CSS class like `s-bracket-d0` for colorization.
 * @param colorMap - Optional theme color map (foreground index → CSS color).
 *   When provided, tokens get inline color styles from the theme.
 * @returns Rendered line output with CharacterMapping.
 */
export function renderViewLine(
  lineContent: string,
  tokens: IToken[] | null,
  tabSize: number = 4,
  bracketDepths?: ReadonlyMap<string, number>,
  lineNumber?: number,
): RenderLineOutput {
  const sb = new StringBuilder();
  const lineLength = lineContent.length;

  // If no tokens, render the whole line as plain text
  if (!tokens || tokens.length === 0) {
    return renderPlainLine(lineContent, sb, tabSize, bracketDepths, lineNumber);
  }

  // Build character mapping: for each output character, track original input offset
  // We allocate generously — output can be longer than input due to tab expansion
  const maxMappingLen = lineLength * tabSize + 1;
  const characterMapping = new Uint32Array(maxMappingLen);
  let mappingIndex = 0;

  // Walk tokens and render each segment
  let currentOutputIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const startOffset = token.startIndex;
    const endOffset = token.endIndex;

    if (startOffset > lineLength) break;

    // Get the text segment for this token
    const segmentEnd = Math.min(endOffset, lineLength);
    const segmentText = lineContent.substring(startOffset, segmentEnd);
    if (segmentText.length === 0) continue;

    // Base CSS class from token scope — prefer scope-based class, fall back to token type
    const baseClass = buildScopeClass(token) || buildTokenClasses(token);

    if (bracketDepths !== undefined && lineNumber !== undefined && bracketDepths.size > 0) {
      // Bracket depth colorization: render character-by-character with combined classes
      const bd = bracketDepths;
      const ln = lineNumber;
      let runStart = 0;
      let currentClasses = computeCombinedClass(baseClass, segmentText, 0, startOffset, ln, bd);

      for (let j = 1; j <= segmentText.length; j++) {
        const nextClasses =
          j < segmentText.length
            ? computeCombinedClass(baseClass, segmentText, j, startOffset, ln, bd)
            : null;

        if (nextClasses !== currentClasses) {
          // Emit the run [runStart, j)
          if (currentClasses) {
            sb.append(`<span class="${currentClasses}">`);
          }
          renderSegmentChars(
            segmentText,
            runStart,
            j,
            startOffset,
            sb,
            characterMapping,
            mappingIndex,
            currentOutputIndex,
            tabSize,
          );
          const emitted = countEmittedChars(segmentText, runStart, j, tabSize, currentOutputIndex);
          currentOutputIndex += emitted;
          mappingIndex += emitted;
          if (currentClasses) {
            sb.append("</span>");
          }

          runStart = j;
          currentClasses = nextClasses || "";
        }
      }
    } else {
      // No bracket depths: render whole token as a single span (existing behavior)
      if (baseClass) {
        sb.append(`<span class="${baseClass}">`);
      }

      for (let j = 0; j < segmentText.length; j++) {
        const ch = segmentText.charCodeAt(j);
        const inputOffset = startOffset + j;

        if (ch === 9 /* Tab */) {
          const spacesToNext = tabSize - (currentOutputIndex % tabSize);
          for (let s = 0; s < spacesToNext; s++) {
            characterMapping[mappingIndex++] = inputOffset;
          }
          currentOutputIndex += spacesToNext;
          sb.append(" ".repeat(spacesToNext));
        } else if (ch === 32 /* Space */) {
          characterMapping[mappingIndex++] = inputOffset;
          currentOutputIndex++;
          sb.append(" ");
        } else if (ch === 38 /* & */) {
          characterMapping[mappingIndex++] = inputOffset;
          currentOutputIndex++;
          sb.append("&amp;");
        } else if (ch === 60 /* < */) {
          characterMapping[mappingIndex++] = inputOffset;
          currentOutputIndex++;
          sb.append("&lt;");
        } else if (ch === 62 /* > */) {
          characterMapping[mappingIndex++] = inputOffset;
          currentOutputIndex++;
          sb.append("&gt;");
        } else {
          characterMapping[mappingIndex++] = inputOffset;
          currentOutputIndex++;
          sb.append(segmentText[j]);
        }
      }

      if (baseClass) {
        sb.append("</span>");
      }
    }
  }

  // Handle trailing characters beyond the last token (unlikely but safe)
  const lastTokenEnd = tokens.length > 0 ? tokens[tokens.length - 1].endIndex : 0;
  if (lastTokenEnd < lineLength) {
    // Check bracket depths for trailing characters too
    const remaining = lineContent.substring(lastTokenEnd);
    if (bracketDepths !== undefined && lineNumber !== undefined && bracketDepths.size > 0) {
      const bd = bracketDepths;
      const ln = lineNumber;
      let runStart = 0;
      let currentClasses = computeCombinedClass("", remaining, 0, lastTokenEnd, ln, bd);

      for (let j = 1; j <= remaining.length; j++) {
        const nextClasses =
          j < remaining.length
            ? computeCombinedClass("", remaining, j, lastTokenEnd, ln, bd)
            : null;

        if (nextClasses !== currentClasses) {
          if (currentClasses) {
            sb.append(`<span class="${currentClasses}">`);
          }
          const sub = remaining.substring(runStart, j);
          for (let k = 0; k < sub.length; k++) {
            characterMapping[mappingIndex++] = lastTokenEnd + runStart + k;
            sb.appendEscaped(sub[k]);
          }
          if (currentClasses) {
            sb.append("</span>");
          }

          runStart = j;
          currentClasses = nextClasses || "";
        }
      }
    } else {
      for (let j = 0; j < remaining.length; j++) {
        characterMapping[mappingIndex++] = lastTokenEnd + j;
        sb.appendEscaped(remaining[j]);
      }
    }
  }

  const result = {
    html: sb.build(),
    characterMapping: characterMapping.slice(0, mappingIndex),
    visibleColumnCount: currentOutputIndex,
  };

  return result;
}

/**
 * Map of TextMate scope names to CSS class names.
 *
 * Covers all scope prefixes produced by the full Microsoft JS/TS grammars:
 *   - keyword, storage, constant, variable, entity, support
 *   - string, comment (including line/block variants)
 *   - punctuation (brackets, commas, semicolons, dot accessor)
 *   - meta (block structure: function, class, import, export)
 *   - markup (markdown)
 *   - template.expression, invalid, support.class
 *
 * Dot-by-dot fallback in buildScopeClass() handles language-specific suffixes
 * (e.g., "keyword.control.js" falls back to "keyword.control" then to "keyword").
 */
const SCOPE_CLASSES: Record<string, string> = {
  // ── Keywords ──────────────────────────────────────────────────────
  keyword: "kw",
  new: "kw", // new.expr.js — the 'new' keyword
  "keyword.control": "kw",
  "keyword.control.import": "kw",
  "keyword.control.export": "kw",
  "keyword.control.flow": "kw",
  "keyword.control.loop": "kw",
  "keyword.control.conditional": "kw",
  "keyword.control.directive": "kw",
  "keyword.operator": "op",
  "keyword.operator.assignment": "op",
  "keyword.operator.comparison": "op",
  "keyword.operator.logical": "op",
  "keyword.operator.arithmetic": "op",
  "keyword.operator.bitwise": "op",
  "keyword.operator.ternary": "op",
  "keyword.operator.increment": "op",
  "keyword.operator.decrement": "op",
  "keyword.operator.spread": "op",
  "keyword.operator.rest": "op",
  "keyword.operator.expression.import": "kw",
  "keyword.operator.expression.export": "kw",
  "keyword.operator.new": "kw",
  "keyword.operator.delete": "kw",
  "keyword.other": "kw",

  // ── Storage / Type ────────────────────────────────────────────────
  storage: "type",
  "storage.type": "type",
  "storage.modifier": "kw",

  // ── Constants / Literals ──────────────────────────────────────────
  constant: "num",
  "constant.numeric": "num",
  "constant.numeric.integer": "num",
  "constant.numeric.float": "num",
  "constant.numeric.hex": "num",
  "constant.language": "kw",
  "constant.character": "str",
  "constant.character.escape": "str",
  "constant.other": "num",
  "constant.other.object.key": "var",

  // ── Variables ─────────────────────────────────────────────────────
  variable: "var",
  "variable.other": "var",
  "variable.other.enummember": "lbl",
  "variable.other.object": "var",
  "variable.other.property": "var",
  "variable.language": "kw",
  "variable.language.this": "kw",
  "variable.language.super": "kw",
  "variable.parameter": "var",

  // ── Entities (names) ──────────────────────────────────────────────
  entity: "ent",
  "entity.name": "ent",
  "entity.name.function": "fun",
  "entity.name.type": "type",
  "entity.name.type.class": "type",
  "entity.name.type.interface": "type",
  "entity.name.type.alias": "type",
  "entity.name.type.module": "type",
  "entity.name.type.enum": "type",
  "entity.name.tag": "tag",
  "entity.name.tag.jsx": "tag",
  "entity.other": "atr",
  "entity.other.attribute-name": "atr",

  // ── Support (built-in) ────────────────────────────────────────────
  support: "sup",
  "support.function": "fun",
  "support.type": "type",
  "support.class": "scl",
  "support.constant": "num",
  "support.variable": "var",

  // ── Strings ───────────────────────────────────────────────────────
  string: "str",
  "string.quoted": "str",
  "string.quoted.double": "str",
  "string.quoted.single": "str",
  "string.quoted.template": "str",
  "string.template": "str",
  "string.regexp": "rgx",
  "string.other": "str",

  // ── Comments ──────────────────────────────────────────────────────
  comment: "cmt",
  "comment.line": "cmt",
  "comment.line.double-slash": "cmt",
  "comment.block": "cmt",
  "comment.block.documentation": "cmt",
  "comment.block.json": "cmt",
  "comment.line.double-slash.json": "cmt",

  // ── Punctuation ───────────────────────────────────────────────────
  punctuation: "pun",
  "punctuation.definition": "pun",
  "punctuation.definition.block": "pun",
  "punctuation.definition.block.tag": "type", // @param, @returns, @type in JSDoc
  "punctuation.definition.parameters": "pun",
  "punctuation.definition.bracket": "pun",
  "punctuation.definition.string": "str",
  "punctuation.definition.string.begin": "str",
  "punctuation.definition.string.end": "str",
  "punctuation.definition.template-expression": "pun",
  "punctuation.definition.tag": "pun",
  "punctuation.definition.comment": "cmt",
  "punctuation.definition.inline.tag": "type", // @link, @code inside { } in JSDoc
  "punctuation.definition.type": "pun",
  "punctuation.definition.dictionary": "pun",
  "punctuation.definition.dictionary.begin": "pun",
  "punctuation.definition.dictionary.end": "pun",
  "punctuation.definition.array": "pun",
  "punctuation.definition.array.begin": "pun",
  "punctuation.definition.array.end": "pun",
  "punctuation.separator": "pun",
  "punctuation.separator.comma": "pun",
  "punctuation.separator.semicolon": "pun",
  "punctuation.separator.colon": "pun",
  "punctuation.separator.dictionary": "pun",
  "punctuation.separator.dictionary.key-value": "pun",
  "punctuation.separator.period": "pun",
  "punctuation.accessor": "pun",
  "punctuation.terminator": "pun",

  // ── Meta (structural) ────────────────────────────────────────────
  meta: "",
  "case-clause": "", // case-clause.expr.js — switch/case structural
  "switch-block": "", // switch-block.expr.js — structural
  "switch-expression": "", // switch-expression.expr.js — structural
  "switch-statement": "", // switch-statement.expr.js — structural
  "meta.tag": "",
  "meta.example": "cmt", // @example inside doc comments
  "meta.tag.jsx": "",
  "meta.function": "",
  "meta.block": "",
  "meta.class": "",
  "meta.object-literal": "",
  "meta.import": "",
  "meta.export": "",
  "meta.var": "",
  "meta.var.expr": "",
  "meta.arguments": "",
  "meta.brace": "",
  "meta.brace.round": "",
  "meta.brace.square": "",
  "meta.brace.curly": "",
  "meta.parameters": "",
  "meta.type.annotation": "",
  "meta.type.declaration": "",
  "meta.arrow": "",
  "meta.method": "",
  "meta.property": "",
  "meta.object": "",
  "meta.embedded.block": "",
  "meta.embedded": "",
  "meta.embedded.json": "",
  "meta.jsx": "",
  "meta.jsx.children": "",

  // ── JSON-specific meta (structural) ───────────────────────────────
  "meta.structure.array": "",
  "meta.structure.dictionary": "",
  "meta.structure.dictionary.key": "atr", // JSON object keys
  "meta.structure.dictionary.value": "",
  "meta.structure.dictionary.key.json": "atr",
  "meta.map.key": "atr", // YAML mapping keys

  // ── Source embedded (inside comment @example blocks) ─────────────
  "source.embedded": "cmt",

  // ── Template expressions ──────────────────────────────────────────
  "template.expression": "te",

  // ── Invalid ───────────────────────────────────────────────────────
  invalid: "inv",
  "invalid.deprecated": "inv",
  "invalid.illegal": "inv",
  "invalid.illegal.expected-array-close": "inv",
  "invalid.illegal.expected-dictionary-close": "inv",

  // ── Markup (Markdown) ─────────────────────────────────────────────
  markup: "mup",
  "markup.heading": "mh",
  "markup.bold": "mb",
  "markup.italic": "mi",
  "markup.underline.link": "ml",
  "markup.raw": "mup",
  "markup.raw.inline": "mup",
  "markup.list": "mup",
  "markup.quote": "mup",
  "markup.code": "mup",
  "markup.inline.raw": "mup",
  "markup.fenced_code": "mup",
};

/**
 * Build CSS class from a token's TextMate scope name with dot-by-dot fallback.
 *
 * Tries the full scope first (e.g. "entity.name.function.js"), then shorter
 * prefixes ("entity.name.function", "entity.name", "entity"), and finally
 * falls back to empty string (no color).
 *
 * Returns empty string if the scope is unknown or has no color mapping.
 */
function buildScopeClass(token: IToken): string {
  const scope = token.scope;
  if (!scope) return "";

  // Walk from full scope to shorter prefixes: dot-by-dot
  // e.g., "entity.name.function.js" → try each prefix
  let prefix = scope;
  while (prefix.length > 0) {
    const cls = SCOPE_CLASSES[prefix];
    if (cls !== undefined) {
      return cls ? `s-${cls}` : "";
    }
    // Remove one segment from the right
    const lastDot = prefix.lastIndexOf(".");
    if (lastDot < 0) break;
    prefix = prefix.substring(0, lastDot);
  }

  return "";
}

/**
 * Build CSS class string for a token based on StandardTokenType.
 */
function buildTokenClasses(token: IToken): string {
  const parts: string[] = [];

  const tokenClass = TOKEN_CLASSES[token.tokenType];
  if (tokenClass) parts.push(tokenClass);

  const fontClass = FONT_STYLE_CLASSES[token.fontStyle];
  if (fontClass) parts.push(fontClass);

  return parts.length > 0 ? parts.join(" ") : "";
}

/**
 * Render a line with no tokenization (plain text).
 */
function renderPlainLine(
  lineContent: string,
  sb: StringBuilder,
  tabSize: number,
  bracketDepths?: ReadonlyMap<string, number>,
  lineNumber?: number,
): RenderLineOutput {
  const maxMappingLen = lineContent.length * tabSize + 1;
  const characterMapping = new Uint32Array(maxMappingLen);
  let mappingIndex = 0;
  let visibleColumns = 0;

  const hasBrackets =
    bracketDepths !== undefined && lineNumber !== undefined && bracketDepths.size > 0;

  if (hasBrackets) {
    // With bracket depths: render character by character with per-char span classes
    let runStart = 0;
    let currentClasses = computeCombinedClass("", lineContent, 0, 0, lineNumber!, bracketDepths!);

    for (let i = 1; i <= lineContent.length; i++) {
      const nextClasses =
        i < lineContent.length
          ? computeCombinedClass("", lineContent, i, 0, lineNumber!, bracketDepths!)
          : null;

      if (nextClasses !== currentClasses) {
        if (currentClasses) {
          sb.append(`<span class="${currentClasses}">`);
        }
        for (let j = runStart; j < i; j++) {
          const ch = lineContent.charCodeAt(j);
          if (ch === 9 /* Tab */) {
            const spacesToNext = tabSize - (visibleColumns % tabSize);
            for (let s = 0; s < spacesToNext; s++) {
              characterMapping[mappingIndex++] = j;
            }
            visibleColumns += spacesToNext;
            sb.append(" ".repeat(spacesToNext));
          } else {
            characterMapping[mappingIndex++] = j;
            visibleColumns++;
            sb.appendEscaped(lineContent[j]);
          }
        }
        if (currentClasses) {
          sb.append("</span>");
        }
        runStart = i;
        currentClasses = nextClasses || "";
      }
    }
  } else {
    // Without bracket depths: plain rendering as before
    for (let i = 0; i < lineContent.length; i++) {
      const ch = lineContent.charCodeAt(i);

      if (ch === 9 /* Tab */) {
        const spacesToNext = tabSize - (visibleColumns % tabSize);
        for (let s = 0; s < spacesToNext; s++) {
          characterMapping[mappingIndex++] = i;
        }
        visibleColumns += spacesToNext;
        sb.append(" ".repeat(spacesToNext));
      } else {
        characterMapping[mappingIndex++] = i;
        visibleColumns++;
        sb.appendEscaped(lineContent[i]);
      }
    }
  }

  return {
    html: sb.build(),
    characterMapping: characterMapping.slice(0, mappingIndex),
    visibleColumnCount: visibleColumns,
  };
}

// ── Bracket pair colorization helpers ────────────────────────────────

/**
 * Compute the combined CSS class for a character, including bracket depth class.
 *
 * @param baseClass - The token's base CSS class (e.g., "s-pun").
 * @param segmentText - The full text of the token segment.
 * @param charIndex - Index within segmentText.
 * @param lineNumber - The line number (for bracket depth lookup).
 * @param bracketDepths - Bracket depth map.
 * @returns Combined class string, or empty string if no class.
 */
/**
 * @param startOffset - The character offset of this segment within the full line.
 */
function computeCombinedClass(
  baseClass: string,
  segmentText: string,
  charIndex: number,
  startOffset: number,
  lineNumber: number,
  bracketDepths: ReadonlyMap<string, number>,
): string {
  const inputOffset = startOffset + charIndex;
  const depthKey = `${lineNumber}:${inputOffset}`;
  const depth = bracketDepths.get(depthKey);

  if (depth !== undefined) {
    const depthClass = `s-bracket-d${depth}`;
    if (baseClass) {
      // Put both classes on the same span. CSS cascade order ensures bracket
      // depth color wins (defined after scope classes in the stylesheet).
      return `${baseClass} ${depthClass}`;
    }
    return depthClass;
  }

  return baseClass;
}

/**
 * Count the number of output characters emitted for a range of input characters.
 * Accounts for tab expansion.
 */
function countEmittedChars(
  text: string,
  start: number,
  end: number,
  tabSize: number,
  currentOutputIndex: number,
): number {
  let outIdx = currentOutputIndex;
  let count = 0;
  for (let j = start; j < end; j++) {
    const ch = text.charCodeAt(j);
    if (ch === 9 /* Tab */) {
      const spacesToNext = tabSize - (outIdx % tabSize);
      count += spacesToNext;
      outIdx += spacesToNext;
    } else {
      count++;
      outIdx++;
    }
  }
  return count;
}

/**
 * Render a range of characters from the segment into the StringBuilder.
 * Handles tab expansion, HTML escaping, and character mapping.
 *
 * NOTE: This function only appends to the StringBuilder and fills in the
 * characterMapping. The caller is responsible for accounting for the emitted
 * count in `currentOutputIndex` and `mappingIndex`.
 */
function renderSegmentChars(
  text: string,
  start: number,
  end: number,
  startOffset: number,
  sb: StringBuilder,
  characterMapping: Uint32Array,
  mappingIndexOffset: number,
  currentOutputIndex: number,
  tabSize: number,
): void {
  let mi = mappingIndexOffset;
  let outIdx = currentOutputIndex;

  for (let j = start; j < end; j++) {
    const ch = text.charCodeAt(j);
    const inputOffset = startOffset + j;

    if (ch === 9 /* Tab */) {
      const spacesToNext = tabSize - (outIdx % tabSize);
      for (let s = 0; s < spacesToNext; s++) {
        characterMapping[mi++] = inputOffset;
      }
      outIdx += spacesToNext;
      sb.append(" ".repeat(spacesToNext));
    } else if (ch === 32 /* Space */) {
      characterMapping[mi++] = inputOffset;
      outIdx++;
      sb.append(" ");
    } else if (ch === 38 /* & */) {
      characterMapping[mi++] = inputOffset;
      outIdx++;
      sb.append("&amp;");
    } else if (ch === 60 /* < */) {
      characterMapping[mi++] = inputOffset;
      outIdx++;
      sb.append("&lt;");
    } else if (ch === 62 /* > */) {
      characterMapping[mi++] = inputOffset;
      outIdx++;
      sb.append("&gt;");
    } else {
      characterMapping[mi++] = inputOffset;
      outIdx++;
      sb.append(text[j]);
    }
  }
}
