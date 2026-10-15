/**
 * form-model — the pure half of <json-form>.
 *
 * `formFields` turns a config's JSON Schema, the user's values (only what is
 * stored), the schema's defaults and the host's errors into field
 * descriptors: one per property, in schema order, with required settings
 * that have no default first. A map (an object whose keys are the user's:
 * `additionalProperties` a schema, no `properties`) has one entry per key,
 * its defaults' and the user's merged (as the platform merges them); a
 * string with `"x-keysOf": "<sibling map>"` offers that map's keys; an enum's
 * `"x-enumLabels"` name its values; properties next to each other with the
 * same `"x-group"` are shown under that heading. `setFieldValue` / `resetField` turn an edit
 * into the new user values. No DOM; the element only renders descriptors.
 *
 * Paths are `JsonPath`s; their string form (`key`) is `pathKey`'s
 * (`a.b[0].c`), the form errors use.
 */

import { cloneDeep, getAt, pathKey, type JsonPath } from "../json-editor/json-tree";

/** A problem to show beside a field: `path` is `pathKey`-style (`a.b[0]`). */
export interface JsonFormError {
  readonly path: string;
  readonly message: string;
}

export type FieldKind =
  | "boolean"
  | "number"
  | "enum"
  | "string"
  | "secret"
  | "list"
  | "objects"
  | "group"
  | "map"
  | "unsupported";

/** The kind of a list's items. */
export interface ListItemKind {
  readonly kind: "string" | "number" | "boolean" | "enum";
  readonly integer: boolean;
  readonly options?: readonly unknown[];
}

export interface FormField {
  readonly kind: FieldKind;
  readonly path: JsonPath;
  /** `pathKey(path)`. */
  readonly key: string;
  /** The property's key. */
  readonly name: string;
  /** Its title, else its key. */
  readonly label: string;
  /** Its description (Markdown), or null. */
  readonly description: string | null;
  /** What the field shows: the user's value when set, else the default. */
  readonly value: unknown;
  /** The user has a value here (even one equal to the default). */
  readonly set: boolean;
  readonly hasDefault: boolean;
  /** Required by its object's schema. */
  readonly required: boolean;
  /** The host's error for this path, or null. */
  readonly error: string | null;
  /** number: whole numbers only. */
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  /** enum: the values offered. */
  readonly options?: readonly unknown[];
  /** enum: what each option is called (`x-enumLabels`, by position). */
  readonly optionLabels?: readonly string[];
  /** The heading it is shown under (`x-group`). */
  readonly group?: string;
  /** list: its items' kind. */
  readonly item?: ListItemKind;
  /** group: the object's fields. */
  readonly fields?: FormField[];
  /** objects: each item's fields. */
  readonly items?: FormField[][];
  /** string: `null` is a value (`type: ["string", "null"]`). */
  readonly nullable?: boolean;
  /** `readOnly` in its schema: shown, not edited (Reset still removes it). */
  readonly readOnly?: boolean;
  /** enum from `x-keysOf`: the sibling map it names. */
  readonly keysOf?: string;
  /** map: one field per key, named by it. */
  readonly entries?: FormField[];
  /** map: its values are objects with fields (else single values). */
  readonly objectValues?: boolean;
  /** map: the value a new entry starts with. */
  readonly newEntry?: unknown;
  /** map of objects: how many properties an entry has (a new entry's shape). */
  readonly entryProperties?: number;
  /** map: the keys its defaults have (they come back when removed). */
  readonly defaultKeys?: readonly string[];
  /** map: the entry a sibling `x-keysOf` setting names. */
  readonly marked?: { readonly key: unknown; readonly path: JsonPath; readonly label: string };
}

type Schema = Record<string, unknown>;

const asSchema = (s: unknown): Schema =>
  s !== null && typeof s === "object" && !Array.isArray(s) ? (s as Schema) : {};

const hasProperties = (s: Schema): boolean =>
  s.properties !== null && typeof s.properties === "object";

/** The kind of an array's item schema, when the form edits it as a list. */
function listItemKind(items: Schema): ListItemKind | null {
  if (Array.isArray(items.enum)) return { kind: "enum", integer: false, options: items.enum };
  switch (items.type) {
    case "string":
      return { kind: "string", integer: false };
    case "number":
      return { kind: "number", integer: false };
    case "integer":
      return { kind: "number", integer: true };
    case "boolean":
      return { kind: "boolean", integer: false };
    default:
      return null;
  }
}

/** `["string", "null"]` is a string that may be null. */
const isNullableString = (s: Schema): boolean =>
  Array.isArray(s.type) &&
  s.type.length === 2 &&
  s.type.includes("string") &&
  s.type.includes("null");

/** An object whose keys are the user's: a value schema, no fixed properties. */
const isMap = (s: Schema): boolean =>
  s.type === "object" &&
  !hasProperties(s) &&
  s.additionalProperties !== null &&
  typeof s.additionalProperties === "object" &&
  !Array.isArray(s.additionalProperties);

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** `user` merged over `base`: objects merge, anything else replaces. */
function merged(base: unknown, user: unknown): unknown {
  if (user === undefined) return base;
  if (!isObject(base) || !isObject(user)) return user;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(user)) out[k] = merged(base[k], v);
  return out;
}

/** What a new entry of `s` starts as. */
function blankValue(s: Schema): unknown {
  if (Array.isArray(s.enum)) return s.enum[0] ?? null;
  if (isNullableString(s)) return "";
  switch (s.type) {
    case "object":
      return {};
    case "array":
      return [];
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function fieldKind(s: Schema): FieldKind {
  if (Array.isArray(s.enum)) return "enum";
  if (typeof s["x-keysOf"] === "string" && (s.type === "string" || isNullableString(s))) {
    return "enum";
  }
  if (isNullableString(s)) return s.secret === true ? "secret" : "string";
  if (isMap(s)) return "map";
  switch (s.type) {
    case "boolean":
      return "boolean";
    case "number":
    case "integer":
      return "number";
    case "string":
      return s.secret === true ? "secret" : "string";
    case "array": {
      const items = asSchema(s.items);
      if (listItemKind(items)) return "list";
      if (items.type === "object" && hasProperties(items)) return "objects";
      return "unsupported";
    }
    case "object":
      return hasProperties(s) ? "group" : "unsupported";
    default:
      return "unsupported";
  }
}

interface Context {
  readonly user: unknown;
  readonly defaults: unknown;
  readonly errors: ReadonlyMap<string, string>;
}

/** The fields of an object schema's properties under `base`. `shown`, for an
 *  item of a list of objects, is that item's value (the list's items have no
 *  per-item defaults); otherwise values come from `ctx`. */
function objectFields(
  schema: Schema,
  base: JsonPath,
  ctx: Context,
  shown?: { item: unknown; set: boolean },
): FormField[] {
  const properties = asSchema(schema.properties) as Record<string, unknown>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const built = Object.entries(properties).map(([name, sub]) =>
    field(name, asSchema(sub), [...base, name], required.has(name), ctx, shown),
  );
  // x-keysOf: the setting offers its sibling map's keys; the map marks the
  // entry it names.
  const fields = built.map((f): FormField => {
    const keysOf = f.keysOf;
    const map = built.find((m) => m.kind === "map" && m.name === keysOf);
    if (keysOf !== undefined) {
      const keys = map && isObject(map.value) ? Object.keys(map.value) : [];
      const extra = typeof f.value === "string" && !keys.includes(f.value) ? [f.value] : [];
      return { ...f, options: [...keys, ...extra] };
    }
    const marker = built.find((k) => k.keysOf === f.name);
    return f.kind === "map" && marker
      ? { ...f, marked: { key: marker.value, path: marker.path, label: marker.label } }
      : f;
  });
  // Required settings the user must provide (no default) come first.
  const first = (f: FormField) => f.required && !f.hasDefault;
  return [...fields.filter(first), ...fields.filter((f) => !first(f))];
}

function field(
  name: string,
  s: Schema,
  path: JsonPath,
  required: boolean,
  ctx: Context,
  shown?: { item: unknown; set: boolean },
): FormField {
  const kind = fieldKind(s);
  const key = pathKey(path);
  const userValue = shown ? getAt(shown.item, [name]) : getAt(ctx.user, path);
  const set = shown ? shown.set && userValue !== undefined : userValue !== undefined;
  const defaultValue = shown ? undefined : getAt(ctx.defaults, path);
  const hasDefault = s.default !== undefined || defaultValue !== undefined;
  const value =
    kind === "map"
      ? merged(defaultValue, userValue)
      : shown
        ? userValue
        : set
          ? userValue
          : defaultValue;
  const base: FormField = {
    kind,
    path,
    key,
    name,
    label: typeof s.title === "string" && s.title ? s.title : name,
    description: typeof s.description === "string" ? s.description : null,
    value,
    set,
    hasDefault,
    required,
    error: ctx.errors.get(key) ?? null,
    ...(isNullableString(s) ? { nullable: true } : {}),
    ...(s.readOnly === true ? { readOnly: true } : {}),
    ...(typeof s["x-group"] === "string" ? { group: s["x-group"] } : {}),
  };
  switch (kind) {
    case "number":
      return {
        ...base,
        integer: s.type === "integer",
        ...(typeof s.minimum === "number" ? { minimum: s.minimum } : {}),
        ...(typeof s.maximum === "number" ? { maximum: s.maximum } : {}),
      };
    case "enum":
      return typeof s["x-keysOf"] === "string" && !Array.isArray(s.enum)
        ? { ...base, keysOf: s["x-keysOf"], options: [] }
        : {
            ...base,
            options: s.enum as unknown[],
            ...(Array.isArray(s["x-enumLabels"])
              ? { optionLabels: (s["x-enumLabels"] as unknown[]).map(String) }
              : {}),
          };
    case "map": {
      const valueSchema = asSchema(s.additionalProperties);
      const entries = isObject(value) ? Object.keys(value) : [];
      return {
        ...base,
        objectValues: valueSchema.type === "object" && hasProperties(valueSchema),
        ...(hasProperties(valueSchema)
          ? { entryProperties: Object.keys(asSchema(valueSchema.properties)).length }
          : {}),
        newEntry: blankValue(valueSchema),
        defaultKeys: isObject(defaultValue) ? Object.keys(defaultValue) : [],
        // In a list item there are no per-entry defaults: the item's values
        // are what it shows.
        entries: entries.map((key) =>
          field(key, valueSchema, [...path, key], false, ctx, shown && { item: value, set }),
        ),
      };
    }
    case "list":
      return { ...base, item: listItemKind(asSchema(s.items))! };
    case "group":
      return { ...base, fields: objectFields(s, path, ctx, shown && { item: userValue, set }) };
    case "objects": {
      const list = Array.isArray(value) ? value : [];
      const itemSchema = asSchema(s.items);
      return {
        ...base,
        items: list.map((item, i) => objectFields(itemSchema, [...path, i], ctx, { item, set })),
      };
    }
    default:
      return base;
  }
}

/**
 * The form's fields for an object `schema`: `value` is the user's values,
 * `defaults` the schema's defaults (as `configDefaults` computes them),
 * `errors` the host's problems by path.
 */
export function formFields(
  schema: unknown,
  value: unknown,
  defaults: unknown,
  errors: readonly JsonFormError[] = [],
): FormField[] {
  return objectFields(asSchema(schema), [], {
    user: value ?? {},
    defaults: defaults ?? {},
    errors: new Map(errors.map((e) => [e.path, e.message])),
  });
}

/**
 * The user's values with `path` set to `newValue` (a new value; the given one
 * is unchanged). Objects on the path are created. A list on the path the user
 * has not set is first set to its default, so editing one item keeps the
 * others.
 */
export function setFieldValue(
  user: unknown,
  defaults: unknown,
  path: JsonPath,
  newValue: unknown,
): Record<string, unknown> {
  const out = isObject(user) ? cloneDeep(user) : {};
  let cur: Record<string, unknown> | unknown[] = out;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const nextIsIndex = typeof path[i + 1] === "number";
    let next = (cur as Record<string | number, unknown>)[seg];
    if (nextIsIndex && !Array.isArray(next)) {
      const fallback = getAt(defaults, path.slice(0, i + 1));
      next = Array.isArray(fallback) ? cloneDeep(fallback) : [];
    } else if (!nextIsIndex && !isObject(next)) {
      next = {};
    }
    (cur as Record<string | number, unknown>)[seg] = next;
    cur = next as Record<string, unknown> | unknown[];
  }
  (cur as Record<string | number, unknown>)[path[path.length - 1]] = newValue;
  return out;
}

/**
 * The user's values without `path` (the default applies again). Objects left
 * empty on the path are removed too, except a map's entries (`maps`: the
 * paths of the maps); list items are not removed (a list item is removed
 * with the list's own Remove).
 */
export function resetField(
  user: unknown,
  path: JsonPath,
  maps: readonly JsonPath[] = [],
): Record<string, unknown> {
  const mapKeys = new Set(maps.map(pathKey));
  const out = isObject(user) ? cloneDeep(user) : {};
  if (getAt(out, path) === undefined) return out;
  const parents: Array<Record<string, unknown> | unknown[]> = [out];
  for (const seg of path.slice(0, -1)) {
    parents.push((parents[parents.length - 1] as Record<string | number, unknown>)[seg] as never);
  }
  for (let i = path.length - 1; i >= 0; i--) {
    const parent = parents[i];
    const seg = path[i];
    if (Array.isArray(parent)) {
      if (i === path.length - 1) parent.splice(seg as number, 1);
      break;
    }
    if (i < path.length - 1) {
      const child = parent[seg as string];
      if (!isObject(child) || Object.keys(child).length > 0) break;
      if (mapKeys.has(pathKey(path.slice(0, i)))) break;
    }
    delete parent[seg as string];
  }
  return out;
}
