/**
 * extension-drag.ts — composition of the extension drag runtime for one
 * renderer window: the consumer registry (platform consumers registered
 * first), the drag service, and the grid payload resolver.
 *
 * Extensions load (bootstrap step 3) before the window kind is resolved and
 * before the drag pipeline exists, so the window context and pipeline are
 * installed later by `init` (from `StartupContext.wireServices`, next to
 * `initDragSystem`, which installs `resolveGridOpen` as the grid payload
 * resolver). Until then source drags are dropped silently.
 */

import { createLogger, type ILogger } from "openp41ge-core-logger";
import {
  assertNoConsumerDropTargetConflicts,
  parseDragRegistrations,
  PLATFORM_DRAG_KIND_LABELS,
  PLATFORM_DRAG_NAMESPACE,
  qualifyName,
  validateDragDeclSurfaces,
  type DragContext,
  type DragDecls,
  type DragPayload,
  type DragSourceDecl,
  type DropTargetDecl,
} from "openp41ge-sdk";
import type { PayloadDragData, PayloadOpen } from "../openp41ge-tabs-adapter";
import { DragConsumerRegistry, type DragKindChoice } from "./drag-consumer-registry";
import {
  RendererDragService,
  type PayloadDragPipeline,
  type SurfaceDragBinder,
} from "./extension-drag-service";
import { PLATFORM_DRAG_CONSUMERS } from "./platform-drag-consumers";

export interface ExtensionDragRuntimeOptions {
  readonly log: ILogger;
  /** The user's `dragConsumers` override map. */
  readonly getOverrides?: () => Readonly<Record<string, string>>;
}

export interface ExtensionDragInit {
  readonly windowContext: DragContext;
  readonly pipeline: PayloadDragPipeline;
  readonly getOverrides?: () => Readonly<Record<string, string>>;
}

export function createExtensionDragRuntime(opts: ExtensionDragRuntimeOptions) {
  let windowContext: DragContext = "workspace";
  let pipeline: PayloadDragPipeline | null = null;
  let getOverrides = opts.getOverrides ?? (() => ({}));
  /** The platform's own drag sources (`registerPlatformSources`). */
  let platformSources: DragSourceDecl[] = [];
  /** Every extension's drop targets, for the global conflict check. */
  const dropTargets = new Map<string, readonly DropTargetDecl[]>();

  const registry = new DragConsumerRegistry({ getOverrides: () => getOverrides(), log: opts.log });
  registry.registerPlatform(PLATFORM_DRAG_CONSUMERS);

  const service = new RendererDragService({
    getWindowContext: () => windowContext,
    pipeline: {
      startPayloadDrag: (req) => pipeline?.startPayloadDrag(req),
      engageDrag: (at) => pipeline?.engageDrag(at) ?? false,
    },
    log: opts.log,
  });

  function resolveGridOpen(data: PayloadDragData, _target: unknown): PayloadOpen | null {
    if (!data.contexts.includes(windowContext)) return null;
    const open = registry.resolve(data.payload as DragPayload, "grid");
    return open ? { appType: open.appType, tabConfig: open.tabConfig } : null;
  }

  function unregisterExtension(extensionId: string): void {
    registry.unregister(extensionId);
    service.unregisterDecls(extensionId);
    dropTargets.delete(extensionId);
  }

  return {
    registry,
    service,
    resolveGridOpen,

    /**
     * Install this window's context + pipeline. The grid resolver
     * (`resolveGridOpen`) is installed into the tabs library by
     * `initDragSystem`.
     */
    init(init: ExtensionDragInit): void {
      windowContext = init.windowContext;
      pipeline = init.pipeline;
      if (init.getOverrides) getOverrides = init.getOverrides;
    },

    /**
     * Register (or replace, on reload) an extension's drag declarations.
     * Checks they name only `ownSurfaces` (qualified `kind:id`) and that no
     * surface consumes and receives the same kind across all owners. Throws,
     * leaving the extension with no drag registrations, on any violation.
     */
    registerExtension(extensionId: string, decls: DragDecls, ownSurfaces: readonly string[]): void {
      unregisterExtension(extensionId);
      validateDragDeclSurfaces(decls, ownSurfaces);
      registry.registerExtension(extensionId, decls.consumers);
      const qualified = decls.dropTargets.map((t) => ({
        ...t,
        surface: qualifyName(extensionId, t.surface),
      }));
      try {
        assertNoConsumerDropTargetConflicts(registry.allForConflictCheck(), [
          ...[...dropTargets.values()].flat(),
          ...qualified,
        ]);
      } catch (err) {
        registry.unregister(extensionId);
        throw err;
      }
      dropTargets.set(extensionId, qualified);
      service.registerDecls(extensionId, decls);
    },

    unregisterExtension,

    /** The kinds a grid drop can open, with their labels and consumers (the
     *  settings' `dragConsumers` menus). */
    consumerChoices: {
      choices: (): DragKindChoice[] => {
        const labels = new Map<string, string>(Object.entries(PLATFORM_DRAG_KIND_LABELS));
        for (const k of service.kinds()) if (k.label !== undefined) labels.set(k.name, k.label);
        return [...registry.choices()].map(([kind, consumers]) => ({
          kind,
          ...(labels.has(kind) ? { label: labels.get(kind)! } : {}),
          consumers,
        }));
      },
      onChange: (fn: () => void) => registry.onChange(fn),
    },

    /**
     * Register the platform's own drag sources (rows of its sidebar panes),
     * under the platform namespace: they emit platform kinds. Adds to (or, by
     * id, replaces) those registered before. Throws on a non-conforming source.
     */
    registerPlatformSources(sources: readonly DragSourceDecl[]): void {
      const parsed = parseDragRegistrations({ sources }, PLATFORM_DRAG_NAMESPACE).sources;
      platformSources = [
        ...platformSources.filter((s) => !parsed.some((p) => p.id === s.id)),
        ...parsed,
      ];
      service.registerDecls(PLATFORM_DRAG_NAMESPACE, {
        kinds: [],
        sources: platformSources,
        consumers: [],
        dropTargets: [],
      });
    },

    /** The binder for the platform's own panes (their tagged rows drag). */
    platformBinder(): SurfaceDragBinder {
      return service.forExtension(PLATFORM_DRAG_NAMESPACE);
    },

    /** The per-extension binder for `RendererSurfaceHostDeps.drag`. */
    binderFor(extensionId: string): SurfaceDragBinder {
      return service.forExtension(extensionId);
    },
  };
}

export type ExtensionDragRuntime = ReturnType<typeof createExtensionDragRuntime>;

/** The renderer window's runtime. */
export const extensionDrag: ExtensionDragRuntime = createExtensionDragRuntime({
  log: createLogger("openp41ge", "extension-drag"),
});
