/**
 * registration.ts — the renderer-driven extension surface.
 *
 * An extension bundle has **two entry points**:
 *
 *   - a **backend** entry (main process) that calls `registerProcesses(...)` to
 *     declare its command handlers, and
 *   - a **renderer** entry (renderer process) that calls `registerRenderers(...)`
 *     to declare one render function per surface it occupies.
 *
 * Both **self-register at module load** — there is no assumed `activate`/`render`
 * function name and no fixed set of component kinds. The host wraps each module
 * load in an *extension scope* (see `./runtime`) so registrations are tagged
 * with the extension identity and isolated per extension.
 *
 * `ElementNode` is a lit-html `TemplateResult`: the shared UI toolkit is a set
 * of Lit web components and lit-html is the platform's declarative rendering
 * layer, so a render function returns a lit template composed of toolkit custom
 * elements. The platform mounts it, reconciles on `setState`, and disposes it
 * on close. Standard widgets and bespoke UI are the same mechanism.
 *
 * Surfaces are **platform-owned and finite**; the content inside each is
 * extension-owned. `GridSurfaceSpec` / `SidebarSurfaceSpec` carry both the
 * render function and the placement metadata the platform needs (title/icon for
 * the tab, `defaultSide`).
 *
 * `registerConfigSchema` declares the extension's config section (`./config`).
 */

import type { TemplateResult } from "lit";
import type { ILogger } from "openp41ge-core-logger";
import type { HandlerFn, HandlerPayload } from "./context";
import { validateConfigSchema, type ConfigSchema, type ExtensionConfig } from "./config";
import {
  assertNoConsumerDropTargetConflicts,
  parseDragRegistrations,
  type DragKindDef,
  type DragPayload,
  type DragRegistrations,
  type DragSourceDecl,
  type DragConsumerDecl,
  type DropTargetDecl,
} from "./drag";

/** The platform-owned hosting surfaces an extension can render into. */
export type SurfaceKind = "grid" | "sidebar";

/**
 * A lit-html template result — the declarative element tree a render function
 * returns. Built from toolkit custom elements; the platform mounts + diffs it.
 */
export type ElementNode = TemplateResult;

/** A render function for one surface: a pure function of the host's state. */
export type RendererFn = (host: SurfaceHost) => ElementNode;

/** How one tab of a grid surface is labelled in the tab bar. */
export interface TabLabel {
  /** The tab's title (default: the surface's `title`). */
  readonly title?: string;
  /** Muted text after the title, e.g. a worktree tab's repository. */
  readonly description?: string;
  /** The tab's icon, as SVG markup (fill `currentColor` to follow the text). */
  readonly icon?: string;
}

/**
 * Whether a surface needs a workspace open in its window: `"required"` (the
 * default: it works on the workspace's repositories, files, chats…) or
 * `"none"` (it works without one, e.g. a settings editor). A window with no
 * workspace offers and opens only `"none"` surfaces.
 */
export type SurfaceWorkspace = "required" | "none";

/** A grid cell (an app tab occupying a grid cell). */
export interface GridSurfaceSpec {
  readonly kind: "grid";
  /** Surface id, unique within the extension. */
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly description?: string;
  /**
   * Label one tab from its params (what it was opened with, and is saved
   * with). The platform calls it when the tab opens and to draw the tab bar,
   * so a restored tab is labelled before it mounts. Must not throw.
   */
  readonly tabLabel?: (params: Readonly<Record<string, unknown>>) => TabLabel;
  /** Whether it needs a workspace open (default `"required"`). */
  readonly workspace?: SurfaceWorkspace;
  readonly render: RendererFn;
}

/** A sidebar tab. */
export interface SidebarSurfaceSpec {
  readonly kind: "sidebar";
  /** Surface id, unique within the extension. */
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly description?: string;
  /** Default sidebar where this tab opens when first created. */
  readonly defaultSide: "left" | "right";
  /** Whether it needs a workspace open (default `"required"`). */
  readonly workspace?: SurfaceWorkspace;
  readonly render: RendererFn;
}

/** A surface registration: one of the platform-owned surface kinds. */
export type SurfaceSpec = GridSurfaceSpec | SidebarSurfaceSpec;

/** All surfaces an extension occupies, registered at renderer-entry load. */
export type RendererRegistrations = readonly SurfaceSpec[];

/** A backend process registration: command id → handler. */
export type ProcessRegistrations = Readonly<Record<string, HandlerFn>>;

/** A request to open another tab (platform action). */
export interface OpenTabRequest {
  readonly appType: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /**
   * Where to open it. Defaults to a new column in the current window.
   * `next-column`: the column right of the calling grid tab (made if there is
   * none), replacing an unpinned preview there; from a sidebar surface, the
   * last focused column.
   */
  readonly placement?: "current" | "new-column" | "next-column";
  /**
   * Open the tab pinned (permanent) rather than as an unpinned preview (the
   * column's preview slot, replaced by the next preview); defaults to false.
   * A second `openTab` for the same file (or `key`) with `pinned: true`
   * promotes the existing preview.
   */
  readonly pinned?: boolean;
  /**
   * The tab's identity, e.g. a chat id: an open tab of this app type with the
   * same key in the target column is focused (and pinned when `pinned`)
   * instead of opening another. Without one, every call opens a tab.
   */
  readonly key?: string;
}

/**
 * Injected per surface mount. The extension never constructs this itself.
 * `state`/`setState` drive re-renders; `dispatch` reaches the extension's
 * backend over the dispatch bus; `subscribe` receives platform/backend pushes;
 * `openTab` is a direct platform action; `config` is the extension's config.
 */
export interface SurfaceHost<S = Readonly<Record<string, unknown>>> {
  /** Fully-qualified surface name, e.g. "grid:explorer". */
  readonly surface: string;
  /**
   * Platform-injected context for the render function — host knowledge the
   * extension may need (e.g. `workspaceRoots` for a file-browser surface).
   * The extension never constructs this; it is read-only and JSON-safe.
   */
  readonly context: Readonly<Record<string, unknown>>;
  /** The surface's current state (owned by the extension). */
  readonly state: S;
  /** Replace the state (or update it via an updater fn); triggers a re-render. */
  setState(update: S | ((prev: S) => S)): void;
  /** Dispatch a command to a registered backend process. */
  dispatch(command: string, payload?: HandlerPayload): Promise<unknown>;
  /** Subscribe to a platform/backend topic. Returns an unsubscribe function. */
  subscribe(topic: string, fn: (payload: unknown) => void): () => void;
  /** Logger bound to the extension. */
  readonly log: ILogger;
  /** Open an editor/panel tab (platform action). */
  openTab(request: OpenTabRequest): void;
  /**
   * Open an error's log entry in a Logs tab: `errorId` is what
   * `log.error(...)` returned (in the view or the backend). The window shows
   * the entry with its details open.
   */
  openLog(errorId: string): void;
  /** The extension's config (its registered schema's defaults + the user's values). */
  readonly config: SurfaceConfigHost;
  /** Drag & drop: in-place drop receivers for this mount. */
  readonly drag: SurfaceDragHost;
  /** Workspace actions the platform performs (repositories, worktrees). */
  readonly workspace: SurfaceWorkspaceHost;
  /**
   * Show a context menu at `event`'s position (call from the extension's own
   * `contextmenu` handler, which decides the items for what was clicked). The
   * platform draws the menu; choosing an item calls its `onSelect`.
   */
  showContextMenu(event: MouseEvent, items: readonly ContextMenuEntry[]): void;
}

/** The config part of the surface host (see `registerConfigSchema`). */
export interface SurfaceConfigHost {
  /** The merged config: the schema's defaults plus the user's values. */
  get(): ExtensionConfig;
  /** Called with the new merged config on every change. Returns an unsubscribe. */
  subscribe(fn: (config: ExtensionConfig) => void): () => void;
  /** Open the platform's JSON editor for this extension's config, as a grid tab. */
  openEditor(): void;
}

/** Metadata delivered with an in-place drop. */
export interface DropMeta {
  /** The `DragSourceDecl.id` the payload came from. */
  readonly sourceId: string;
}

/** The drag & drop part of the surface host. */
export interface SurfaceDragHost {
  /**
   * Register THIS MOUNT's receiver for a declared drop target. The platform
   * validates the payload and relays it here; extension→extension delivery
   * always passes through the platform. The id must be a `DropTargetDecl` the
   * extension registered whose `surface` is this mount's surface, otherwise it
   * throws. Returns a deregister function; receivers are also removed on
   * dispose. The callback runs in the renderer — forward backend work with
   * `host.dispatch`.
   */
  registerDropTarget(
    id: string,
    opts: { onDrop(payload: DragPayload, meta: DropMeta): void },
  ): () => void;
}

/** A git command the platform ran and what it printed (raw; progress uses \r). */
export interface GitTranscript {
  readonly command: string;
  readonly output: string;
}

/**
 * A local branch of a workspace repository, and the work that exists only
 * here: what is not committed (in its worktree), and what is not pushed.
 */
export interface BranchState {
  readonly branch: string;
  /** Checked out in a worktree folder (else a local branch only; the counts
   *  of uncommitted files are then 0). */
  readonly worktree: boolean;
  /** Files with staged changes. */
  readonly staged: number;
  /** Tracked files with changes not staged (or unmerged). */
  readonly unstaged: number;
  /** Untracked files (not ignored). */
  readonly untracked: number;
  /** Commits on the branch that no remote-tracking branch has. */
  readonly unpushed: number;
}

/** A workspace repository's local branches and their state. */
export interface RepositoryState {
  readonly repoName: string;
  readonly branches: readonly BranchState[];
  /** Set when git could not read the state (the branches may be partial). */
  readonly error?: string;
}

/** Outcome of a platform workspace action. `error` is set when `ok` is false. */
export interface WorkspaceActionResult {
  readonly ok: boolean;
  readonly error?: string;
  /** On a failed git command: what ran and what git printed, so it can be shown. */
  readonly transcript?: GitTranscript;
  /** The user declined (a removal's confirmation): not an error to show. */
  readonly cancelled?: boolean;
}

/** Progress of a repository clone. */
export interface CloneProgress {
  /** 0–100. */
  readonly percent: number;
  readonly message?: string;
}

/** A running `cloneRepository` / `addRepository` clone. */
export interface RepositoryAddition {
  /** Settles when the clone finishes; `repoName` is the workspace's name for it. */
  readonly done: Promise<WorkspaceActionResult & { readonly repoName?: string }>;
  /** Receive clone progress. Returns an unsubscribe function. */
  onProgress(fn: (progress: CloneProgress) => void): () => void;
  /** Abort the clone; `done` then settles with `ok: false`. */
  cancel(): void;
}

/**
 * Workspace actions the platform performs on an extension's behalf. They are
 * platform work — git credentials, the workspace's repositories, and the open
 * workspace's repo/worktree list — so an extension asks rather than doing it
 * itself. On success the change is recorded in the open workspace and every
 * mounted surface's `context.workspaceRepos` is refreshed (and re-rendered).
 * Failures resolve with `ok: false`; they never throw.
 */
export interface SurfaceWorkspaceHost {
  /**
   * Clone `url` into a workspace's repositories without adding it to its
   * workspace file — for a workspace file being edited. `workspaceFile` is
   * that file's path; omitted: the open workspace. Already cloned: settles
   * `ok` at once.
   */
  cloneRepository(url: string, workspaceFile?: string): RepositoryAddition;
  /** Clone `url` (as `cloneRepository`) and add it to the open workspace. */
  addRepository(url: string): RepositoryAddition;
  /**
   * Check out `branch` of the workspace repository `repoName` as a worktree
   * (creating the branch if needed) and add it to the open workspace.
   */
  addWorktree(
    repoName: string,
    branch: string,
  ): Promise<WorkspaceActionResult & { readonly path?: string }>;
  /**
   * `git fetch` the workspace repository `repoName` from its remote (updates
   * only its remote-tracking branches: local branches, worktrees and
   * uncommitted work are untouched, so nothing can conflict), then refresh
   * every surface's `context.workspaceRepos` (worktrees re-read from disk).
   */
  fetchRepository(repoName: string): Promise<WorkspaceActionResult>;
  /**
   * Delete a workspace repository: the platform always asks the user first,
   * showing its uncommitted and unpushed work, then deletes its clone and
   * every worktree folder. `workspaceFile` names the workspace (the workspace
   * editor's file, which records the removal itself); omitted, it is the open
   * workspace, and the repository is also taken out of it.
   */
  deleteRepository(repoName: string, workspaceFile?: string): Promise<WorkspaceActionResult>;
  /**
   * Delete a worktree, after the platform asks the user: `git worktree remove`
   * deletes its folder (never forced — git refuses when it has uncommitted or
   * untracked changes, and that refusal is the `error`), then it is taken out
   * of the open workspace. Its branch is kept.
   */
  deleteWorktree(repoName: string, branch: string): Promise<WorkspaceActionResult>;
  /**
   * The state of the workspace repository `repoName`: per local branch, its
   * uncommitted files and its commits no remote has. Never rejects; a failure
   * is `error`. Mounted surfaces also receive every repository's state, kept
   * up to date, as `context.repositoryStates` (repoName → RepositoryState).
   */
  repositoryState(repoName: string): Promise<RepositoryState>;
  /**
   * Called when a workspace file's manifest (name, repos, settings — all but
   * its layout session) changes on disk, whoever wrote it. Layout-only saves
   * are not reported. Returns an unsubscribe; the platform also unsubscribes
   * when the surface is disposed.
   */
  onWorkspaceFileChanged(fn: (change: WorkspaceFileChange) => void): () => void;
  /** Open the window of the workspace file `workspaceFile` (or focus it, when open). */
  openWindow(workspaceFile: string): void;
}

/** A workspace file whose manifest changed (`onWorkspaceFileChanged`). */
export interface WorkspaceFileChange {
  /** The workspace file's path. */
  readonly path: string;
}

/** An item of a context menu: a label and what choosing it does, or a separator. */
export type ContextMenuEntry =
  { readonly label: string; onSelect(): void } | { readonly separator: true };

// ─── Extension scope (written here, opened by the host) ─────────────────────

/**
 * The capture target for an extension's registrations. The HOST
 * (`openp41ge-core-extension-host/scope`) opens one around each extension entry
 * module load; the `register*` functions below write into it.
 *
 * It lives on a global symbol rather than in this module so the SDK and the
 * host always meet, even when they end up as separate module copies (an
 * extension bundle, the shared runtime chunk, the main-process bundle). The
 * shape is a cross-package contract with the host's `scope.ts` — keep both in
 * sync (the host's tests cover the round trip).
 */
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
  config: ConfigSchema | null;
  disposers: Array<() => void | Promise<void>>;
}

const EXTENSION_SCOPE = Symbol.for("openp41ge.extension-scope");

/** The scope the host currently has open, or null. */
function currentScope(): ExtensionScope | null {
  return (
    ((globalThis as Record<symbol, unknown>)[EXTENSION_SCOPE] as ExtensionScope | null) ?? null
  );
}

/** Register a backend process's command handlers. Called at backend-entry load. */
export function registerProcesses(handlers: ProcessRegistrations): void {
  const scope = currentScope();
  if (!scope) {
    throw new Error("registerProcesses called outside an extension scope");
  }
  for (const [command, fn] of Object.entries(handlers)) {
    scope.processes.set(command, fn);
  }
}

/** Register the extension's surfaces. Called at renderer-entry load. */
export function registerRenderers(renderers: RendererRegistrations): void {
  const scope = currentScope();
  if (!scope) {
    throw new Error("registerRenderers called outside an extension scope");
  }
  scope.renderers.push(...renderers);
}

function assertUniqueIds(what: string, decls: readonly { readonly id: string }[]): void {
  const seen = new Set<string>();
  for (const d of decls) {
    if (seen.has(d.id)) throw new Error(`duplicate ${what} id '${d.id}'`);
    seen.add(d.id);
  }
}

/**
 * Register payload kinds, drag sources, tab consumers and drop targets.
 * Called at renderer-entry load. The extension's kinds are named
 * `<extensionId>/<id>`; a source emits a platform kind or one of them. Every
 * declaration is validated against the contract schemas, ids must be unique
 * per registration type, and no surface may both consume and receive the same
 * kind — any violation throws.
 */
export function registerDragDecls(regs: DragRegistrations): void {
  const scope = currentScope();
  if (!scope) {
    throw new Error("registerDragDecls called outside an extension scope");
  }
  const parsed = parseDragRegistrations(regs, scope.id, scope.drag.kinds);
  const next = {
    kinds: [...scope.drag.kinds, ...parsed.kinds],
    sources: [...scope.drag.sources, ...parsed.sources],
    consumers: [...scope.drag.consumers, ...parsed.consumers],
    dropTargets: [...scope.drag.dropTargets, ...parsed.dropTargets],
  };
  assertUniqueIds(
    "drag kind",
    next.kinds.map((k) => ({ id: k.name })),
  );
  assertUniqueIds("drag source", next.sources);
  assertUniqueIds("drag consumer", next.consumers);
  assertUniqueIds("drop target", next.dropTargets);
  assertNoConsumerDropTargetConflicts(next.consumers, next.dropTargets);
  scope.drag.kinds = next.kinds;
  scope.drag.sources = next.sources;
  scope.drag.consumers = next.consumers;
  scope.drag.dropTargets = next.dropTargets;
}

/**
 * Register the extension's config schema (a JSON Schema object; its
 * `default`s are the defaults). Called once, at renderer- or backend-entry
 * load. An invalid schema, or a second registration, throws.
 */
export function registerConfigSchema(schema: ConfigSchema): void {
  const scope = currentScope();
  if (!scope) {
    throw new Error("registerConfigSchema called outside an extension scope");
  }
  validateConfigSchema(schema);
  if (scope.config) {
    throw new Error(`config schema already registered for '${scope.id}'`);
  }
  scope.config = schema;
}

/**
 * Register a cleanup for the backend (stop timers, write what is pending).
 * Called at backend-entry load; the platform runs every registered cleanup,
 * in order, when the extension unloads (reload, uninstall) and when the app
 * quits. A cleanup that throws does not stop the others. At quit, only what a
 * cleanup does synchronously is sure to finish (write pending files with sync
 * calls).
 */
export function registerDispose(fn: () => void | Promise<void>): void {
  const scope = currentScope();
  if (!scope) {
    throw new Error("registerDispose called outside an extension scope");
  }
  scope.disposers.push(fn);
}
