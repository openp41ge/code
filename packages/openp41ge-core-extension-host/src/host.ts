/**
 * host.ts — the extension host: loads installed extensions' backend entries,
 * which self-register (`registerProcesses`, `registerConfigSchema`,
 * `registerDispose`) inside an extension scope, and unloads them.
 *
 * Runs in the **main process**. Responsibilities:
 *
 *   - Discovery (see `discovery.ts`) of installed extensions.
 *   - Loading each backend entry inside its extension scope; an extension
 *     built for another API version than `EXTENSION_API_VERSION` is not
 *     loaded.
 *   - Per-extension error isolation — one bad extension never breaks boot.
 *   - The extension's command handlers (namespaced `<id>/<command>`), its
 *     config schema and its log stream.
 *   - Deactivation + disposal on shutdown / uninstall / reload.
 *
 * The platform wires the command registry into its IPC dispatch, and
 * forwards the active-extension summary to the renderer, which loads each
 * extension's renderer entry.
 */

import { pathToFileURL } from "node:url";
import { createLogger, registerLogStream, type ILogger } from "openp41ge-core-logger";
import type {
  ActiveExtensionSummary,
  ConfigSchema,
  ExtensionManifest,
  HandlerCaller,
  HandlerContext,
  HandlerFn,
  HandlerPayload,
} from "openp41ge-sdk";
import { EXTENSION_API_VERSION, qualifyName } from "openp41ge-sdk";
import { DefaultsConfigStore, type ExtensionConfigStore } from "./config-store";
export type { ExtensionConfigStore } from "./config-store";
import {
  beginExtensionScope,
  endExtensionScope,
  getScopedConfigSchema,
  getScopedDisposers,
  getScopedProcesses,
} from "./scope";
export type { ActiveExtensionSummary } from "openp41ge-sdk";
import { discoverExtensions, type DiscoveredExtension } from "./discovery";

/** Globally-unique sequence for cache-busting entry module imports (see constructor). */
let entryLoadSeq = 0;

/** A loaded extension's registration surfaces + runtime handle. */
export interface LoadedExtension {
  readonly id: string;
  readonly version: string;
  readonly manifest: ExtensionManifest;
  readonly root: string;
  /** false when activation failed (the extension was skipped). */
  readonly active: boolean;
  readonly handlers: ReadonlyMap<string, HandlerFn>;
  /** Activation error message when `active` is false. */
  readonly error?: string;
  /** Internal: disposers + deactivate for lifecycle teardown. */
  readonly _dispose: () => void | Promise<void>;
}

export interface ExtensionHostOptions {
  /** Directories to scan for installed extensions (global + workspace). */
  readonly discoveryDirs: readonly string[];
  /** Override entry loading (tests). Defaults to dynamic `import()`. */
  readonly loadEntry?: (entryPath: string) => Promise<unknown>;
  /** Override logger creation (tests). Defaults to `createLogger(id, id)`. */
  readonly createLogger?: (id: string) => ILogger;
  /** Override discovery (tests). Defaults to `discoverExtensions`. */
  readonly discover?: (dirs: readonly string[]) => Promise<DiscoveredExtension[]>;
  /**
   * Invoked when a backend handler publishes a topic push to renderer
   * surfaces. The platform wires this to broadcast over IPC. Topic is already
   * qualified with the extension id. Defaults to a no-op.
   */
  readonly onPublish?: (topic: string, payload?: HandlerPayload) => void;
  /** The platform's extension config store. Defaults to schema defaults only. */
  readonly config?: ExtensionConfigStore;
}

export class ExtensionHost {
  private readonly _discoveryDirs: readonly string[];
  private readonly _loadEntry: (entryPath: string) => Promise<unknown>;
  private readonly _createLogger: (id: string) => ILogger;
  private readonly _discover: (dirs: readonly string[]) => Promise<DiscoveredExtension[]>;
  private readonly _onPublish: (topic: string, payload?: HandlerPayload) => void;
  private readonly _config: ExtensionConfigStore;

  private readonly _loaded = new Map<string, LoadedExtension>();
  private readonly _loggers = new Map<string, ILogger>();
  private readonly _order: string[] = [];
  /** Handlers bound to their extension's context; the caller is per call. */
  private readonly _handlers = new Map<
    string,
    (payload: HandlerPayload, caller?: HandlerCaller) => unknown
  >();

  constructor(options: ExtensionHostOptions) {
    this._discoveryDirs = options.discoveryDirs;
    // Extension entry modules self-register at top-level import time
    // (`registerProcesses`). Node caches ESM modules by URL, so
    // re-importing the same path after a host reload (workspace change,
    // install/update) would hand back the cached module without re-running
    // those top-level side effects, leaving the fresh host with no handlers.
    // Cache-bust with a globally-unique query so every load — even a fresh
    // host instance in the same process — re-executes the entry.
    this._loadEntry =
      options.loadEntry ??
      ((p: string) => import(`${pathToFileURL(p).href}?e=${entryLoadSeq++}`) as Promise<unknown>);
    this._createLogger = options.createLogger ?? ((id) => createLogger(id, id));
    this._discover = options.discover ?? discoverExtensions;
    this._onPublish = options.onPublish ?? (() => {});
    this._config = options.config ?? new DefaultsConfigStore();
  }

  /** Discover + activate every installed extension (isolating failures).
   *  No load order between extensions is guaranteed. */
  async loadAll(): Promise<LoadedExtension[]> {
    const discovered = await this._discover(this._discoveryDirs);
    const results: LoadedExtension[] = [];
    for (const d of discovered) {
      results.push(await this.load(d));
    }
    return results;
  }

  /** Load (activate) one discovered extension. Never throws. */
  async load(d: DiscoveredExtension): Promise<LoadedExtension> {
    const id = d.manifest.openp41ge.id;
    // Re-loading an already-active extension is a no-op.
    if (this._loaded.has(id) && this._loaded.get(id)!.active) {
      return this._loaded.get(id)!;
    }

    const log = this._loggerFor(id);
    registerLogStream(id);

    const handlers = new Map<string, HandlerFn>();
    const disposers: Array<() => void | Promise<void>> = [];
    let error: string | undefined;

    // The backend entry self-registers at import time, inside its scope.
    try {
      const api = d.manifest.openp41ge.api;
      if (api !== EXTENSION_API_VERSION) {
        throw new Error(
          `Built for extension API "${api}"; this version of the app loads API "${EXTENSION_API_VERSION}" (registerProcesses / registerRenderers)`,
        );
      }
      let procs: ReadonlyMap<string, HandlerFn> | null = null;
      let configSchema: ConfigSchema | null = null;
      beginExtensionScope(id, d.manifest.version);
      try {
        await this._loadEntry(d.entryPath);
        procs = getScopedProcesses();
        configSchema = getScopedConfigSchema();
        disposers.push(...(getScopedDisposers() ?? []));
      } finally {
        endExtensionScope();
      }
      if (configSchema) this._config.registerSchema(id, configSchema);
      if (procs) {
        for (const [command, fn] of procs) {
          handlers.set(qualifyName(id, command), fn);
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      log.error(`Failed to activate extension "${id}":`, err);
    }

    const dispose = async (): Promise<void> => {
      for (const fn of disposers) {
        try {
          await fn();
        } catch {
          /* disposal errors are non-fatal */
        }
      }
    };

    const loaded: LoadedExtension = {
      id,
      version: d.manifest.version,
      manifest: d.manifest,
      root: d.root,
      active: !error,
      handlers,
      error,
      _dispose: dispose,
    };

    // A failed activation is reported to the caller but not retained: it is
    // not loaded, does not contribute handlers, and is not listed
    // as active. The caller (platform) logs the result.
    if (error) return loaded;

    this._loaded.set(id, loaded);
    this._order.push(id);
    for (const [commandId, fn] of handlers) {
      // Bind the handlers' context up front so a handler can publish to its
      // own extension's topics without knowing its id at call time.
      const bound = (payload: HandlerPayload, caller?: HandlerCaller) =>
        fn(payload, this._contextFor(id, caller));
      this._handlers.set(commandId, bound);
    }
    log.info(`Activated extension "${id}" v${loaded.version}`);
    return loaded;
  }

  /** Deactivate + dispose an extension and remove its contributions. */
  async deactivate(id: string): Promise<void> {
    const loaded = this._loaded.get(id);
    if (!loaded) return;
    for (const commandId of loaded.handlers.keys()) {
      this._handlers.delete(commandId);
    }
    await loaded._dispose();
    this._loaded.delete(id);
    const idx = this._order.indexOf(id);
    if (idx >= 0) this._order.splice(idx, 1);
    this._loggerFor(id).info(`Deactivated extension "${id}"`);
  }

  /** Deactivate every loaded extension, last loaded first (app quit, reload). */
  async deactivateAll(): Promise<void> {
    for (const id of [...this._order].reverse()) await this.deactivate(id);
  }

  /** The extension's logger (one per extension, shared by its handlers). */
  private _loggerFor(id: string): ILogger {
    let log = this._loggers.get(id);
    if (!log) {
      log = this._createLogger(id);
      this._loggers.set(id, log);
    }
    return log;
  }

  /** Dispatch to a registered main-process handler. Throws if unregistered.
   *  Returns the handler's result (request/response). */
  async dispatch(
    commandId: string,
    payload: HandlerPayload,
    caller?: HandlerCaller,
  ): Promise<unknown> {
    const fn = this._handlers.get(commandId);
    if (!fn) {
      throw new Error(`No extension handler registered for "${commandId}"`);
    }
    return await fn(payload, caller);
  }

  /** Publish a (qualified) topic push to the platform for renderer delivery. */
  publish(topic: string, payload?: HandlerPayload): void {
    this._onPublish(topic, payload);
  }

  /** Build the handler context bound to one extension's namespace, and to
   *  the window that dispatched the call (`caller`). */
  private _contextFor(extId: string, caller?: HandlerCaller): HandlerContext {
    return {
      extensionId: extId,
      publish: (topic, payload) => this.publish(qualifyName(extId, topic), payload),
      git: (request) =>
        caller?.git
          ? caller.git(request)
          : Promise.resolve({
              ok: false,
              exitCode: null,
              stdout: "",
              stderr: "",
              error: "git runs only for a call from a window with a workspace open",
            }),
      config: { get: () => this._config.get(extId) },
      workspace: caller?.workspace
        ? {
            id: caller.workspace.id,
            roots: () => caller.workspace!.roots(),
            repositories: () => caller.workspace!.repositories(),
            addWorktree: (repoName, branch) => caller.workspace!.addWorktree(repoName, branch),
            dataDir: () => caller.workspace!.dataDirFor(extId),
          }
        : null,
      windowId: caller?.windowId ?? null,
      log: this._loggerFor(extId),
    };
  }

  /** True when a handler is registered for `commandId`. */
  hasHandler(commandId: string): boolean {
    return this._handlers.has(commandId);
  }

  /** All loaded extensions (active or failed) in activation order. */
  loadedExtensions(): readonly LoadedExtension[] {
    return this._order.map((id) => this._loaded.get(id)!);
  }

  /** Active extensions, with their renderer entries (for the renderer). */
  activeExtensions(): ActiveExtensionSummary[] {
    return this._order
      .map((id) => this._loaded.get(id)!)
      .filter((e) => e.active)
      .map((e) => ({
        id: e.id,
        version: e.version,
        ...(e.manifest.openp41ge.renderer ? { renderer: e.manifest.openp41ge.renderer } : {}),
      }));
  }
}
