/**
 * drag.ts — the extension drag & drop contract.
 *
 * Extensions declare these (via `registerDragDecls`, captured under the
 * extension scope like renderers/processes):
 *
 *   - **kinds**       — payload kinds of its own, each with a JSON Schema of
 *                       string fields, named `<extensionId>/<id>`.
 *   - **sources**     — "I emit payloads of kind X". Elements in the surface
 *                       template carry `data-drag-source-id` plus the
 *                       attributes named in `attrs`; the platform owns the
 *                       gesture and builds the payload from those attributes.
 *   - **consumers**   — "I can *open* kind X as a tab". The platform resolves a
 *                       dropped kind to a consumer and opens it with the
 *                       payload's fields (not its `kind`) as the tab's data
 *                       — its params, saved with it.
 *   - **dropTargets** — a running surface that receives kind X *in place* (no
 *                       tab opened). Each mount binds its receiver with
 *                       `host.drag.registerDropTarget`.
 *
 * Every payload kind is namespaced, `namespace/kind`. The platform's kinds
 * are a **closed set** under `openp41ge/` (adding one is a contract addition
 * here); an extension's kinds live under its own id, so they can't collide.
 * A source emits a platform kind or one its extension declares; consumers and
 * drop targets accept any kind, another extension's too. Compatibility is by
 * kind — extensions never reference one another by id.
 *
 * Surfaces are named by their qualified `kind:id` (e.g. `grid:chat`), the same
 * string as `SurfaceHost.surface`, because a grid and a sidebar surface of one
 * extension may share an id. Platform-registered declarations name a platform
 * app type instead.
 *
 * For any one kind a surface is either a consumer or a drop target, never both
 * (see `findConsumerDropTargetConflicts`); a drop the surface does not receive
 * falls through to the enclosing grid.
 */

import { z } from "zod";

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/** Window contexts a drag may land in — the same values as the window type. */
export const DRAG_CONTEXTS = ["workspace", "manager", "logs"] as const;
export type DragContext = (typeof DRAG_CONTEXTS)[number];

const required = z.string().min(1);
const optional = z.string().optional();

/** The namespace of the platform's own payload kinds. */
export const PLATFORM_DRAG_NAMESPACE = "openp41ge";

/** One strict object schema per platform payload kind. All fields are
 *  strings so a payload can be built from element attributes without
 *  coercion. */
const platformPayloadSchemas = [
  z.strictObject({
    kind: z.literal("openp41ge/file-path"),
    filePath: required,
    fileName: optional,
  }),
  z.strictObject({ kind: z.literal("openp41ge/log-stream"), system: required, label: optional }),
  z.strictObject({
    kind: z.literal("openp41ge/workspace-config"),
    path: required,
    name: optional,
  }),
  // `settingsId`: the extension whose config the platform's editor opens.
  z.strictObject({
    kind: z.literal("openp41ge/config-overrides"),
    settingsId: required,
    label: optional,
  }),
] as const;

const platformPayloadSchema = z.discriminatedUnion("kind", [...platformPayloadSchemas]);

/** A payload of one of the platform's kinds. */
export type PlatformDragPayload = z.infer<typeof platformPayloadSchema>;
export type PlatformDragKind = PlatformDragPayload["kind"];

/** The platform's kinds (a closed set). */
export const PLATFORM_DRAG_KINDS: readonly PlatformDragKind[] = platformPayloadSchemas.map(
  (s) => s.shape.kind.value,
);

/** What each platform kind is called (the settings show it). */
export const PLATFORM_DRAG_KIND_LABELS: Readonly<Record<PlatformDragKind, string>> = {
  "openp41ge/file-path": "File",
  "openp41ge/log-stream": "Log stream",
  "openp41ge/workspace-config": "Workspace",
  "openp41ge/config-overrides": "Settings",
};

/** A payload kind: `namespace/kind` (`openp41ge/file-path`, `<extensionId>/<id>`). */
export type DragKind = string;

/** A payload of a kind an extension declares: string fields, per its schema. */
export interface ExtensionDragPayload {
  readonly kind: DragKind;
  readonly [field: string]: string;
}

/** Any drag payload. */
export type DragPayload = PlatformDragPayload | ExtensionDragPayload;

/** `namespace/kind`: two non-empty parts without spaces. */
const kindNameSchema = z.string().regex(/^[^/\s]+\/[^/\s]+$/, {
  message: "must be a namespaced kind, e.g. 'openp41ge/file-path' or '<extensionId>/<kind>'",
});

/** The schema of an extension kind's fields: an object of string properties. */
export interface DragKindSchema {
  readonly type: "object";
  readonly properties: Readonly<
    Record<string, { readonly type: "string"; readonly description?: string }>
  >;
  /** Fields that must be present (and non-empty). */
  readonly required?: readonly string[];
}

/** A payload kind an extension declares (`registerDragDecls({ kinds })`). */
export interface DragKindDecl {
  /** The kind's id within the extension; its full name is `<extensionId>/<id>`. */
  readonly id: string;
  readonly label?: string;
  readonly schema: DragKindSchema;
}

/** A declared extension kind, by its full name. */
export interface DragKindDef {
  readonly name: DragKind;
  readonly label?: string;
  readonly schema: DragKindSchema;
}

const dragKindDeclSchema = z
  .strictObject({
    id: z.string().regex(/^[^/\s]+$/, { message: "must be a kind id without a namespace" }),
    label: optional,
    schema: z.strictObject({
      type: z.literal("object"),
      properties: z.record(
        z.string().min(1),
        z.strictObject({ type: z.literal("string"), description: optional }),
      ),
      required: z.array(z.string()).optional(),
    }),
  })
  .superRefine((decl, ctx) => {
    for (const field of decl.schema.required ?? []) {
      if (!(field in decl.schema.properties)) {
        ctx.addIssue({
          code: "custom",
          path: ["schema", "required"],
          message: `required field '${field}' is not a property`,
        });
      }
    }
    if ("kind" in decl.schema.properties) {
      ctx.addIssue({
        code: "custom",
        path: ["schema", "properties", "kind"],
        message: "'kind' is the payload's kind, not a field",
      });
    }
  });

/** Payload field names (excluding `kind`) per platform kind. */
const platformFields: ReadonlyMap<DragKind, { required: string[]; optional: string[] }> = new Map(
  platformPayloadSchemas.map((s) => {
    const fields = Object.entries(s.shape).filter(([name]) => name !== "kind");
    return [
      s.shape.kind.value,
      {
        required: fields.filter(([, f]) => !f.safeParse(undefined).success).map(([n]) => n),
        optional: fields.filter(([, f]) => f.safeParse(undefined).success).map(([n]) => n),
      },
    ];
  }),
);

/** The fields of `kind` (platform or one of `kinds`), or null when unknown. */
function fieldsOf(
  kind: DragKind,
  kinds: readonly DragKindDef[],
): { required: string[]; optional: string[] } | null {
  const platform = platformFields.get(kind);
  if (platform) return platform;
  const def = kinds.find((k) => k.name === kind);
  if (!def) return null;
  const required = [...(def.schema.required ?? [])];
  return {
    required,
    optional: Object.keys(def.schema.properties).filter((f) => !required.includes(f)),
  };
}

/**
 * Validate a payload against its kind: a platform kind's fixed schema, or the
 * schema of the declared extension kind in `kinds`. Throws (naming the
 * problem) when it does not conform or its kind is unknown; returns it.
 */
export function validateDragPayload(raw: unknown, kinds: readonly DragKindDef[] = []): DragPayload {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !kindNameSchema.safeParse(kind).success) {
    throw new Error(`invalid drag payload: kind '${String(kind)}' is not a namespaced kind`);
  }
  if (kind.startsWith(`${PLATFORM_DRAG_NAMESPACE}/`)) {
    if (!platformFields.has(kind)) throw new Error(`invalid drag payload: unknown kind '${kind}'`);
    const result = platformPayloadSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`invalid '${kind}' drag payload:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
  }
  const fields = fieldsOf(kind, kinds);
  if (!fields) throw new Error(`invalid drag payload: unknown kind '${kind}'`);
  const known = new Set([...fields.required, ...fields.optional]);
  const problems: string[] = [];
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (field === "kind") continue;
    if (!known.has(field)) problems.push(`'${field}' is not a field of '${kind}'`);
    else if (typeof value !== "string") problems.push(`'${field}' must be a string`);
  }
  for (const field of fields.required) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value !== "string" || value === "") problems.push(`'${field}' is required`);
  }
  if (problems.length > 0) {
    throw new Error(`invalid '${kind}' drag payload: ${problems.join("; ")}`);
  }
  return raw as ExtensionDragPayload;
}

// ─── Declarations ───────────────────────────────────────────────────────────

const acceptsSchema = z.array(kindNameSchema).min(1);
/** A qualified extension surface name, e.g. `grid:chat` / `sidebar:explorer`. */
const qualifiedSurfaceSchema = z.string().regex(/^(grid|sidebar):.+$/, {
  message: "must be a qualified surface name, e.g. 'grid:<id>' or 'sidebar:<id>'",
});

/** A source's structure; its kind and attrs are checked against the known
 *  kinds by `parseDragRegistrations`. */
export const dragSourceSchema = z.strictObject({
  id: required,
  label: required,
  kind: kindNameSchema,
  attrs: z.record(z.string(), required),
  contexts: z.array(z.enum(DRAG_CONTEXTS)).min(1),
  crossWindow: z.boolean().optional(),
});

export const dragConsumerSchema = z.strictObject({
  id: required,
  label: required.optional(),
  accepts: acceptsSchema,
  placement: z.array(z.enum(["grid", "sidebar"])).min(1),
  open: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("renderer-surface"), surface: qualifiedSurfaceSchema }),
    z.strictObject({ kind: z.literal("app"), appType: required }),
  ]),
});

export const dropTargetSchema = z.strictObject({
  id: required,
  surface: required,
  accepts: acceptsSchema,
});

/** An extension drop target must name one of its own qualified surfaces. */
const extensionDropTargetSchema = dropTargetSchema.extend({ surface: qualifiedSurfaceSchema });

/**
 * A draggable source. Elements carry `data-drag-source-id="<id>"` and the
 * attributes named in `attrs`.
 */
export interface DragSourceDecl {
  /** Referenced by `data-drag-source-id`. */
  readonly id: string;
  readonly label: string;
  /** The payload kind this source produces: a platform kind, or one its own
   *  extension declares (`<extensionId>/<id>`). */
  readonly kind: DragKind;
  /**
   * Payload field → element attribute name, e.g.
   * `{ filePath: "data-path", fileName: "data-name" }`. Every required field of
   * `kind` must be mapped; unknown fields are rejected.
   */
  readonly attrs: Readonly<Record<string, string>>;
  /** Window contexts the drag may land in. */
  readonly contexts: readonly DragContext[];
  /** Opt in to dragging out to other windows. */
  readonly crossWindow?: boolean;
}

/** A component that can OPEN a kind as a tab. */
export interface DragConsumerDecl {
  readonly id: string;
  /** What it is called where the user picks what opens a kind (else its id). */
  readonly label?: string;
  /** Kinds this component can open as a tab. */
  readonly accepts: readonly DragKind[];
  /** Where it can open: a grid cell and/or a sidebar tab. */
  readonly placement: readonly ("grid" | "sidebar")[];
  /** How the platform opens it. */
  readonly open:
    | { readonly kind: "renderer-surface"; readonly surface: string }
    | { readonly kind: "app"; readonly appType: string };
}

/** A running surface that receives a payload dropped onto it in place. */
export interface DropTargetDecl {
  /** Referenced by `data-drop-target-id`. */
  readonly id: string;
  /** The surface this target lives in: a qualified `kind:id` for an extension,
   *  or a platform app type for platform-registered targets. */
  readonly surface: string;
  /** Payload kinds this target accepts — not source ids. */
  readonly accepts: readonly DragKind[];
}

/** What `registerDragDecls` accepts. */
export interface DragRegistrations {
  readonly kinds?: readonly DragKindDecl[];
  readonly sources?: readonly DragSourceDecl[];
  readonly consumers?: readonly DragConsumerDecl[];
  readonly dropTargets?: readonly DropTargetDecl[];
}

/** All drag declarations captured for one extension (or the platform). */
export interface DragDecls {
  /** Kinds the extension declares, by full name. */
  readonly kinds: readonly DragKindDef[];
  readonly sources: readonly DragSourceDecl[];
  readonly consumers: readonly DragConsumerDecl[];
  readonly dropTargets: readonly DropTargetDecl[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

function parseDecl<T>(schema: z.ZodType<T>, what: string, decl: unknown): T {
  const result = schema.safeParse(decl);
  if (!result.success) {
    const id = (decl as { id?: unknown } | null)?.id;
    throw new Error(`invalid ${what} '${String(id)}':\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Check a source's kind is one it may emit and its attrs map that kind's fields. */
function checkSource(source: DragSourceDecl, ownerId: string, kinds: readonly DragKindDef[]): void {
  const fields = fieldsOf(source.kind, kinds);
  const mayEmit =
    source.kind.startsWith(`${PLATFORM_DRAG_NAMESPACE}/`) || source.kind.startsWith(`${ownerId}/`);
  if (!fields || !mayEmit) {
    throw new Error(
      `invalid drag source '${source.id}': it may emit a platform kind or one '${ownerId}' ` +
        `declares, not '${source.kind}'`,
    );
  }
  const known = new Set([...fields.required, ...fields.optional]);
  for (const key of Object.keys(source.attrs)) {
    if (!known.has(key)) {
      throw new Error(
        `invalid drag source '${source.id}': '${key}' is not a field of payload kind '${source.kind}'`,
      );
    }
  }
  for (const field of fields.required) {
    if (!(field in source.attrs)) {
      throw new Error(
        `invalid drag source '${source.id}': required field '${field}' of payload kind ` +
          `'${source.kind}' is not mapped`,
      );
    }
  }
}

/**
 * Validate an extension's registrations. Its kinds are named under `ownerId`;
 * a source may emit a platform kind or one of the extension's kinds (declared
 * here or in `declaredKinds`, its earlier registrations). Throws on the first
 * non-conforming declaration, naming it. Returns the parsed declarations.
 */
export function parseDragRegistrations(
  regs: DragRegistrations,
  ownerId: string,
  declaredKinds: readonly DragKindDef[] = [],
): DragDecls {
  if (ownerId === PLATFORM_DRAG_NAMESPACE && (regs.kinds?.length ?? 0) > 0) {
    throw new Error(`kinds in the '${PLATFORM_DRAG_NAMESPACE}' namespace are the platform's`);
  }
  const kinds: DragKindDef[] = (regs.kinds ?? []).map((d) => {
    const decl = parseDecl(dragKindDeclSchema, "drag kind", d);
    return {
      name: `${ownerId}/${decl.id}`,
      ...(decl.label !== undefined ? { label: decl.label } : {}),
      schema: decl.schema as DragKindSchema,
    };
  });
  const known = [...declaredKinds, ...kinds];
  const sources = (regs.sources ?? []).map((d) => {
    const source = parseDecl(dragSourceSchema, "drag source", d);
    checkSource(source, ownerId, known);
    return source;
  });
  return {
    kinds,
    sources,
    consumers: (regs.consumers ?? []).map((d) => parseDecl(dragConsumerSchema, "drag consumer", d)),
    dropTargets: (regs.dropTargets ?? []).map((d) =>
      parseDecl(extensionDropTargetSchema, "drop target", d),
    ),
  };
}

/** A surface that both consumes and receives the same kind. */
export interface DragConflict {
  readonly surface: string;
  readonly kind: DragKind;
  readonly consumerId: string;
  readonly dropTargetId: string;
}

/** The surface a consumer opens: its qualified surface or platform app type. */
function consumerSurface(c: DragConsumerDecl): string {
  return c.open.kind === "renderer-surface" ? c.open.surface : c.open.appType;
}

/**
 * Find surfaces that both consume (open as a tab) and receive (in place) the
 * same kind. Surfaces are compared as strings, so callers combining several
 * owners must pass globally-unique surface names (e.g. qualified by extension
 * id).
 */
export function findConsumerDropTargetConflicts(
  consumers: readonly DragConsumerDecl[],
  dropTargets: readonly DropTargetDecl[],
): DragConflict[] {
  const conflicts: DragConflict[] = [];
  for (const target of dropTargets) {
    for (const consumer of consumers) {
      if (consumerSurface(consumer) !== target.surface) continue;
      for (const kind of target.accepts) {
        if (consumer.accepts.includes(kind)) {
          conflicts.push({
            surface: target.surface,
            kind,
            consumerId: consumer.id,
            dropTargetId: target.id,
          });
        }
      }
    }
  }
  return conflicts;
}

/** Throw if any surface consumes and receives the same kind. */
export function assertNoConsumerDropTargetConflicts(
  consumers: readonly DragConsumerDecl[],
  dropTargets: readonly DropTargetDecl[],
): void {
  const conflicts = findConsumerDropTargetConflicts(consumers, dropTargets);
  if (conflicts.length === 0) return;
  const lines = conflicts.map(
    (c) =>
      `surface '${c.surface}' both consumes and receives '${c.kind}' ` +
      `(consumer '${c.consumerId}', drop target '${c.dropTargetId}')`,
  );
  throw new Error(`conflicting drag declarations:\n${lines.join("\n")}`);
}

/**
 * Check an extension's drop targets and renderer-surface consumers name only
 * surfaces the extension registered (`ownSurfaces`, qualified `kind:id`).
 * Called by the host once the extension's renderer entry has loaded, since
 * `registerRenderers` may run after `registerDragDecls`.
 */
export function validateDragDeclSurfaces(decls: DragDecls, ownSurfaces: readonly string[]): void {
  const own = new Set(ownSurfaces);
  for (const t of decls.dropTargets) {
    if (!own.has(t.surface)) {
      throw new Error(
        `drop target '${t.id}' names surface '${t.surface}', which this extension does not register`,
      );
    }
  }
  for (const c of decls.consumers) {
    if (c.open.kind === "renderer-surface" && !own.has(c.open.surface)) {
      throw new Error(
        `drag consumer '${c.id}' opens surface '${c.open.surface}', which this extension does not register`,
      );
    }
  }
}
