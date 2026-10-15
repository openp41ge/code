/**
 * drag-consumer-registry.ts — consumer resolution for typed drag payloads.
 *
 * A consumer is "a component that can OPEN kind X as a tab". When a payload is
 * dropped on a grid the platform resolves its kind to ONE consumer:
 *
 *   1. the user-config override (`dragConsumers: { [kind]: consumerId }`), if
 *      it names a registered consumer that accepts the kind and placement;
 *   2. otherwise the first registered consumer. Platform consumers register
 *      at bootstrap, before any extension, so they are the default; replacing
 *      one requires the override. No load order between extensions is
 *      guaranteed, so when only extensions consume a kind the override is the
 *      way to pick one.
 *
 * Extension consumer ids are qualified `<extensionId>/<id>` so the override can
 * name them unambiguously; platform consumer ids are bare.
 */

import { qualifyName, type DragConsumerDecl, type DragKind, type DragPayload } from "openp41ge-sdk";

/** A platform consumer: a declaration plus how its app reads the payload. */
export interface PlatformDragConsumer extends DragConsumerDecl {
  readonly open: { readonly kind: "app"; readonly appType: string };
  toTabConfig(payload: DragPayload): Record<string, unknown>;
}

/** What a resolved drop opens. */
export interface ResolvedConsumerOpen {
  readonly consumerId: string;
  readonly appType: string;
  readonly tabConfig: Record<string, unknown>;
}

export interface DragConsumerRegistryOptions {
  /** The current user override map (`dragConsumers` config). */
  readonly getOverrides: () => Readonly<Record<string, string>>;
  readonly log: { warn(message: string, ...args: unknown[]): void };
}

interface Entry {
  readonly ownerId: string | null; // null = platform
  readonly qualifiedId: string;
  readonly decl: DragConsumerDecl;
  readonly toTabConfig?: (payload: DragPayload) => Record<string, unknown>;
}

type Placement = "grid" | "sidebar";

export class DragConsumerRegistry {
  private _entries: Entry[] = [];
  private _listeners = new Set<() => void>();

  constructor(private readonly _opts: DragConsumerRegistryOptions) {}

  registerPlatform(consumers: readonly PlatformDragConsumer[]): void {
    for (const c of consumers) {
      this._entries.push({ ownerId: null, qualifiedId: c.id, decl: c, toTabConfig: c.toTabConfig });
    }
  }

  /** Register (or replace, on reload) an extension's consumers. */
  registerExtension(extensionId: string, consumers: readonly DragConsumerDecl[]): void {
    this.unregister(extensionId);
    for (const c of consumers) {
      this._entries.push({
        ownerId: extensionId,
        qualifiedId: qualifyName(extensionId, c.id),
        decl: c,
      });
    }
    this._changed();
  }

  unregister(extensionId: string): void {
    const before = this._entries.length;
    this._entries = this._entries.filter((e) => e.ownerId !== extensionId);
    if (this._entries.length !== before) this._changed();
  }

  /** Each kind a grid drop can open, with the ids of the consumers that can
   *  open it (first registered first: the first is the default), in the
   *  order the kinds were first registered. The user's override picks one. */
  choices(): ReadonlyMap<DragKind, readonly string[]> {
    const out = new Map<DragKind, string[]>();
    for (const e of this._entries) {
      for (const kind of e.decl.accepts) {
        if (!this._canOpen(e, kind, "grid")) continue;
        const ids = out.get(kind) ?? [];
        if (!ids.includes(e.qualifiedId)) ids.push(e.qualifiedId);
        out.set(kind, ids);
      }
    }
    return out;
  }

  /** Call `fn` when an extension's consumers are registered or removed.
   *  Returns unsubscribe function. */
  onChange(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _changed(): void {
    for (const fn of this._listeners) fn();
  }

  /** Resolve a payload to what opens it at `placement`, or null. */
  resolve(payload: DragPayload, placement: Placement): ResolvedConsumerOpen | null {
    const candidates = this._entries.filter((e) => this._canOpen(e, payload.kind, placement));
    const overrideId = this._opts.getOverrides()[payload.kind];
    let entry = candidates[0];
    if (overrideId) {
      const chosen = candidates.find((e) => e.qualifiedId === overrideId);
      if (chosen) entry = chosen;
      else {
        this._opts.log.warn(
          `drag consumer override '${overrideId}' for '${payload.kind}' does not match a ` +
            `registered consumer that can open it; using '${entry?.qualifiedId ?? "none"}'`,
        );
      }
    }
    if (!entry) return null;
    return {
      consumerId: entry.qualifiedId,
      appType: this._appType(entry),
      tabConfig: entry.toTabConfig ? entry.toTabConfig(payload) : payloadFields(payload),
    };
  }

  /**
   * Every consumer with globally-unique surface names (extension surfaces
   * prefixed `<extensionId>/`), for the global consume/receive conflict check.
   */
  allForConflictCheck(): DragConsumerDecl[] {
    return this._entries.map((e) =>
      e.ownerId && e.decl.open.kind === "renderer-surface"
        ? {
            ...e.decl,
            open: { ...e.decl.open, surface: qualifyName(e.ownerId, e.decl.open.surface) },
          }
        : e.decl,
    );
  }

  private _canOpen(e: Entry, kind: DragKind, placement: Placement): boolean {
    if (!e.decl.accepts.includes(kind) || !e.decl.placement.includes(placement)) return false;
    // A renderer surface opens in its own placement only: a grid drop needs a
    // `grid:` surface (a sidebar surface is a system tab, not a grid app).
    if (e.decl.open.kind === "renderer-surface") {
      return e.decl.open.surface.startsWith(`${placement}:`);
    }
    return true;
  }

  private _appType(e: Entry): string {
    const open = e.decl.open;
    if (open.kind === "app") return open.appType;
    // Matches `deriveSurfaceCatalog`: `ext:<extensionId>:<surfaceId>`.
    const surfaceId = open.surface.slice(open.surface.indexOf(":") + 1);
    return `ext:${e.ownerId}:${surfaceId}`;
  }
}

/** A payload's fields, as an extension consumer's tab data: without its
 *  `kind` (the consumer accepts it) and without absent optionals. */
function payloadFields(payload: DragPayload): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "kind" && value !== undefined) fields[key] = value;
  }
  return fields;
}
