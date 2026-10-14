/**
 * extension-renderer-runtime.ts — renderer-side runtime for renderer-driven
 * extensions.
 *
 * Implements the **view half** of the extension contract:
 *
 *   - `loadExtensionRenderers` loads an extension's renderer entry module under
 *     a scoped extension context and captures its `registerRenderers(...)`
 *     registrations. Each load is a fresh scope, so a reloaded module never
 *     accumulates (it replaces) — that is the HMR dedup story.
 *   - `mountRendererSurface` mounts one surface: it builds a `SurfaceHost`,
 *     invokes the render function (a pure function of state returning a lit
 *     template), renders it into the container, re-renders on `setState`, and
 *     disposes on close. A render/mount failure fails only that surface.
 *   - `deriveSurfaceCatalog` turns a set of surface registrations into the
 *     platform's app-type / system-tab registrations (the placement metadata the
 *     host already uses: ids, labels, icons, `defaultSide`).
 *
 * `dispatch`/`subscribe` on the host default to placeholders until the dispatch
 * bus lands (Phase 3). `openTab` and `config` are injected platform actions.
 */

import { render, nothing, html, type TemplateResult } from "lit";
import { createLogger, type ILogger } from "openp41ge-core-logger";
import {
  qualifyName,
  type ConfigSchema,
  type HandlerPayload,
  type OpenTabRequest,
  type DragDecls,
  type SurfaceConfigHost,
  type SurfaceHost,
  type SurfaceSpec,
  type SurfaceWorkspaceHost,
  type ContextMenuEntry,
} from "openp41ge-sdk";
import {
  beginExtensionScope,
  endExtensionScope,
  getScopedRenderers,
  getScopedDragDecls,
  getScopedConfigSchema,
} from "openp41ge-core-extension-host/scope";
import type { AppTypeRegistration, SystemTabRegistration } from "../controllers/types";
import type { MountDragBinding, SurfaceDragBinder } from "./extension-drag-service";
import { RendererAppController } from "../apps/extension/renderer-app-controller";
import { RendererSystemTabController } from "../apps/extension/renderer-system-tab-controller";

/** Platform-side dependencies supplied to a mounted renderer surface. */
export interface RendererSurfaceHostDeps {
  readonly log: ILogger;
  /** Open an editor/panel tab (platform action). `from` names the calling
   *  grid tab, for `placement: "next-column"`. */
  readonly openTab: (request: OpenTabRequest, from?: { readonly tabId: string }) => void;
  /** Open the Logs window on an error (`SurfaceHost.openLog`). Inert when absent. */
  readonly openLog?: (errorId: string) => void;
  /**
   * The extension's config (merged values, change notification, the editor).
   * Shared by every mount of the extension; each mount's subscriptions end
   * with it. When absent, the config is empty and inert.
   */
  readonly config?: SurfaceConfigHost;
  /**
   * Dispatch a command to the extension's backend. Unwired in Phase 2 —
   * defaults to a rejected promise.
   */
  readonly dispatch?: (command: string, payload?: HandlerPayload) => Promise<unknown>;
  /**
   * Subscribe to a platform/backend topic. Unwired in Phase 2 — defaults to a
   * no-op unsubscribe.
   */
  readonly subscribe?: (topic: string, fn: (payload: unknown) => void) => () => void;
  /**
   * The extension's drag binder (`RendererDragService.forExtension`). Each
   * mount attaches its own binding (delegated source listener + per-mount
   * drop receivers), disposed with the surface. When absent, drag is inert.
   */
  readonly drag?: SurfaceDragBinder;
  /**
   * Platform-injected context surfaced to the render function (see
   * `SurfaceHost.context`). Built by the loader (e.g. the workspace's browse
   * roots for a file-browser surface). A baked `context` is used as the host's
   * initial context, but a `buildContext` provider is preferred: registration
   * can run before the workspace file binds, so a baked snapshot may be empty.
   */
  readonly context?: Readonly<Record<string, unknown>>;
  /**
   * Lazily-resolved context provider. Resolved once at mount so a surface that
   * mounts after the workspace binds still receives the live workspace roots,
   * and the surface re-renders once they arrive. Falls back to the baked
   * `context` when absent.
   */
  readonly buildContext?: () => Promise<Readonly<Record<string, unknown>>>;
  /**
   * The platform's workspace actions behind `host.workspace` (clone a repo,
   * add a worktree). When absent, the actions resolve `ok: false`.
   */
  readonly workspace?: SurfaceWorkspaceHost;
  /**
   * Subscribe to changes of the open workspace (repos / worktrees added or
   * removed). The surface re-resolves `buildContext` and re-renders on each,
   * so `context.workspaceRepos` stays live. Returns an unsubscribe function.
   */
  readonly onWorkspaceChange?: (fn: () => void) => () => void;
  /** Draw a context menu for `host.showContextMenu` (inert when absent). */
  readonly showContextMenu?: (event: MouseEvent, items: readonly ContextMenuEntry[]) => void;
}

/** `host.workspace` when the platform wires no workspace actions. */
const UNWIRED_CLONE = () => ({
  done: Promise.resolve({ ok: false, error: "workspace actions are not available" }),
  onProgress: () => () => undefined,
  cancel: () => undefined,
});
const UNWIRED_WORKSPACE: SurfaceWorkspaceHost = {
  cloneRepository: UNWIRED_CLONE,
  addRepository: UNWIRED_CLONE,
  addWorktree: async () => ({ ok: false, error: "workspace actions are not available" }),
  fetchRepository: async () => ({ ok: false, error: "workspace actions are not available" }),
  deleteRepository: async () => ({ ok: false, error: "workspace actions are not available" }),
  deleteWorktree: async () => ({ ok: false, error: "workspace actions are not available" }),
  repositoryState: async (repoName) => ({
    repoName,
    branches: [],
    error: "workspace actions are not available",
  }),
  onWorkspaceFileChanged: () => () => undefined,
  openWindow: () => undefined,
};

/** `host.config` when the platform wires no config. */
const UNWIRED_CONFIG: SurfaceConfigHost = {
  get: () => ({}),
  subscribe: () => () => undefined,
  openEditor: () => undefined,
};

/** Handle for a mounted renderer surface. */
export interface RendererSurfaceInstance {
  readonly host: SurfaceHost;
  dispose(): void;
  setVisible(visible: boolean): void;
}

// ── Backend → renderer topic routing (Phase 3 dispatch bus) ──────────────

const log = createLogger("openp41ge", "extension-runtime");

const _topicSubs = new Map<string, Set<(payload: unknown) => void>>();
let _bridgeWired = false;

function ensureEventBridge(): void {
  if (_bridgeWired || typeof window === "undefined" || !window.openp41ge?.extension?.onEvent) {
    return;
  }
  _bridgeWired = true;
  try {
    window.openp41ge.extension.onEvent((evt) => {
      const subs = _topicSubs.get(evt.topic);
      if (!subs) return;
      for (const fn of [...subs]) {
        try {
          fn(evt.payload);
        } catch (err) {
          // Topic subscriber failures are isolated so one surface never breaks
          // the whole bus.
          log.debug("extension topic subscriber threw", err);
        }
      }
    });
  } catch (err) {
    // Bridge may be absent in some test environments; subscribe becomes inert.
    log.debug("extension event bridge unavailable", err);
  }
}

/**
 * Subscribe a renderer surface to a namespaced backend topic. The topic is
 * qualified with the extension id so two extensions never cross-deliver.
 * Returns an unsubscribe function.
 */
export function subscribeExtensionTopic(
  extId: string,
  topic: string,
  fn: (payload: unknown) => void,
): () => void {
  ensureEventBridge();
  const key = qualifyName(extId, topic);
  let set = _topicSubs.get(key);
  if (!set) {
    set = new Set();
    _topicSubs.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) _topicSubs.delete(key);
  };
}

/** Identity of the extension being loaded. */
export interface ExtensionLoadIdentity {
  readonly id: string;
  readonly version: string;
}

/** Result of loading an extension's renderer entry. */
export interface LoadedRendererSet {
  readonly renderers: readonly SurfaceSpec[];
  /** Drag declarations captured from `registerDragDecls` (empty when none). */
  readonly drag: DragDecls;
  /** The schema captured from `registerConfigSchema` (null when none). */
  readonly configSchema: ConfigSchema | null;
  /** Set when the module could not be loaded or its registrations captured. */
  readonly error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load an extension's renderer entry module under a scoped extension context.
 * The module self-registers via `registerRenderers`; the scope tags and
 * isolates those registrations. A reload yields a fresh, replacement set.
 */
export async function loadExtensionRenderers(
  identity: ExtensionLoadIdentity,
  loadEntry: () => Promise<unknown>,
): Promise<LoadedRendererSet> {
  const noDrag: DragDecls = { kinds: [], sources: [], consumers: [], dropTargets: [] };
  try {
    beginExtensionScope(identity.id, identity.version);
  } catch (err) {
    return { renderers: [], drag: noDrag, configSchema: null, error: errorMessage(err) };
  }
  try {
    await loadEntry();
    const renderers = getScopedRenderers();
    return {
      renderers: renderers ?? [],
      drag: getScopedDragDecls() ?? noDrag,
      configSchema: getScopedConfigSchema(),
    };
  } catch (err) {
    return { renderers: [], drag: noDrag, configSchema: null, error: errorMessage(err) };
  } finally {
    endExtensionScope();
  }
}

function errorPlaceholder(message: string): TemplateResult {
  return html`
    <div
      style="
        width: 100%; height: 100%; overflow: auto; padding: 0.75rem;
        font-family: inherit; font-size: 0.8125rem; color: #f87171;
      "
    >
      <div style="font-weight: 600">Extension surface failed to render</div>
      <div style="margin-top: 0.25rem; opacity: 0.8; white-space: pre-wrap">${message}</div>
    </div>
  `;
}

/**
 * Mount a surface: build its host, render the render function, and keep it in
 * sync on `setState`. A render failure fails only this surface (logged with
 * `skipToast` so the renderer recovers economically) and leaves an error
 * placeholder rather than tearing down the pane.
 */
export function mountRendererSurface<S extends Record<string, unknown> = Record<string, unknown>>(
  spec: SurfaceSpec,
  container: HTMLElement,
  deps: RendererSurfaceHostDeps,
  surfaceContext?: Readonly<Record<string, unknown>>,
): RendererSurfaceInstance {
  const surface = `${spec.kind}:${spec.id}`;
  const log = deps.log;
  const dispatch =
    deps.dispatch ??
    (() => Promise.reject(new Error(`dispatch is not wired yet (surface '${surface}')`)));
  const subscribe = deps.subscribe ?? (() => () => void 0);
  const config = deps.config ?? UNWIRED_CONFIG;
  const configSubs = new Set<() => void>();
  const workspace = deps.workspace ?? UNWIRED_WORKSPACE;
  const workspaceFileSubs = new Set<() => void>();
  const dragBinding: MountDragBinding = deps.drag?.attach(surface, container) ?? {
    registerDropTarget: () => () => void 0,
    dispose: () => void 0,
  };

  let _state = {} as S;
  // Platform-injected context (workspace repos, workspacesDir, …) merged with
  // the surface's own per-tab context (e.g. the workspace file `path`+`dir`
  // the workspace-editor grid cell edits). The surface context wins so a tab's
  // target path is never masked by a platform default.
  let _context: Readonly<Record<string, unknown>> = {
    ...(deps.context ?? {}),
    ...(surfaceContext ?? {}),
  };
  let disposed = false;
  let pending = false;

  const host: SurfaceHost<S> = {
    get surface() {
      return surface;
    },
    get context() {
      return _context;
    },
    get state() {
      return _state;
    },
    setState(update: S | ((prev: S) => S)): void {
      _state = typeof update === "function" ? (update as (prev: S) => S)(_state) : update;
      scheduleRender();
    },
    dispatch(command, payload) {
      return dispatch(command, payload);
    },
    subscribe(topic, fn) {
      return subscribe(topic, fn);
    },
    get log() {
      return log;
    },
    openTab(request) {
      deps.openTab(request);
    },
    openLog(errorId) {
      deps.openLog?.(errorId);
    },
    config: {
      get: () => config.get(),
      subscribe(fn) {
        const off = config.subscribe(fn);
        configSubs.add(off);
        return () => {
          configSubs.delete(off);
          off();
        };
      },
      openEditor: () => config.openEditor(),
    },
    drag: {
      registerDropTarget(id, opts) {
        return dragBinding.registerDropTarget(id, opts);
      },
    },
    workspace: {
      ...workspace,
      onWorkspaceFileChanged(fn) {
        const off = workspace.onWorkspaceFileChanged(fn);
        workspaceFileSubs.add(off);
        return () => {
          workspaceFileSubs.delete(off);
          off();
        };
      },
    },
    showContextMenu(event, items) {
      deps.showContextMenu?.(event, items);
    },
  };

  function renderOnce(): void {
    if (disposed) return;
    try {
      render(spec.render(host as SurfaceHost), container);
    } catch (err) {
      log.error(`extension surface '${surface}' render failed:`, err, { skipToast: true });
      render(errorPlaceholder(errorMessage(err)), container);
    }
  }

  function scheduleRender(): void {
    if (disposed || pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      renderOnce();
    });
  }

  /** Resolve the live context, then re-render (called at mount and whenever
   *  the open workspace changes). */
  function resolveContext(): void {
    if (!deps.buildContext) return;
    void deps
      .buildContext()
      .then((ctx) => {
        if (disposed) return;
        _context = { ...(ctx ?? {}), ...(surfaceContext ?? {}) };
      })
      .catch((err) =>
        log.error(`extension surface '${surface}' context resolve failed:`, err, {
          skipToast: true,
        }),
      )
      .finally(() => {
        if (!disposed) scheduleRender();
      });
  }

  if (deps.buildContext) {
    // Defer the first render until the live context resolves. Registration can
    // run before a workspace window binds its workspace file (bootstrap step
    // ordering), so a baked context would be empty; resolving at mount and
    // re-rendering picks up the actual workspace roots instead of flashing
    // "No repositories".
    resolveContext();
  } else {
    renderOnce();
  }

  // Stay live against the open workspace: a repo / worktree added or removed
  // (by this or any other surface, or the platform) refreshes the context.
  const unsubscribeWorkspace = deps.onWorkspaceChange?.(resolveContext);

  return {
    host: host as SurfaceHost,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeWorkspace?.();
      for (const off of configSubs) off();
      configSubs.clear();
      for (const off of workspaceFileSubs) off();
      workspaceFileSubs.clear();
      dragBinding.dispose();
      render(nothing, container);
      container.innerHTML = "";
    },
    setVisible(_visible: boolean): void {
      // Phase 2: surfaces are always rendered; visibility thottling is added
      // with the dispatch bus / keep-alive work.
    },
  };
}

/** The derived platform registrations for an extension's renderer surfaces. */
export interface DerivedRendererCatalog {
  readonly apps: AppTypeRegistration[];
  readonly systemTabs: SystemTabRegistration[];
}

/**
 * Derive the platform's app-type / system-tab registrations from an extension's
 * surface registrations. Ids are namespaced `ext:<extensionId>:<surfaceId>` so
 * they never collide with the platform's types, matching the legacy
 * contribution path.
 */
export function deriveSurfaceCatalog(
  extId: string,
  renderers: readonly SurfaceSpec[],
  deps: RendererSurfaceHostDeps,
): DerivedRendererCatalog {
  const apps: AppTypeRegistration[] = [];
  const systemTabs: SystemTabRegistration[] = [];
  for (const spec of renderers) {
    const id = `ext:${extId}:${spec.id}`;
    const icon = spec.icon ?? "\uD83E\uDDF9";
    const description = spec.description ?? `${spec.title} \u2014 ${extId}`;
    if (spec.kind === "grid") {
      apps.push({
        id,
        label: spec.title,
        icon,
        description,
        ...(spec.tabLabel ? { tabLabel: spec.tabLabel } : {}),
        ...(spec.workspace ? { workspace: spec.workspace } : {}),
        createController: (tabId) => new RendererAppController(tabId, id, spec, deps),
      });
    } else {
      systemTabs.push({
        id,
        label: spec.title,
        icon,
        description,
        defaultSide: spec.defaultSide,
        ...(spec.workspace ? { workspace: spec.workspace } : {}),
        createController: (tabId) => new RendererSystemTabController(tabId, id, spec, deps),
      });
    }
  }
  return { apps, systemTabs };
}
