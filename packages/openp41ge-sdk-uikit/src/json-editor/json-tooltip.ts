/**
 * json-tooltip — derive schema tooltips for the JSON editor.
 *
 * Given the parsed JSON tree and a JSON Schema, we resolve the schema entry
 * for each object key so the editor can show the property's `description` on
 * hover. Pure module (no DOM) so it is trivially unit-testable.
 */

import type { JsonNode } from "./json-parse";

/** A JSON path segment: a string object key or an integer array index. */
export type PathSeg = string | number;
export type JsonPath = PathSeg[];

/**
 * Walk the parse tree and return the JSON path leading to the entry that
 * starts on `line` (0-based). For object members the path ends at the member's
 * key (so a key hover resolves to its own schema); for array elements the path
 * ends at the element index. Returns null when `line` is not the start of an
 * entry (e.g. a bare value line) or is out of the tree.
 */
export function pathForLine(node: JsonNode, line: number, path: JsonPath = []): JsonPath | null {
  if (node.type === "object" && node.members) {
    for (const m of node.members) {
      if (m.keyLine === line) return [...path, m.key];
      const r = pathForLine(m.value, line, [...path, m.key]);
      if (r) return r;
    }
  } else if (node.type === "array" && node.elements) {
    for (let i = 0; i < node.elements.length; i++) {
      const el = node.elements[i];
      if (el.line === line) return [...path, i];
      const r = pathForLine(el, line, [...path, i]);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Resolve the subschema at `path` inside `schema`, following JSON Schema's
 * `properties` for object keys and `items` for array elements. Dynamic keys
 * (e.g. `Record<string, T>` maps, like `providers.*`) fall back to the parent's
 * `additionalProperties` / `patternProperties`. Returns the subschema or null.
 */
export function schemaAtPath(schema: unknown, path: JsonPath): unknown {
  let s: unknown = schema;
  for (const seg of path) {
    if (s === null || typeof s !== "object") return null;
    const obj = s as Record<string, unknown>;
    if (typeof seg === "number") {
      const items = obj.items;
      if (Array.isArray(items)) s = items[seg];
      else s = items;
    } else {
      const props = obj.properties as Record<string, unknown> | undefined;
      s = props ? props[seg] : undefined;
      if (s === undefined) {
        const ap = obj.additionalProperties;
        if (ap && typeof ap === "object") s = ap;
        else if (ap === true) s = { type: undefined, description: undefined };
        else s = undefined;
      }
    }
    if (!s) return null;
  }
  return s;
}

/** Extract the tooltip text for a schema entry (its `description`). */
export function schemaDescription(schema: unknown): string | null {
  if (schema === null || typeof schema !== "object") return null;
  const d = (schema as Record<string, unknown>).description;
  return typeof d === "string" && d.trim() ? d : null;
}

/** The deepest schema description along `path`, falling back to each ancestor
 *  so a dynamic key (e.g. a `Record<string, string>` entry, or an arbitrary
 *  provider id) still yields a tooltip when its own schema has none. Returns
 *  the first description walking from the key back toward the root. */
export function schemaDescriptionForPath(schema: unknown, path: JsonPath): string | null {
  for (let i = path.length; i >= 0; i--) {
    const d = schemaDescription(schemaAtPath(schema, path.slice(0, i)));
    if (d) return d;
  }
  return null;
}

/** Ensure `schema` is an object (returns null otherwise). */
function asObj(schema: unknown): Record<string, unknown> | null {
  return schema !== null && typeof schema === "object" ? (schema as Record<string, unknown>) : null;
}

/** A compact, human-readable type label for a property sub-schema (e.g.
 *  `string[]`, `object`, `number`). Falls back to "any" when unknown. */
export function schemaTypeLabel(schema: unknown): string {
  const s = asObj(schema);
  if (!s) return "any";
  const t = s.type;
  if (Array.isArray(t)) {
    const ts = (t as unknown[]).filter((x) => x !== "null");
    return ts.length ? (ts as string[]).map((x) => String(x)).join("|") : "any";
  }
  if (typeof t === "string") {
    if (t === "array") {
      const item = asObj(s.items);
      return item && item.type === "string" ? "string[]" : "array";
    }
    return t;
  }
  return "any";
}

/** For an array schema whose items are objects with `properties`, produce a
 *  compact structure hint describing each item's keys and types — so the reader
 *  sees how a list entry should be shaped (e.g. a `models` entry). Returns null
 *  when the items have no describable shape. */
export function schemaItemHint(schema: unknown): string | null {
  const s = asObj(schema);
  if (!s || s.type !== "array") return null;
  const items = asObj(s.items);
  const props = items && (items.properties as Record<string, unknown> | undefined);
  if (!props || typeof props !== "object" || Object.keys(props).length === 0) return null;
  const parts = Object.entries(props).map(([k, v]) => `${k}: ${schemaTypeLabel(v)}`);
  return `Each item: { ${parts.join(", ")} }`;
}
