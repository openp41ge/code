/**
 * form-model — the pure half of <json-form>.
 *
 * `formFields` turns a config's JSON Schema, the user's values (only what is
 * stored), the schema's defaults and the host's errors into field
 * descriptors: one per property, in schema order, with required settings
 * that have no default first. `setFieldValue` / `resetField` turn an edit
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
  /** list: its items' kind. */
  readonly item?: ListItemKind;
  /** group: the object's fields. */
  readonly fields?: FormField[];
  /** objects: each item's fields. */
  readonly items?: FormField[][];
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

function fieldKind(s: Schema): FieldKind {
  if (Array.isArray(s.enum)) return "enum";
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
  const fields = Object.entries(properties).map(([name, sub]) =>
    field(name, asSchema(sub), [...base, name], required.has(name), ctx, shown),
  );
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
  const value = shown ? userValue : set ? userValue : defaultValue;
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
      return { ...base, options: s.enum as unknown[] };
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

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

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
 * empty on the path are removed too; list items are not removed (a list item
 * is removed with the list's own Remove).
 */
export function resetField(user: unknown, path: JsonPath): Record<string, unknown> {
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
    }
    delete parent[seg as string];
  }
  return out;
}
