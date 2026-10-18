/**
 * open.ts — what the open palette (Cmd+N) can open, and who finds it.
 *
 *   - **Open kinds** — the kinds of things that open as a tab, each with a
 *     schema of its params. Named `namespace/kind` like drag kinds, but a
 *     separate vocabulary: the platform's are a closed set under `openp41ge/`
 *     (`PLATFORM_OPEN_KINDS`; adding one is a contract addition here), and an
 *     extension declares its own with `registerOpenKinds` (renderer entry),
 *     named `<extensionId>/<id>`.
 *   - **Surfaces say what they open.** A grid surface lists the kinds it opens
 *     (`GridSurfaceSpec.opens`); an item's params become the tab's params
 *     unchanged, so a kind's schema is the param contract of every surface
 *     that opens it. The palette offers each item in every tab type that opens
 *     its kind, and the user picks which.
 *   - **Search providers** — a backend registers `registerSearchProvider`; the
 *     palette asks each one for what matches the typed query. A provider's
 *     items may be of any kind (another extension's, or a platform one), and
 *     may be create actions, which the provider carries out when chosen.
 *
 * Extensions never reference one another by id: an item finds its tab types
 * by kind.
 */

import { z } from "zod";
import type { HandlerContext } from "./context";

/** An open kind's name: `namespace/kind`. */
export type OpenKind = string;

/** The type of one param. */
export type OpenParamType = "string" | "number" | "boolean";

/** The schema of a kind's params: an object of string, number or boolean properties. */
export interface OpenParamsSchema {
  readonly type: "object";
  readonly properties: Readonly<
    Record<string, { readonly type: OpenParamType; readonly description?: string }>
  >;
  /** Params that must be present (a string one non-empty). */
  readonly required?: readonly string[];
}

/** A kind an extension declares (`registerOpenKinds`). */
export interface OpenKindDecl {
  /** Its id within the extension; the full name is `<extensionId>/<id>`. */
  readonly id: string;
  /** What one of it is called ("Chat", "Repository"). */
  readonly label: string;
  readonly params: OpenParamsSchema;
}

/** A kind by its full name. */
export interface OpenKindDef {
  readonly name: OpenKind;
  readonly label: string;
  readonly params: OpenParamsSchema;
}

/** What `registerOpenKinds` accepts. */
export interface OpenRegistrations {
  readonly kinds: readonly OpenKindDecl[];
}

/** The namespace of the platform's open kinds. */
export const PLATFORM_OPEN_NAMESPACE = "openp41ge";

const str = { type: "string" } as const;

/** The platform's open kinds (a closed set). */
export const PLATFORM_OPEN_KINDS: readonly OpenKindDef[] = [
  {
    name: "openp41ge/file",
    label: "File",
    params: { type: "object", properties: { filePath: str }, required: ["filePath"] },
  },
  {
    name: "openp41ge/log-stream",
    label: "Log stream",
    params: { type: "object", properties: { system: str }, required: ["system"] },
  },
  {
    name: "openp41ge/settings",
    label: "Settings",
    // The extension whose settings open (the platform's are `openp41ge`).
    params: { type: "object", properties: { extensionId: str }, required: ["extensionId"] },
  },
  {
    name: "openp41ge/release",
    label: "Release",
    params: { type: "object", properties: { tag: str }, required: ["tag"] },
  },
  {
    name: "openp41ge/workspace",
    label: "Workspace",
    // `path`: the workspace file.
    params: { type: "object", properties: { path: str, name: str }, required: ["path"] },
  },
  {
    name: "openp41ge/command-run",
    label: "Command",
    // A scoped terminal for `binary` (commands.ts) in a worktree; with a
    // `runId` (and its `args`, a JSON array), showing that run.
    params: {
      type: "object",
      properties: { binary: str, repo: str, worktree: str, args: str, runId: str },
      required: ["binary"],
    },
  },
];

/** An item that opens: its kind, its params (the tab's), and how it is shown. */
export interface SearchOpenItem {
  readonly kind: OpenKind;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly title: string;
  /** Muted text after the title (a path, a repository…). */
  readonly description?: string;
  /** SVG markup (fill `currentColor`). */
  readonly icon?: string;
  /** The item's identity (a chat id): an open tab of the same type with the
   *  same key is focused instead of opening another. Also how the palette
   *  remembers it; without one, its params are. */
  readonly key?: string;
}

/** An item that creates something: choosing it calls the provider's `create`. */
export interface SearchCreateItem {
  /** Passed back to `create`: which create action this is. */
  readonly create: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
}

export type SearchItem = SearchOpenItem | SearchCreateItem;

/**
 * Finds things to open for the palette. Registered by a backend entry
 * (`registerSearchProvider`); it runs in the main process, with the calling
 * window's context (its workspace).
 */
export interface SearchProvider {
  /** Unique within the extension. */
  readonly id: string;
  /**
   * The items matching `query` (all of them, or the most recent, for an empty
   * one). Return what could match: the palette ranks and filters by title, so
   * a provider may return more than is shown; keep it to about 50. A provider
   * that throws or takes longer than the platform waits is logged and skipped.
   */
  search(
    query: string,
    ctx: HandlerContext,
  ): readonly SearchItem[] | Promise<readonly SearchItem[]>;
  /**
   * Carry out the create item `create` (what the palette's query was is
   * `query`) and return the item to open, or null to open nothing.
   */
  create?(
    create: string,
    query: string,
    ctx: HandlerContext,
  ): SearchOpenItem | null | Promise<SearchOpenItem | null>;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const paramsSchemaSchema = z.strictObject({
  type: z.literal("object"),
  properties: z.record(
    z.string().min(1),
    z.strictObject({
      type: z.enum(["string", "number", "boolean"]),
      description: z.string().optional(),
    }),
  ),
  required: z.array(z.string()).optional(),
});

const openKindDeclSchema = z
  .strictObject({
    id: z.string().regex(/^[^/\s]+$/, { message: "must be a kind id without a namespace" }),
    label: z.string().min(1),
    params: paramsSchemaSchema,
  })
  .superRefine((decl, ctx) => {
    for (const p of decl.params.required ?? []) {
      if (!(p in decl.params.properties)) {
        ctx.addIssue({
          code: "custom",
          path: ["params", "required"],
          message: `required '${p}' is not a param`,
        });
      }
    }
  });

/** Validate `registerOpenKinds`' declarations and name them under `extensionId`. Throws. */
export function parseOpenKinds(regs: OpenRegistrations, extensionId: string): OpenKindDef[] {
  const result = z.array(openKindDeclSchema).safeParse(regs?.kinds);
  if (!result.success) {
    throw new Error(`invalid open kinds:\n${z.prettifyError(result.error)}`);
  }
  return result.data.map((d) => ({
    name: `${extensionId}/${d.id}`,
    label: d.label,
    params: d.params as OpenParamsSchema,
  }));
}

/** The kind named `kind`: a platform one, or one of `kinds`; null when unknown. */
export function findOpenKind(
  kind: OpenKind,
  kinds: readonly OpenKindDef[] = [],
): OpenKindDef | null {
  return (
    PLATFORM_OPEN_KINDS.find((k) => k.name === kind) ?? kinds.find((k) => k.name === kind) ?? null
  );
}

/**
 * Check `params` against `kind`'s schema (a platform kind, or one of
 * `kinds`). Throws, naming every problem, when they don't conform or the kind
 * is unknown.
 */
export function validateOpenParams(
  kind: OpenKind,
  params: unknown,
  kinds: readonly OpenKindDef[] = [],
): void {
  const def = findOpenKind(kind, kinds);
  if (!def) throw new Error(`unknown kind '${kind}'`);
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error(`'${kind}' params must be an object`);
  }
  const problems: string[] = [];
  const values = params as Record<string, unknown>;
  for (const [name, value] of Object.entries(values)) {
    const prop = def.params.properties[name];
    if (!prop) problems.push(`'${name}' is not a param of '${kind}'`);
    else if (typeof value !== prop.type) problems.push(`'${name}' must be a ${prop.type}`);
  }
  for (const name of def.params.required ?? []) {
    const value = values[name];
    if (value === undefined || value === "") problems.push(`'${name}' is required`);
  }
  if (problems.length > 0) throw new Error(`invalid '${kind}' params: ${problems.join("; ")}`);
}

const optionalText = z.string().optional();

const openItemSchema = z.strictObject({
  kind: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  title: z.string().min(1),
  description: optionalText,
  icon: optionalText,
  key: optionalText,
});

const createItemSchema = z.strictObject({
  create: z.string().min(1),
  title: z.string().min(1),
  description: optionalText,
  icon: optionalText,
});

/**
 * The valid items of a provider's `search` result (by shape, and an open
 * item's params by its kind: a platform one or one of `kinds`), and what was
 * wrong with the others.
 */
export function parseSearchItems(
  raw: unknown,
  kinds: readonly OpenKindDef[],
): { items: SearchItem[]; problems: string[] } {
  if (!Array.isArray(raw)) return { items: [], problems: ["search returned no list"] };
  const items: SearchItem[] = [];
  const problems: string[] = [];
  raw.forEach((value, i) => {
    const isCreate = typeof value === "object" && value !== null && "create" in value;
    const parsed = (isCreate ? createItemSchema : openItemSchema).safeParse(value);
    if (!parsed.success) {
      problems.push(`item ${i}: ${z.prettifyError(parsed.error)}`);
      return;
    }
    if (!isCreate) {
      const item = parsed.data as SearchOpenItem;
      try {
        validateOpenParams(item.kind, item.params, kinds);
      } catch (err) {
        problems.push(`item ${i}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    items.push(parsed.data as SearchItem);
  });
  return { items, problems };
}

/** How the palette remembers an item: its kind and key, else its kind and params. */
export function openItemKey(item: Pick<SearchOpenItem, "kind" | "params" | "key">): string {
  if (item.key) return `${item.kind}:${item.key}`;
  const sorted = Object.keys(item.params)
    .sort()
    .map((k) => [k, item.params[k]]);
  return `${item.kind}:${JSON.stringify(sorted)}`;
}
