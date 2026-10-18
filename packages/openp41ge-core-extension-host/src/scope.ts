/**
 * scope.ts — the extension scope (host side). Browser- and Node-safe: no Node
 * imports, so the renderer and the main process both load it via
 * `openp41ge-core-extension-host/scope`.
 *
 * The host opens a scope immediately before loading an extension entry module
 * so that module's `registerProcesses` / `registerRenderers` /
 * `registerDragDecls` / `registerOpenKinds` / `registerSearchProvider` /
 * `registerCommandBinaries` / `registerConfigSchema` / `registerDispose` calls (from `openp41ge-sdk`) are captured against that
 * extension, then reads the captured registrations and closes the scope:
 *
 *   beginExtensionScope(id, version);
 *   try {
 *     await import(entryPath);
 *     const renderers = getScopedRenderers();
 *   } finally {
 *     endExtensionScope();
 *   }
 *
 * The store lives on a global symbol shared with the SDK, so the two always
 * meet even when they are separate module copies (an extension bundle, the
 * renderer's shared runtime chunk, the main-process bundle). The shape below
 * is a cross-package contract with the SDK's `registration.ts`; the tests'
 * round trips through the SDK guard it.
 */

import type {
  CommandBinaryDef,
  ConfigSchema,
  DragConsumerDecl,
  DragDecls,
  DragKindDef,
  DragSourceDecl,
  DropTargetDecl,
  HandlerFn,
  OpenKindDef,
  SearchProvider,
  SurfaceSpec,
} from "openp41ge-sdk";

interface ExtensionScope {
  readonly id: string;
  readonly version: string;
  readonly processes: Map<string, HandlerFn>;
  readonly renderers: SurfaceSpec[];
  readonly drag: {
    kinds: DragKindDef[];
    sources: DragSourceDecl[];
    consumers: DragConsumerDecl[];
    dropTargets: DropTargetDecl[];
  };
  open: { kinds: OpenKindDef[] };
  searchProviders: SearchProvider[];
  commands: { binaries: CommandBinaryDef[] };
  config: ConfigSchema | null;
  disposers: Array<() => void | Promise<void>>;
}

const EXTENSION_SCOPE = Symbol.for("openp41ge.extension-scope");

const store = globalThis as Record<symbol, unknown>;

function currentScope(): ExtensionScope | null {
  return (store[EXTENSION_SCOPE] as ExtensionScope | null) ?? null;
}

/** Open a scope for one extension's entry-module load. Throws if one is open. */
export function beginExtensionScope(id: string, version: string): void {
  const open = currentScope();
  if (open) {
    throw new Error(`beginExtensionScope called while scope '${open.id}' is open`);
  }
  const scope: ExtensionScope = {
    id,
    version,
    processes: new Map(),
    renderers: [],
    drag: { kinds: [], sources: [], consumers: [], dropTargets: [] },
    open: { kinds: [] },
    searchProviders: [],
    commands: { binaries: [] },
    config: null,
    disposers: [],
  };
  store[EXTENSION_SCOPE] = scope;
}

/** Close the current scope, discarding its captured registrations. */
export function endExtensionScope(): void {
  store[EXTENSION_SCOPE] = null;
}

/** The processes registered during the current scope, or null when none open. */
export function getScopedProcesses(): ReadonlyMap<string, HandlerFn> | null {
  return currentScope()?.processes ?? null;
}

/** The surfaces registered during the current scope, or null when none open. */
export function getScopedRenderers(): readonly SurfaceSpec[] | null {
  const scope = currentScope();
  return scope ? [...scope.renderers] : null;
}

/** The drag declarations registered during the current scope, or null when none open. */
export function getScopedDragDecls(): DragDecls | null {
  const scope = currentScope();
  if (!scope) return null;
  const { kinds, sources, consumers, dropTargets } = scope.drag;
  return {
    kinds: [...kinds],
    sources: [...sources],
    consumers: [...consumers],
    dropTargets: [...dropTargets],
  };
}

/** The open kinds registered during the current scope, or null when none open. */
export function getScopedOpenKinds(): readonly OpenKindDef[] | null {
  const scope = currentScope();
  return scope ? [...scope.open.kinds] : null;
}

/** The search providers registered during the current scope, or null when none open. */
export function getScopedSearchProviders(): readonly SearchProvider[] | null {
  const scope = currentScope();
  return scope ? [...scope.searchProviders] : null;
}

/** The command binaries defined during the current scope, or null when none open. */
export function getScopedCommandBinaries(): readonly CommandBinaryDef[] | null {
  const scope = currentScope();
  return scope ? [...scope.commands.binaries] : null;
}

/** The config schema registered during the current scope, or null (none
 *  registered, or no scope open). */
export function getScopedConfigSchema(): ConfigSchema | null {
  return currentScope()?.config ?? null;
}

/** The cleanups registered during the current scope, or null when none open. */
export function getScopedDisposers(): ReadonlyArray<() => void | Promise<void>> | null {
  const scope = currentScope();
  return scope ? [...scope.disposers] : null;
}
