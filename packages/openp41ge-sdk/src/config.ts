/**
 * config.ts — the extension config contract (AGENTS.md §2.9).
 *
 * An extension registers ONE JSON Schema for its config section
 * (`registerConfigSchema`, from its renderer or backend entry). The platform
 * stores the user's values (only what they wrote), merges them over the
 * schema's `default`s, hands the merged values to both sides
 * (`host.config.get()`, `ctx.config.get()`), and edits them in its JSON editor.
 *
 * The schema is JSON Schema (draft 2020-12). The platform checks a subset —
 * `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`,
 * `minimum`, `maximum` — plus one of its own, `x-keysOf` (below) — and keeps
 * every other keyword (`title`, `description`, …) for the editor.
 *
 * `"x-keysOf": "<property>"` on a string property: its value must be one of
 * the keys of that sibling property's object (a map), e.g. a default
 * provider id naming one of `providers`. The form editor shows it as a menu
 * of those keys.
 */

/** The JSON types a config schema may name. */
const CONFIG_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"] as const;

export type ConfigType = (typeof CONFIG_TYPES)[number];

/** A JSON Schema for an extension's config section (or a part of it). */
export interface ConfigSchema {
  /** A JSON type, or a list of them (the value may be any). */
  readonly type?: ConfigType | readonly ConfigType[];
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, ConfigSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | ConfigSchema;
  readonly items?: ConfigSchema;
  readonly minimum?: number;
  readonly maximum?: number;
  /** A string's value must be a key of this sibling property's object. */
  readonly "x-keysOf"?: string;
  /** Other JSON Schema keywords are kept for the editor and not checked. */
  readonly [keyword: string]: unknown;
}

/** An extension's merged config: its schema's defaults plus the user's values. */
export type ExtensionConfig = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function at(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function prefix(path: string, message: string): string {
  return path ? `${path}: ${message}` : message;
}

/**
 * Check a registered schema. Returns it unchanged, or throws naming the first
 * problem: the root must be an object schema, every `type` a JSON type,
 * `properties`/`items`/`required` well formed, and every `default` valid
 * against its own schema.
 */
export function validateConfigSchema(schema: unknown): ConfigSchema {
  if (!isPlainObject(schema) || schema.type !== "object") {
    throw new Error('config schema: the root must be an object schema ({ type: "object" })');
  }
  checkSchema(schema, "");
  return schema as ConfigSchema;
}

function checkSchema(schema: Record<string, unknown>, path: string): void {
  const fail = (message: string): never => {
    throw new Error(`config schema: ${prefix(path, message)}`);
  };
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const unknown = types.find((t) => !CONFIG_TYPES.includes(t as ConfigType));
    if (unknown !== undefined || types.length === 0) {
      fail(`unknown type ${JSON.stringify(unknown)}`);
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) fail("properties must be an object");
    for (const [key, sub] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (!isPlainObject(sub)) fail(`${at(path, key)} must be a schema`);
      const keysOf = (sub as Record<string, unknown>)["x-keysOf"];
      if (
        keysOf !== undefined &&
        (typeof keysOf !== "string" || !(keysOf in (schema.properties as object)))
      ) {
        fail(`${at(path, key)}: x-keysOf must name a sibling property`);
      }
      checkSchema(sub as Record<string, unknown>, at(path, key));
    }
  }
  if (schema.items !== undefined) {
    if (!isPlainObject(schema.items)) fail("items must be a schema");
    checkSchema(schema.items as Record<string, unknown>, `${path}[]`);
  }
  if (isPlainObject(schema.additionalProperties)) {
    checkSchema(schema.additionalProperties, at(path, "*"));
  }
  if (
    schema.required !== undefined &&
    !(Array.isArray(schema.required) && schema.required.every((r) => typeof r === "string"))
  ) {
    fail("required must be a list of names");
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) fail("enum must be a list");
  if (schema.default !== undefined) {
    const errors = configErrors(schema as ConfigSchema, schema.default);
    if (errors.length > 0) fail(`default: ${errors[0]}`);
  }
}

/**
 * The defaults a schema gives: each property's `default`, and for an object
 * property without one, the defaults of its own properties (when any).
 * Returns fresh copies.
 */
export function configDefaults(schema: ConfigSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    if (sub.default !== undefined) {
      out[key] = clone(sub.default);
    } else if (sub.properties) {
      const nested = configDefaults(sub);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}

function typeMatches(type: ConfigType, value: unknown): boolean {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    default:
      return typeof value === type;
  }
}

/**
 * Check a value against a schema. Returns one message per problem, each
 * starting with the value's path (`endpoint.baseUrl: expected string`); empty
 * when the value is valid.
 */
export function configErrors(schema: ConfigSchema, value: unknown, path = ""): string[] {
  if (schema.type) {
    const types: readonly ConfigType[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) {
      return [prefix(path, `expected ${types.join(" or ")}`)];
    }
  }
  const errors: string[] = [];
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(
      prefix(path, `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`),
    );
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(prefix(path, `must be at least ${schema.minimum}`));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(prefix(path, `must be at most ${schema.maximum}`));
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...configErrors(schema.items!, item, `${path}[${i}]`)));
  }
  if (isPlainObject(value)) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (value[name] === undefined) errors.push(`${at(path, name)}: is required`);
    }
    for (const [key, item] of Object.entries(value)) {
      const sub = properties[key];
      if (sub) {
        errors.push(...configErrors(sub, item, at(path, key)));
      } else if (schema.additionalProperties === false) {
        errors.push(`${at(path, key)}: is not allowed`);
      } else if (isPlainObject(schema.additionalProperties)) {
        errors.push(...configErrors(schema.additionalProperties, item, at(path, key)));
      }
    }
    for (const [name, sub] of Object.entries(properties)) {
      const map = sub["x-keysOf"] === undefined ? undefined : value[sub["x-keysOf"]];
      const v = value[name];
      if (typeof v === "string" && isPlainObject(map) && !(v in map)) {
        const keys = Object.keys(map).map((k) => JSON.stringify(k));
        errors.push(
          `${at(path, name)}: must be one of the keys of ${sub["x-keysOf"]} (${keys.join(", ")})`,
        );
      }
    }
  }
  return errors;
}

/**
 * The merged config: `overrides` deep-merged over `defaults` (objects merge,
 * arrays and other values replace). Neither input is changed.
 */
export function mergeConfig(
  defaults: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out = clone(defaults) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    out[key] =
      isPlainObject(value) && isPlainObject(out[key])
        ? mergeConfig(out[key] as Record<string, unknown>, value)
        : clone(value);
  }
  return out;
}
