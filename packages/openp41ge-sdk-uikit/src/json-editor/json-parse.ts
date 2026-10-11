/* eslint-disable max-classes-per-file */
/**
 * json-parse — a small recursive-descent JSON parser that tracks source
 * positions. It powers the editor's structure-aware features:
 *  - syntax-error line/column reporting (to red-flag the offending line),
 *  - code-folding ranges (object / array span),
 *  - click-to-select key / value token ranges.
 *
 * Pure module — no DOM, no platform dependencies.
 */

export interface JsonSourceLocation {
  offset: number;
  /** 0-based line index. */
  line: number;
  /** 0-based column index. */
  column: number;
}

export interface JsonError extends JsonSourceLocation {
  message: string;
}

export interface JsonObjectMember {
  /** The key text (unquoted). */
  key: string;
  /** Offset range of the key token (including the surrounding quotes). */
  keyStart: number;
  keyEnd: number;
  keyLine: number;
  value: JsonNode;
}

/** A JSON value node with its source span. */
export interface JsonNode {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  start: number;
  end: number;
  /** Line of the node's first character (0-based). */
  line: number;
  /** Line of the node's last character (0-based). */
  endLine: number;
  value?: unknown;
  /** Object members in source order. */
  members?: JsonObjectMember[];
  /** Array elements in source order. */
  elements?: JsonNode[];
}

export interface ParseResult {
  ok: boolean;
  value?: unknown;
  root?: JsonNode;
  error?: JsonError;
}

export class JsonParseError extends Error {
  offset: number;
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = "JsonParseError";
    this.offset = offset;
  }
}

class Parser {
  private readonly text: string;
  private readonly lineStarts: number[] = [0];
  private i = 0;

  constructor(text: string) {
    this.text = text;
    for (let k = 0; k < text.length; k++) {
      if (text[k] === "\n") this.lineStarts.push(k + 1);
    }
  }

  loc(offset: number): JsonSourceLocation {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { offset, line: lo, column: offset - this.lineStarts[lo] };
  }

  private error(message: string, offset: number = this.i): never {
    throw new JsonParseError(message, offset);
  }

  private skipWs(): void {
    while (this.i < this.text.length) {
      const c = this.text[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.i++;
      else break;
    }
  }

  parse(): JsonNode {
    this.skipWs();
    const node = this.parseValue();
    this.skipWs();
    if (this.i < this.text.length) {
      this.error(`Unexpected token '${this.text[this.i]}'`);
    }
    return node;
  }

  private node(type: JsonNode["type"], start: number, extra: Partial<JsonNode>): JsonNode {
    const startLoc = this.loc(start);
    const endLoc = this.loc(this.i);
    return { type, start, end: this.i, line: startLoc.line, endLine: endLoc.line, ...extra };
  }

  private parseValue(): JsonNode {
    if (this.i >= this.text.length) this.error("Unexpected end of JSON input");
    const c = this.text[this.i];
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
    if (this.text.startsWith("true", this.i)) return this.parseLiteral(true);
    if (this.text.startsWith("false", this.i)) return this.parseLiteral(false);
    if (this.text.startsWith("null", this.i)) return this.parseLiteral(null);
    this.error(`Unexpected token '${c}'`);
    throw new Error("unreachable");
  }

  private parseLiteral(value: true | false | null): JsonNode {
    const start = this.i;
    const word = value === null ? "null" : value ? "true" : "false";
    this.i += word.length;
    return this.node(value === null ? "null" : "boolean", start, { value });
  }

  private parseNumber(): JsonNode {
    const start = this.i;
    const re = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
    const m = re.exec(this.text.slice(start));
    if (!m) this.error("Invalid number", start);
    this.i = start + m![0].length;
    return this.node("number", start, { value: Number(m![0]) });
  }

  private parseString(): JsonNode {
    const start = this.i;
    this.i++; // opening quote
    let out = "";
    while (true) {
      if (this.i >= this.text.length) this.error("Unterminated string", start);
      const c = this.text[this.i];
      if (c === '"') {
        this.i++;
        break;
      }
      if (c === "\\") {
        this.i++;
        if (this.i >= this.text.length) this.error("Unterminated escape", start);
        const esc = this.text[this.i];
        switch (esc) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = this.text.slice(this.i + 1, this.i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error("Invalid unicode escape", this.i);
            out += String.fromCharCode(parseInt(hex, 16));
            this.i += 4;
            break;
          }
          default:
            this.error(`Invalid escape '\\${esc}'`, this.i);
        }
        this.i++;
        continue;
      }
      if (c === "\n" || c === "\r") this.error("Unterminated string", start);
      out += c;
      this.i++;
    }
    return this.node("string", start, { value: out });
  }

  private parseObject(): JsonNode {
    const start = this.i;
    this.i++; // {
    const members: NonNullable<JsonNode["members"]> = [];
    this.skipWs();
    if (this.text[this.i] === "}") {
      this.i++;
      return this.node("object", start, { value: {}, members });
    }
    while (true) {
      this.skipWs();
      if (this.text[this.i] !== '"') this.error("Expected object key", this.i);
      const keyNode = this.parseString();
      this.skipWs();
      if (this.text[this.i] !== ":") this.error("Expected ':' after key", this.i);
      this.i++;
      this.skipWs();
      const value = this.parseValue();
      members.push({
        key: String(keyNode.value),
        keyStart: keyNode.start,
        keyEnd: keyNode.end,
        keyLine: keyNode.line,
        value,
      });
      this.skipWs();
      const c = this.text[this.i];
      if (c === ",") {
        this.i++;
        this.skipWs();
        if (this.text[this.i] === "}") this.error("Trailing comma", this.i);
        continue;
      }
      if (c === "}") {
        this.i++;
        break;
      }
      if (c === "") this.error("Unexpected end of JSON input");
      this.error(`Expected ',' or '}', got '${c}'`, this.i);
    }
    const obj: Record<string, unknown> = {};
    for (const m of members) obj[m.key] = m.value.value;
    return this.node("object", start, { value: obj, members });
  }

  private parseArray(): JsonNode {
    const start = this.i;
    this.i++; // [
    const elements: JsonNode[] = [];
    this.skipWs();
    if (this.text[this.i] === "]") {
      this.i++;
      return this.node("array", start, { value: [], elements });
    }
    while (true) {
      this.skipWs();
      const value = this.parseValue();
      elements.push(value);
      this.skipWs();
      const c = this.text[this.i];
      if (c === ",") {
        this.i++;
        this.skipWs();
        if (this.text[this.i] === "]") this.error("Trailing comma", this.i);
        continue;
      }
      if (c === "]") {
        this.i++;
        break;
      }
      if (c === "") this.error("Unexpected end of JSON input");
      this.error(`Expected ',' or ']', got '${c}'`, this.i);
    }
    return this.node("array", start, {
      value: elements.map((e) => e.value),
      elements,
    });
  }
}

export function parseJson(text: string): ParseResult {
  try {
    const p = new Parser(text);
    const root = p.parse();
    return { ok: true, value: root.value, root };
  } catch (err) {
    if (err instanceof JsonParseError) {
      const loc = new Parser(text).loc(err.offset);
      return { ok: false, error: { ...loc, message: err.message } };
    }
    throw err;
  }
}
