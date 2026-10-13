/**
 * tree-view.ts — the Explorer render function + its pure state helpers.
 *
 * No side effects and no module dependencies beyond shared `lit` (plus the
 * platform-hosted `openp41ge-icon` / `file-extension-svg` custom elements, which
 * are registered globally on the page the surface mounts into), so the view
 * logic is directly testable. The registration lives in `./renderer.ts` which
 * wraps this in a `registerRenderers` call.
 *
 * The render function is a pure function of the host:
 *   - it seeds the tree from `host.context.workspaceRepos` (host knowledge:
 *     the repos and their on-disk worktree roots of the open workspace), and
 *   - it lazily loads directory contents by dispatching `read-dir` to the
 *     backend, holding loaded nodes in `host.state`, and
 *   - a file click opens the host file editor after the backend's `open-file`
 *     gate (path confinement) passes, and
 *   - a repo / worktree row's context menu offers Delete (`host.workspace`;
 *     the platform asks first). The tree follows the context's repos and
 *     worktrees, so a deleted one disappears.
 *
 * The tree is bespoke markup composed from shared `lit` (the uikit `tree`
 * capability component is substituted until the whole toolkit closure is
 * externalized — Phase 6/9). Layout mirrors the built-in worktree tree: 12px
 * UI sans, regular weight, indentation per depth level.
 */

import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  deriveRepoName,
  type ConfigSchema,
  type ContextMenuEntry,
  type SurfaceConfigHost,
  type SurfaceWorkspaceHost,
  type WorkspaceActionResult,
} from "openp41ge-sdk";

/** A repository injected by the host (host.context.workspaceRepos), with its worktrees. */
export interface WorkspaceRepoInfo {
  readonly name: string;
  readonly worktrees: readonly WorkspaceWorktreeInfo[];
}

/** A worktree within a repo: its branch name + on-disk root to browse. */
export interface WorkspaceWorktreeInfo {
  readonly name: string;
  /** On-disk path to browse. */
  readonly path: string;
}

/** One entry from the backend `read-dir` result. */
export interface ReadDirEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "dir" | "file";
  /** Prefetched nested listing (present when read requested `depth > 0`). */
  readonly children?: ReadDirEntry[];
}

/** A node in the renderer's own tree model. */
export interface TreeNode {
  readonly path: string;
  readonly name: string;
  readonly kind: "dir" | "file";
  /** Distinguishes a repo / worktree grouping row from a filesystem entry. */
  readonly nodeType?: "repo" | "worktree";
  /** Worktree root that contains this node (open-file containment). */
  readonly root: string;
  readonly loaded: boolean;
  readonly expanded: boolean;
  readonly error?: string;
  readonly children: TreeNode[];
}

/** The four kinds of inline create rows the explorer renders. */
export type NewEntryKind = "folder" | "file" | "repo" | "worktree";

/** A create-row target: which row is active. `path` is the directory to create
 *  into (folder/file), the repo's name (worktree), or `""` for the root
 *  add-repository row; `root` is the enclosing worktree root for FS rows. */
export interface CreateTarget {
  readonly path: string;
  readonly kind: NewEntryKind;
  readonly root?: string;
}

/** The surface's state (owned by the Explorer). */
export interface ExplorerState {
  readonly roots: TreeNode[];
  /** The inline create row being edited (`+ add folder` / `+ add file` / etc.). */
  readonly newEntry?: { readonly path: string; readonly kind: NewEntryKind };
  /** Value being typed in the active create input (controlled via state). */
  readonly newEntryName?: string;
  /** The row that owns the blue focus cursor (row focus). */
  readonly focusedId?: string | null;
  /** The context's repos / worktrees `roots` last followed (see `reposKey`). */
  readonly reposKey?: string;
  /** A row whose menu action failed: shown red, the message on hover. */
  readonly rowError?: { readonly path: string; readonly message: string };
  /** Add rows whose repository / worktree the platform is still cloning /
   *  checking out, by `createRowKey`: what was typed and the progress. */
  readonly pending?: Readonly<Record<string, PendingAdd>>;
  /** The create row whose add failed (reopened with what was typed). */
  readonly createError?: { readonly key: string; readonly message: string };
}

/** A repository / worktree add the platform is working on. */
export interface PendingAdd {
  readonly name: string;
  /** Clone progress, 0–100 (repositories only). */
  readonly percent?: number;
}

/** Default Explorer indentation unit (px) / prefetch depth, and their bounds
 *  (the extension's config schema, `EXPLORER_CONFIG_SCHEMA`, uses the same). */
export const DEFAULT_INDENT_SIZE = 16;
export const MIN_INDENT_SIZE = 4;
export const MAX_INDENT_SIZE = 48;
/** How many levels a single `read-dir` prefetches ahead (default). */
export const PREFETCH_DEPTH = 2;
export const MIN_PREFETCH_DEPTH = 0;
export const MAX_PREFETCH_DEPTH = 4;

/** A host subset sufficient for the render function + handlers (kept minimal
 *  and non-generic so the view logic is directly testable). The platform's
 *  `SurfaceHost` is a structural superset and satisfies this. */
export interface ExplorerHost {
  readonly context: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly dispatch: (
    command: string,
    payload?: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly setState: (update: (prev: ExplorerState) => ExplorerState) => void;
  readonly openTab: (request: {
    appType: string;
    params?: Readonly<Record<string, unknown>>;
    /** Open the tab pinned (permanent) rather than as an unpinned preview. */
    pinned?: boolean;
  }) => void;
  readonly log?: { readonly error: (msg: string, ...rest: unknown[]) => void };
  /** Platform workspace actions: clone a repository, add a worktree. */
  readonly workspace?: SurfaceWorkspaceHost;
  /** Show the platform's context menu. */
  readonly showContextMenu?: (event: MouseEvent, items: readonly ContextMenuEntry[]) => void;
  /** The extension's merged config (`EXPLORER_CONFIG_SCHEMA`) and its editor. */
  readonly config?: SurfaceConfigHost;
}

/** The Explorer's settings: a config schema whose defaults are the defaults. */
export const EXPLORER_CONFIG_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  description: "Tree indentation and folder read-ahead.",
  properties: {
    indentSize: {
      type: "number",
      default: DEFAULT_INDENT_SIZE,
      minimum: MIN_INDENT_SIZE,
      maximum: MAX_INDENT_SIZE,
      description: "Indentation per tree level, in pixels.",
    },
    prefetchDepth: {
      type: "number",
      default: PREFETCH_DEPTH,
      minimum: MIN_PREFETCH_DEPTH,
      maximum: MAX_PREFETCH_DEPTH,
      description:
        "How many levels of folder contents are read ahead when a folder opens (0: none).",
    },
  },
};

/** Clamp a numeric setting, falling back when missing/invalid. */
function clampSetting(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** The indentation unit (px) from the extension's config. */
export function indentUnit(host: ExplorerHost): number {
  const value = host.config?.get().indentSize;
  return clampSetting(value, DEFAULT_INDENT_SIZE, MIN_INDENT_SIZE, MAX_INDENT_SIZE);
}

/** The prefetch depth from the extension's config. */
export function prefetchDepthOf(host: ExplorerHost): number {
  const value = host.config?.get().prefetchDepth;
  return clampSetting(value, PREFETCH_DEPTH, MIN_PREFETCH_DEPTH, MAX_PREFETCH_DEPTH);
}

/** Mounted Explorers already re-rendering on config changes. */
const followingConfig = new WeakSet<ExplorerHost>();

/** Re-render when the extension's config changes (a save in its editor). Once
 *  per mount; the platform drops the subscription when the mount goes. */
function followConfig(host: ExplorerHost): void {
  if (!host.config || followingConfig.has(host)) return;
  followingConfig.add(host);
  host.config.subscribe(() => host.setState((prev) => ({ ...prev })));
}

/**
 * Each mount's open rows, kept per workspace by the backend (`load-expanded`
 * / `save-expanded`): `restored` once the saved rows are open again, and the
 * set last saved, so only a change is saved. Kept beside the state, which
 * some updates replace whole (Collapse all).
 */
const openRows = new WeakMap<ExplorerHost, { restored: boolean; saved: string }>();

/**
 * On a mount's first render, open the saved rows again; after that, save the
 * open rows whenever they change. Nothing is saved while restoring, so a
 * mount never overwrites the saved rows with none.
 */
function followOpenRows(host: ExplorerHost, roots: readonly TreeNode[]): void {
  const rows = openRows.get(host);
  if (!rows) {
    openRows.set(host, { restored: false, saved: "" });
    void restoreOpenRows(host);
    return;
  }
  if (!rows.restored) return;
  const paths = expandedPaths(roots);
  const key = JSON.stringify(paths);
  if (key === rows.saved) return;
  rows.saved = key;
  host.dispatch("save-expanded", { paths }).catch((err: unknown) => {
    host.log?.error("Explorer: saving the open rows failed", err);
  });
}

/** Open the saved rows again, parents first, reading folders as needed;
 *  rows that are gone are skipped. */
async function restoreOpenRows(host: ExplorerHost): Promise<void> {
  let paths: string[] = [];
  try {
    const result = (await host.dispatch("load-expanded", {})) as { paths?: unknown } | undefined;
    if (Array.isArray(result?.paths)) {
      paths = result.paths.filter((p): p is string => typeof p === "string");
    }
  } catch (err) {
    host.log?.error("Explorer: loading the open rows failed", err);
  }
  for (const path of paths) {
    const node = findNode(followContext(host, host.state as Partial<ExplorerState>).roots, path);
    if (node?.kind === "dir" && !node.expanded) await expandNode(host, path);
  }
  const rows = openRows.get(host);
  if (!rows) return;
  rows.restored = true;
  rows.saved = JSON.stringify(
    expandedPaths(followContext(host, host.state as Partial<ExplorerState>).roots),
  );
}

/**
 * Inline repo / worktree SVGs — copied verbatim from the built-in explorer's
 * icon set (packages/openp41ge/src/renderer/icons) so the two explorers render
 * identical glyphs. Rendered via unsafeHTML (currentColor, so they inherit the
 * row text colour).
 */
function repoIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M160-240v-480 520-40Zm0 80q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v200h-80v-200H447l-80-80H160v480h200v80H160ZM584-56 440-200l144-144 56 57-87 87 87 87-56 57Zm192 0-56-57 87-87-87-87 56-57 144 144L776-56Z"/></svg>`;
}

function worktreeIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M543.5-63.5Q520-87 520-120q0-23 11-41t29-29v-221q-18-11-29-28.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 23-11 40.5T640-411v115l160-53v-62q-18-11-29-28.5T760-480q0-33 23.5-56.5T840-560q33 0 56.5 23.5T920-480q0 23-11 40.5T880-411v119l-240 80v22q18 11 29 29t11 41q0 33-23.5 56.5T600-40q-33 0-56.5-23.5ZM160-160v-560 560Zm0 0q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640H447l-80-80H160v480h280v80H160Z"/></svg>`;
}

/**
 * Chevron glyph for a row: same `openp41ge-icon` element the built-in explorer
 * uses (chevron-right when collapsed / chevron-down when expanded).
 */
function chevronIcon(expanded: boolean): TemplateResult {
  return html`<openp41ge-icon
    name=${expanded ? "chevron-down" : "chevron-right"}
    size="12"
  ></openp41ge-icon>`;
}

/** Check glyph for the inline create row's confirm button (built-in icon set). */
function checkIcon(size = 14): string {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5L6.5 12L13 4.5"/></svg>`;
}

/** Close (cross) glyph for the inline create row's cancel button. */
function closeIcon(size = 14): string {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5"/><line x1="12.5" y1="3.5" x2="3.5" y2="12.5"/></svg>`;
}

/** Join a directory path with a child name (renderer-side, no `node:path`). */
function joinPath(parent: string, name: string): string {
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

/** Focus the inline create input as soon as it connects (enters edit mode).
 *  Focus synchronously, then re-assert on the next tick in case the platform's
 *  surface re-render replaces the node within the same frame (a setTimeout,
 *  not requestAnimationFrame, so it also fires while the window is hidden). */
function focusNewEntryInput(el: Element | undefined): void {
  if (el instanceof HTMLInputElement) {
    el.focus();
    setTimeout(() => {
      if (el.isConnected && document.activeElement !== el) el.focus();
    }, 0);
  }
}

/**
 * Build the initial tree from the host-injected repositories. Repos are the
 * top level; each repo's worktrees sit beneath it (static, seeded from the
 * context); a worktree's filesystem contents are fetched lazily on expand.
 */
export function seedRoots(repos: ReadonlyArray<WorkspaceRepoInfo>): TreeNode[] {
  return repos.map((repo) => ({
    path: repo.name,
    name: repo.name,
    kind: "dir",
    nodeType: "repo",
    root: repo.name,
    loaded: true,
    expanded: false,
    children: repo.worktrees.map((wt) => ({
      path: wt.path,
      name: wt.name,
      kind: "dir",
      nodeType: "worktree",
      root: wt.path,
      loaded: false,
      expanded: false,
      children: [],
    })),
  }));
}

/** The context's repos and worktrees, as a comparable key. */
function reposKey(repos: ReadonlyArray<WorkspaceRepoInfo>): string {
  return JSON.stringify(repos.map((r) => [r.name, r.worktrees.map((w) => w.path)]));
}

/**
 * The tree for `repos` (the context's, in its order), keeping what `roots`
 * already has for the repos and worktrees still there: expanded, loaded
 * contents. Repos and worktrees no longer in the context are dropped.
 */
export function reconcileRoots(
  roots: readonly TreeNode[],
  repos: ReadonlyArray<WorkspaceRepoInfo>,
): TreeNode[] {
  const known = new Map(roots.map((n) => [n.path, n]));
  return seedRoots(repos).map((repo) => {
    const old = known.get(repo.path);
    if (!old) return repo;
    const oldWorktrees = new Map(old.children.map((c) => [c.path, c]));
    return {
      ...repo,
      expanded: old.expanded,
      children: repo.children.map((wt) => {
        const was = oldWorktrees.get(wt.path);
        return was ? { ...was, name: wt.name } : wt;
      }),
    };
  });
}

/**
 * The state with its roots following the context's repos and worktrees.
 * Reconciled only when the context's list changed, so a node the Explorer
 * added itself (a new repo) stays until the context catches up.
 */
function followContext(host: ExplorerHost, prev: Partial<ExplorerState>): ExplorerState {
  const repos = (host.context.workspaceRepos ?? []) as ReadonlyArray<WorkspaceRepoInfo>;
  const key = reposKey(repos);
  if (Array.isArray(prev.roots) && prev.reposKey === key) return prev as ExplorerState;
  return { ...prev, roots: reconcileRoots(prev.roots ?? [], repos), reposKey: key };
}

/** Convert backend listing entries into tree nodes (nested prefetched set). */
export function entriesToNodes(entries: ReadonlyArray<ReadDirEntry>, root: string): TreeNode[] {
  return entries.map((e) => {
    if (e.kind === "file") {
      return {
        path: e.path,
        name: e.name,
        kind: "file",
        root,
        loaded: true,
        expanded: false,
        children: [],
      };
    }
    const children = e.children ? entriesToNodes(e.children, root) : [];
    return {
      path: e.path,
      name: e.name,
      kind: "dir",
      root,
      // A dir with a prefetched `children` array is loaded; otherwise it is
      // fetched on first expand.
      loaded: e.children !== undefined,
      expanded: false,
      children,
    };
  });
}

/** Replace the children + expanded/loaded state of the node at `path`. */
export function applyReadDir(
  prev: ExplorerState,
  path: string,
  entries: ReadonlyArray<ReadDirEntry> | undefined,
): ExplorerState {
  const root = findRoot(prev.roots, path);
  return {
    ...prev,
    roots: mapNodes(prev.roots, (n) => {
      if (n.path === path && n.kind === "dir") {
        return {
          ...n,
          loaded: true,
          expanded: true,
          error: undefined,
          children: entries ? entriesToNodes(entries, root ?? n.root) : [],
        };
      }
      return n;
    }),
  };
}

/** Toggle a directory's expanded flag (directories only). */
export function setNodeExpanded(
  prev: ExplorerState,
  path: string,
  expanded: boolean,
): ExplorerState {
  return {
    ...prev,
    roots: mapNodes(prev.roots, (n) => (n.path === path ? { ...n, expanded } : n)),
  };
}

/** Mark a node with an error (e.g. a read/open failure) and collapse it. */
export function setNodeError(prev: ExplorerState, path: string, error: string): ExplorerState {
  return {
    ...prev,
    roots: mapNodes(prev.roots, (n) =>
      n.path === path ? { ...n, loaded: false, expanded: false, error } : n,
    ),
  };
}

/** Enter inline-edit mode for a create row (folder/file/worktree/repo). */
export function setNewEntry(
  prev: ExplorerState,
  path: string,
  kind: NewEntryKind,
  name = "",
): ExplorerState {
  return { ...prev, newEntry: { path, kind }, newEntryName: name };
}

/** Leave inline-edit mode for the create row (cancel / after confirm). */
export function clearNewEntry(prev: ExplorerState): ExplorerState {
  return { ...prev, newEntry: undefined, newEntryName: "", createError: undefined };
}

/** Update the name being typed in the active create-row input. */
export function setNewEntryName(prev: ExplorerState, name: string): ExplorerState {
  return prev.newEntry ? { ...prev, newEntryName: name, createError: undefined } : prev;
}

/** Set (or, with `undefined`, drop) the pending add of a create row. */
function setPending(prev: ExplorerState, key: string, add: PendingAdd | undefined): ExplorerState {
  const pending = { ...(prev.pending ?? {}) };
  if (add) pending[key] = add;
  else delete pending[key];
  return { ...prev, pending };
}

/** A failed add: reopen its create row with what was typed, and the error. */
function failAdd(
  prev: ExplorerState,
  target: CreateTarget,
  name: string,
  message: string,
): ExplorerState {
  const key = createRowKey(target);
  return {
    ...setPending(prev, key, undefined),
    newEntry: { path: target.path, kind: target.kind },
    newEntryName: name,
    createError: { key, message },
  };
}

/** Move the blue focus cursor to the given row (row focus). */
export function setFocused(prev: ExplorerState, id: string | null): ExplorerState {
  return { ...prev, focusedId: id };
}

/** Stable focus key for an inline create row (distinct from node paths). */
export function createRowKey(target: CreateTarget): string {
  return `create:${target.kind}:${target.path}`;
}

/** One worktree row under a repository. */
export interface WorktreeEntry {
  readonly branch: string;
  readonly path: string;
  readonly exists: boolean;
}

/** Replace a repo node's worktree children, keeping any already-expanded ones. */
export function applyWorktrees(
  prev: ExplorerState,
  repoName: string,
  worktrees: ReadonlyArray<WorktreeEntry>,
): ExplorerState {
  return {
    ...prev,
    roots: mapNodes(prev.roots, (n) => {
      if (n.path !== repoName) return n;
      const prior = new Map(
        n.children.filter((c) => c.nodeType === "worktree").map((c) => [c.path, c]),
      );
      const children = worktrees
        .filter((w) => w.exists)
        .map((w) => {
          const existing = prior.get(w.path);
          if (existing) return existing;
          return {
            path: w.path,
            name: w.branch,
            kind: "dir" as const,
            nodeType: "worktree" as const,
            root: w.path,
            loaded: false,
            expanded: false,
            children: [],
          };
        });
      return { ...n, children, expanded: true, error: undefined };
    }),
  };
}

/** Append a repository node to the roots (no-op when it already exists). */
export function addRepoNode(nodes: TreeNode[], name: string): TreeNode[] {
  if (nodes.some((n) => n.path === name)) return nodes;
  return [
    ...nodes,
    {
      path: name,
      name,
      kind: "dir" as const,
      nodeType: "repo" as const,
      root: name,
      loaded: true,
      expanded: false,
      children: [],
    },
  ];
}

function findRoot(nodes: TreeNode[], path: string): string | undefined {
  for (const n of nodes) {
    if (n.path === path) return n.root;
    if (n.children.length > 0) {
      const child = findRoot(n.children, path);
      if (child) return child;
    }
  }
  return undefined;
}

function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children.length > 0) {
      const child = findNode(n.children, path);
      if (child) return child;
    }
  }
  return undefined;
}

function mapNodes(nodes: TreeNode[], fn: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => {
    const updated = fn(n);
    const children = updated.children.map((c) => mapNodes([c], fn)[0]);
    return children === updated.children ? updated : { ...updated, children };
  });
}

/** The open rows (repos, worktrees and folders) a reader sees: each expanded
 *  node whose parents are all expanded, parents first. */
export function expandedPaths(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly TreeNode[]): void => {
    for (const n of list) {
      if (n.kind !== "dir" || !n.expanded) continue;
      out.push(n.path);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Collapse every expanded node (repo, worktree and directory) in a tree. */
export function collapseAll(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => ({
    ...n,
    expanded: false,
    children: collapseAll(n.children),
  }));
}

/** Structural subset of the platform's `SidebarTabBarButton` (kept here so the
 *  renderer need not import the uikit class across the extension boundary). */
export interface BottomBarButtonLike {
  readonly id: string;
  readonly icon?: string;
  readonly label?: string;
  readonly title?: string;
  readonly separatorBefore?: boolean;
  readonly onClick?: () => void;
}

/** Structural subset of the platform's `<openp41ge-sidebar-tab-content>`; the
 *  platform's element is a structural superset and satisfies this. */
export interface SidebarTabContentLike extends HTMLElement {
  registerBottomBarButton(spec: BottomBarButtonLike): () => void;
  removeBottomBarButton(id: string): void;
  clearBottomBarButtons(): void;
}

/** Register the explorer's bottom-bar buttons onto the sidebar-tab-content
 *  shell. Idempotent: registering an existing id replaces it in place, so this
 *  is safe to call on every (re)connect of the shell element. */
function registerExplorerBarButtons(el: Element | undefined, host: ExplorerHost): void {
  const shell = el as SidebarTabContentLike | undefined;
  // The shell is provided by the hosting platform; if it has not registered
  // the custom element (unit tests / an older host) there is no bar to fill.
  if (!shell || typeof shell.registerBottomBarButton !== "function") return;
  shell.registerBottomBarButton({
    id: "collapse-all",
    icon: "collapse",
    title: "Collapse all",
    onClick: () => host.setState((prev) => ({ roots: collapseAll(withRoots(host, prev).roots) })),
  });
  shell.registerBottomBarButton({
    id: "explorer-settings",
    icon: "settings",
    title: "Explorer settings",
    onClick: () => host.config?.openEditor(),
  });
}

// ─── Render function ──────────────────────────────────────────────────────

/** The Explorer render function: pure function of the host's state. */
export function renderExplorer(host: ExplorerHost): TemplateResult {
  followConfig(host);
  const state = (host.state ?? {}) as Partial<ExplorerState>;
  const roots: TreeNode[] = followContext(host, state).roots;
  followOpenRows(host, roots);
  return html`
    <style>
      .explorer-tree {
        min-height: 100%;
        font-family: var(--ui-sans, ui-sans-serif, system-ui, sans-serif);
        font-size: 12px;
        color: var(--fg-primary, inherit);
        background: transparent;
      }
      .explorer-root {
        display: flex;
        flex-direction: column;
        padding: 4px 0;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding-right: 8px;
        cursor: pointer;
        white-space: nowrap;
        user-select: none;
      }
      .row:hover {
        background: var(--row-hover, rgba(128, 128, 128, 0.12));
      }
      .row.row--error {
        background: rgba(244, 71, 71, 0.12);
        color: var(--accent-error, #f44747);
      }
      .row.pending-row {
        cursor: default;
        font-style: italic;
        color: var(--text-muted, #888);
      }
      .row.pending-row .pending-status {
        margin-left: auto;
        flex: none;
        font-size: 11px;
      }
      /* Row focus: the last-clicked / keyboard-focused row carries the blue
         focused-row bar + border (same outline the ext-tree paints). The
         row--focused class is applied to the inline create row while it is
         being edited so the highlight does not depend on the invisible input
         holding focus. */
      /* Row focus: only while the explorer grid owns focus (focus-within), so
         the blue focused-row bar/border appears only when the explorer tab is
         focused — clicking away hides it, refocusing the tab restores it. */
      .explorer-tree:focus-within .row:focus,
      .explorer-tree:focus-within .row:focus-visible,
      .explorer-tree:focus-within .row.row--focused {
        background: rgba(74, 158, 255, 0.12);
        box-shadow: inset 0 0 0 1px var(--tree-focus, #4a9eff);
        outline: none !important;
      }
      .row .chevron {
        width: 12px;
        flex: none;
        text-align: center;
        color: var(--fg-muted, inherit);
        opacity: 0.75;
      }
      .row .icon {
        width: 14px;
        flex: none;
        text-align: center;
        font-size: 13px;
      }
      .row .label {
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 400;
      }
      .row.add-row {
        color: var(--text-muted, #666);
        opacity: 0.6;
      }
      .row.add-row:hover {
        color: var(--fg-primary, inherit);
        opacity: 1;
      }
      .row.add-row .icon {
        font-size: 12px;
      }
      .new-entry-row {
        cursor: default;
        gap: 4px;
      }
      /* In edit mode the plus chevron and the kind glyph stay the muted
         colour they had on the idle add row — only the label becomes the input. */
      .new-entry-row .chevron,
      .new-entry-row .icon {
        color: var(--text-muted, #888);
      }
      /* The inline input is invisible — no background, no border, no focus
         ring. The ROW owns the visual state: while editing it carries the
         same blue focused-row outline (bar + border) as a focused row. */
      .new-entry-input {
        flex: 1;
        min-width: 0;
        height: 20px;
        padding: 0 2px;
        font: inherit;
        color: var(--fg-primary, inherit);
        background: transparent;
        border: none;
        outline: none;
      }
      .new-entry-input::placeholder {
        color: var(--text-muted, #888);
        opacity: 1;
      }
      .new-entry-input:focus,
      .new-entry-input:focus-visible {
        outline: none;
        box-shadow: none;
      }
      .row.new-entry-row:hover {
        background: transparent;
      }
      .explorer-tree:focus-within .row.new-entry-row:focus,
      .explorer-tree:focus-within .row.new-entry-row:focus-visible,
      .explorer-tree:focus-within .row.new-entry-row.row--focused,
      .explorer-tree:focus-within .row.new-entry-row:has(.new-entry-input:focus),
      .explorer-tree:focus-within .row.new-entry-row:has(.new-entry-input:focus-visible) {
        background: rgba(74, 158, 255, 0.12);
        box-shadow: inset 0 0 0 1px var(--tree-focus, #4a9eff);
        outline: none !important;
      }
      .new-entry-btn {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--fg-muted, inherit);
        cursor: pointer;
        border-radius: 3px;
      }
      .new-entry-btn:hover {
        background: rgba(128, 128, 128, 0.16);
        color: var(--fg-primary, inherit);
      }
      /* Grid focus: the tree grid shows a subtle background while it owns
         focus (tabbed into, or the panel is the focused tab). */
      /* No background change when the grid is focused — the row focus bar
         (above) is the only focus affordance. Keep any global outline off. */
      .explorer-tree:focus,
      .explorer-tree:focus-visible {
        outline: none !important;
      }
      .empty {
        padding: 8px 10px;
        color: var(--fg-muted, inherit);
        font-style: italic;
      }
    </style>
    <openp41ge-sidebar-tab-content ${ref((el) => registerExplorerBarButtons(el, host))}>
      <div
        class="explorer-tree"
        role="tree"
        tabindex="0"
        @keydown=${(e: KeyboardEvent) => onTreeKey(host, e)}
      >
        <div class="explorer-root">
          ${
            roots.length === 0
              ? html`<div class="empty">No repositories in this workspace yet.</div>`
              : roots.map((n) => renderNode(host, n, 0))
          }
          ${renderCreateRow(host, { path: "", kind: "repo" }, 0)}
        </div>
      </div>
    </openp41ge-sidebar-tab-content>
  `;
}

/**
 * Row icon: repo / worktree render the built-in explorer's inline SVGs; dirs
 * render the shared `openp41ge-icon` folder glyph; files render the shared
 * `file-extension-svg` (falls back to the default file icon for unknown types)
 * so file-type icons match the built-in explorer exactly.
 */
function nodeIcon(node: TreeNode): TemplateResult {
  if (node.nodeType === "repo") return html`${unsafeHTML(repoIcon(14))}`;
  if (node.nodeType === "worktree") return html`${unsafeHTML(worktreeIcon(14))}`;
  if (node.kind === "dir")
    return html`<openp41ge-icon name="folder-closed" size="14"></openp41ge-icon>`;
  return html`<file-extension-svg filename=${node.name} size="14"></file-extension-svg>`;
}

/**
 * Drag source id for file rows (registered in ./renderer.ts). The platform
 * builds the `file-path` payload from the row's `data-path` and owns the
 * gesture, ghost and drop.
 */
export const FILE_DRAG_SOURCE_ID = "file";

function renderNode(host: ExplorerHost, node: TreeNode, depth: number): TemplateResult {
  const state = (host.state ?? {}) as Partial<ExplorerState>;
  const focused = (state.focusedId ?? null) === node.path;
  const isDir = node.kind === "dir";
  const isFile = node.kind === "file";
  const padding = 4 + depth * indentUnit(host);
  const chevron = isDir ? chevronIcon(node.expanded) : nothing;
  const icon = nodeIcon(node);
  const failed = state.rowError?.path === node.path ? state.rowError.message : null;
  return html`
    <div
      class="row ${focused ? "row--focused" : ""} ${failed ? "row--error" : ""}"
      role="treeitem"
      tabindex="0"
      title=${failed ?? nothing}
      data-path=${node.path}
      data-kind=${node.kind}
      data-node-type=${node.nodeType ?? node.kind}
      data-depth=${depth}
      data-expanded=${isDir ? node.expanded : undefined}
      data-drag-source-id=${isFile ? FILE_DRAG_SOURCE_ID : nothing}
      style="padding-left:${padding}px"
      @click=${(e: MouseEvent) => {
        host.setState((prev) => setFocused(withRoots(host, prev), node.path));
        return isDir ? onToggle(host, node, e) : onOpenFile(host, node, e);
      }}
      @contextmenu=${(e: MouseEvent) => openRowMenu(host, node, e)}
    >
      <span class="chevron">${chevron}</span>
      <span class="icon">${icon}</span>
      <span class="label">${node.error ? node.error : node.name}</span>
    </div>
    ${isDir && node.expanded && node.loaded ? renderDirContents(host, node, depth) : nothing}
  `;
}

/**
 * The context menu of a repo / worktree row: Delete (the platform asks
 * first). File and folder rows have none.
 */
function openRowMenu(host: ExplorerHost, node: TreeNode, e: MouseEvent): void {
  const workspace = host.workspace;
  if (!host.showContextMenu || !workspace) return;
  let action: (() => Promise<WorkspaceActionResult>) | null = null;
  if (node.nodeType === "repo") {
    action = () => workspace.deleteRepository(node.path);
  } else if (node.nodeType === "worktree") {
    const roots = followContext(host, (host.state ?? {}) as Partial<ExplorerState>).roots;
    const repo = roots.find((r) => r.children.some((c) => c.path === node.path));
    if (repo) action = () => workspace.deleteWorktree(repo.path, node.name);
  }
  if (!action) return;
  e.preventDefault();
  const run = action;
  host.showContextMenu(e, [
    {
      label: "Delete",
      onSelect: () => {
        host.setState((prev) => ({ ...withRoots(host, prev), rowError: undefined }));
        void run().then(
          (res) => {
            if (res.ok || res.cancelled) return;
            const message = `Delete failed: ${res.error ?? "unknown error"}`;
            host.setState((prev) => ({
              ...withRoots(host, prev),
              rowError: { path: node.path, message },
            }));
          },
          (err: unknown) =>
            host.setState((prev) => ({
              ...withRoots(host, prev),
              rowError: { path: node.path, message: `Delete failed: ${String(err)}` },
            })),
        );
      },
    },
  ]);
}

/** Render an expanded directory's children: an `+ add folder` (at the bottom
 *  of the folder group) and `+ add file` (at the very bottom) for directories,
 *  or, for a repo, its worktree rows plus an `+ add worktree` row. Grouping
 *  repo rows never get filesystem create rows (their children are worktrees). */
function renderDirContents(host: ExplorerHost, node: TreeNode, depth: number): TemplateResult {
  const worktrees = node.children.filter((c) => c.nodeType === "worktree");
  const dirs = node.children.filter((c) => c.kind === "dir" && c.nodeType !== "worktree");
  const files = node.children.filter((c) => c.kind === "file");
  const others = node.children.filter((c) => c.kind !== "dir" && c.kind !== "file");
  const isGwRepo = node.nodeType === "repo";
  return html`${[
    ...(isGwRepo
      ? worktrees.map((c) => renderNode(host, c, depth + 1))
      : dirs.map((c) => renderNode(host, c, depth + 1))),
    ...(isGwRepo
      ? [renderCreateRow(host, { path: node.path, kind: "worktree" }, depth + 1)]
      : [renderCreateRow(host, { path: node.path, kind: "folder", root: node.root }, depth + 1)]),
    ...files.map((c) => renderNode(host, c, depth + 1)),
    ...others.map((c) => renderNode(host, c, depth + 1)),
    ...(isGwRepo
      ? []
      : [renderCreateRow(host, { path: node.path, kind: "file", root: node.root }, depth + 1)]),
  ]}`;
}

/** Muted label for a create row (built-in explorer wording). */
function createRowLabel(kind: NewEntryKind): string {
  switch (kind) {
    case "repo":
      return "add repository";
    case "worktree":
      return "add worktree";
    case "folder":
      return "add folder";
    default:
      return "add file";
  }
}

/** Input placeholder for a create row's inline edit mode. */
function createRowPlaceholder(kind: NewEntryKind): string {
  switch (kind) {
    case "repo":
      return "repository URL";
    case "worktree":
      return "worktree name";
    case "folder":
      return "folder name";
    default:
      return "file name";
  }
}

/** Glyph in the icon column of a create row: the grouping row's kind glyph
 *  (repo glyph, worktree glyph, folder icon, file icon). The `+` always lives
 *  in the chevron column. */
function createRowIcon(kind: NewEntryKind): TemplateResult {
  if (kind === "repo") return html`${unsafeHTML(repoIcon(14))}`;
  if (kind === "worktree") return html`${unsafeHTML(worktreeIcon(14))}`;
  if (kind === "folder")
    return html`<openp41ge-icon name="folder-closed" size="14"></openp41ge-icon>`;
  return html`<openp41ge-icon name="file" size="14"></openp41ge-icon>`;
}

/** Glyph in the chevron column of a create row: the `+` for every kind,
 *  aligned with the grouping rows' chevron column. */
function createRowChevron(): TemplateResult {
  return html`<openp41ge-icon name="plus" size="12"></openp41ge-icon>`;
}

/** Leading chevron + icon columns of a create row, so the label / input sit in
 *  the same text column as the grouping rows. Every create row puts the `+` in
 *  the chevron column and its kind glyph in the icon column. */
function createRowLeading(kind: NewEntryKind): TemplateResult | typeof nothing {
  return html`<span class="chevron">${createRowChevron()}</span
    ><span class="icon">${createRowIcon(kind)}</span>`;
}

/**
 * A `+ add folder` / `+ add file` / `+ add worktree` / `+ add repository` row.
 * When it is the active create target the label becomes an inline text input
 * with confirm/cancel buttons; otherwise a muted, hoverable row that enters
 * edit mode on click.
 */
function renderCreateRow(host: ExplorerHost, target: CreateTarget, depth: number): TemplateResult {
  const state = (host.state ?? {}) as Partial<ExplorerState>;
  const editing =
    !!state.newEntry && state.newEntry.path === target.path && state.newEntry.kind === target.kind;
  const padding = 4 + depth * indentUnit(host);
  const key = createRowKey(target);
  const pending = state.pending?.[key];
  if (pending) {
    const status =
      target.kind === "repo"
        ? `Cloning${pending.percent ? ` ${pending.percent}%` : "…"}`
        : "Checking out…";
    return html`
      <div
        class="row pending-row"
        role="treeitem"
        data-depth=${depth}
        style="padding-left:${padding}px"
        data-new-entry=${target.kind}
        data-path=${target.path}
      >
        <span class="chevron"></span>
        <span class="icon">${createRowIcon(target.kind)}</span>
        <span class="label">${pending.name}</span>
        <span class="pending-status">${status}</span>
      </div>
    `;
  }
  if (editing) {
    const name = state.newEntryName ?? "";
    const failed = state.createError?.key === key ? state.createError.message : null;
    return html`
      <div
        class="row new-entry-row row--focused ${failed ? "row--error" : ""}"
        title=${failed ?? nothing}
        role="treeitem"
        tabindex="0"
        data-depth=${depth}
        style="padding-left:${padding}px"
        data-new-entry=${target.kind}
        data-path=${target.path}
        data-root=${target.root ?? undefined}
      >
        ${createRowLeading(target.kind)}
        <input
          class="new-entry-input"
          data-new-entry=${target.kind}
          data-path=${target.path}
          .value=${name}
          placeholder=${createRowPlaceholder(target.kind)}
          ${ref(focusNewEntryInput)}
          @click=${(e: MouseEvent) => e.stopPropagation()}
          @input=${(e: Event) =>
            host.setState((prev) => setNewEntryName(prev, (e.target as HTMLInputElement).value))}
          @keydown=${(e: KeyboardEvent) => onCreateKey(host, target, e)}
          @blur=${() => host.setState((prev) => clearNewEntry(prev))}
        />
        <button
          type="button"
          class="new-entry-btn new-entry-confirm"
          title="Confirm"
          @mousedown=${(e: MouseEvent) => e.preventDefault()}
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            onConfirmCreate(host, target);
          }}
        >
          ${unsafeHTML(checkIcon(14))}
        </button>
        <button
          type="button"
          class="new-entry-btn new-entry-cancel"
          title="Cancel"
          @mousedown=${(e: MouseEvent) => e.preventDefault()}
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            host.setState((prev) => clearNewEntry(prev));
          }}
        >
          ${unsafeHTML(closeIcon(14))}
        </button>
      </div>
    `;
  }
  return html`
    <div
      class="row add-row ${state.focusedId === createRowKey(target) ? "row--focused" : ""}"
      role="treeitem"
      tabindex="0"
      data-new-entry=${target.kind}
      data-path=${target.path}
      data-depth=${depth}
      data-root=${target.root ?? undefined}
      style="padding-left:${padding}px"
      @click=${(e: MouseEvent) => {
        host.setState((prev) => setFocused(withRoots(host, prev), createRowKey(target)));
        onBeginCreate(host, target, e);
      }}
    >
      <span class="chevron">${createRowChevron()}</span>
      <span class="icon">${createRowIcon(target.kind)}</span>
      <span class="label add-label">${createRowLabel(target.kind)}</span>
    </div>
  `;
}

// ─── Event handlers ───────────────────────────────────────────────────────

/**
 * The state with the roots `renderExplorer` showed, before mutating:
 * `renderExplorer` derives the tree from `context.workspaceRepos` (and the
 * state), so handlers adopt that same tree — the node they were handed
 * matches the state being mutated.
 */
function withRoots(host: ExplorerHost, prev: ExplorerState): ExplorerState {
  return followContext(host, prev);
}

/** Expand or collapse a dir node by path (arrow-key navigation / toggling).
 *  Expanding an unloaded dir lazy-loads its children like `onToggle`. */
export function toggleNode(host: ExplorerHost, path: string, expand: boolean): void {
  if (!expand) {
    host.setState((prev) => setNodeExpanded(withRoots(host, prev), path, false));
    return;
  }
  void expandNode(host, path);
}

/** Expand a dir node by path; an unloaded dir's children are read first
 *  (settles once they are in). */
async function expandNode(host: ExplorerHost, path: string): Promise<void> {
  const node = findNode(followContext(host, host.state as Partial<ExplorerState>).roots, path);
  host.setState((prev) => setNodeExpanded(withRoots(host, prev), path, true));
  if (node && node.loaded) return;
  try {
    const result = await host.dispatch("read-dir", { path, depth: prefetchDepthOf(host) });
    const r = result as { ok?: boolean; entries?: ReadDirEntry[]; error?: string } | undefined;
    host.setState((prev) =>
      r && r.ok
        ? applyReadDir(withRoots(host, prev), path, r.entries)
        : setNodeError(withRoots(host, prev), path, r?.error ?? "read failed"),
    );
  } catch (err) {
    host.setState((prev) => setNodeError(withRoots(host, prev), path, String(err)));
  }
}

function onToggle(host: ExplorerHost, node: TreeNode, e: MouseEvent): void {
  e.stopPropagation();
  toggleNode(host, node.path, !node.expanded);
}

// ─── Arrow-key tree navigation ────────────────────────────────────────────

/** Reconstruct a row's focus key from its DOM attributes: node rows use their
 *  path; create rows use `create:kind:path` (same key as their focus state). */
export function rowFocusKey(el: HTMLElement): string | null {
  const kind = el.getAttribute("data-new-entry");
  if (kind) {
    return createRowKey({ path: el.getAttribute("data-path") ?? "", kind } as CreateTarget);
  }
  return el.getAttribute("data-path");
}

function rowDepth(el: HTMLElement): number {
  const d = el.getAttribute("data-depth");
  return d === null ? 0 : parseInt(d, 10) || 0;
}

/** Rows visible in the flattened tree, in display order (children render as
 *  siblings of their parent, so DOM order == the visible tree order). */
function visibleRows(tree: HTMLElement): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>(".row"));
}

/** Arrow-key navigation over the focused row: Up/Down move between rows,
 *  Right expands a collapsed dir (or descends into an expanded one), Left
 *  collapses an expanded dir (or ascends to its parent). */
export function onTreeKey(host: ExplorerHost, e: KeyboardEvent): void {
  // While typing in an inline create input, let the input handle the arrow keys.
  if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
  const tree = e.currentTarget as HTMLElement;
  const rows = visibleRows(tree);
  if (rows.length === 0) return;
  const idx = rows.findIndex((r) => r.classList.contains("row--focused"));
  if (idx < 0) return;

  const focusTo = (target: HTMLElement | null): void => {
    const key = target ? rowFocusKey(target) : null;
    if (!key) return;
    host.setState((prev) => setFocused(withRoots(host, prev), key));
    if (target && target.isConnected) target.focus();
  };

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      focusTo(rows[idx + 1] ?? null);
      break;
    case "ArrowUp":
      e.preventDefault();
      focusTo(rows[idx - 1] ?? null);
      break;
    case "ArrowRight": {
      const row = rows[idx];
      if (row.getAttribute("data-kind") !== "dir") break;
      e.preventDefault();
      const key = rowFocusKey(row);
      if (key && row.getAttribute("data-expanded") !== "true") {
        toggleNode(host, key, true);
      } else {
        focusTo(rows[idx + 1] ?? null);
      }
      break;
    }
    case "ArrowLeft": {
      const row = rows[idx];
      e.preventDefault();
      const key = rowFocusKey(row);
      if (
        key &&
        row.getAttribute("data-kind") === "dir" &&
        row.getAttribute("data-expanded") === "true"
      ) {
        toggleNode(host, key, false);
      } else {
        // Ascend to the nearest earlier row at a shallower depth (the parent).
        const depth = rowDepth(row);
        for (let i = idx - 1; i >= 0; i--) {
          if (rowDepth(rows[i]) < depth) {
            focusTo(rows[i]);
            break;
          }
        }
      }
      break;
    }
    case "Enter": {
      // Enter on a focused create row enters edit mode (input auto-focuses).
      const row = rows[idx];
      const kind = row.getAttribute("data-new-entry");
      if (!kind || row.classList.contains("new-entry-row")) break;
      e.preventDefault();
      const target: CreateTarget = {
        kind: kind as NewEntryKind,
        path: row.getAttribute("data-path") ?? "",
        root: row.getAttribute("data-root") ?? undefined,
      };
      onBeginCreate(host, target, e);
      break;
    }
  }
}

function onOpenFile(host: ExplorerHost, node: TreeNode, e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (node.kind !== "file") return;
  const pinned = isDoubleClickOnFile(node.path);
  void host
    .dispatch("open-file", { path: node.path, root: node.root })
    .then((result) => {
      const r = result as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok) {
        host.openTab({ appType: "file-viewer", params: { filePath: node.path }, pinned });
      } else {
        host.log?.error(`explorer: cannot open "${node.path}": ${r?.error ?? "open failed"}`);
      }
    })
    .catch((err) =>
      host.log?.error(`explorer: open-file failed for "${node.path}": ${String(err)}`),
    );
}

/** Double-click detection for pinning: a second click on the same file path
 *  within the delay promotes the preview to a pinned tab. Mirrors the
 *  tab-grid's double-click window so explorer + tab interactions feel alike. */
const DOUBLE_CLICK_DELAY_MS = 300;
let _lastClickPath = "";
let _lastClickAt = 0;

function isDoubleClickOnFile(path: string): boolean {
  const now = Date.now();
  const isDoubleClick = path === _lastClickPath && now - _lastClickAt <= DOUBLE_CLICK_DELAY_MS;
  _lastClickPath = path;
  _lastClickAt = now;
  return isDoubleClick;
}

/** Reset the double-click tracking (used by tests to keep cases isolated). */
export function resetDoubleClickTracking(): void {
  _lastClickPath = "";
  _lastClickAt = 0;
}

/** Click a create row (+ add folder / + add file / etc.): enter edit mode.
 *  Also used by the Enter key on a focused create row (keyboard event). */
function onBeginCreate(host: ExplorerHost, target: CreateTarget, e: Event): void {
  e.stopPropagation();
  host.setState((prev) => setNewEntry(withRoots(host, prev), target.path, target.kind, ""));
}

/** Create-row input key handling: Enter confirms, Escape cancels. */
function onCreateKey(host: ExplorerHost, target: CreateTarget, e: KeyboardEvent): void {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    onConfirmCreate(host, target);
  } else if (e.key === "Escape") {
    e.preventDefault();
    host.setState((prev) => clearNewEntry(withRoots(host, prev)));
  }
}

/** Create the entry, leave edit mode, and refresh the enclosing listing. */
function onConfirmCreate(host: ExplorerHost, target: CreateTarget): void {
  const state = (host.state ?? {}) as Partial<ExplorerState>;
  const name = (state.newEntryName ?? "").trim();
  host.setState((prev) => clearNewEntry(withRoots(host, prev)));
  if (!name) return;

  if (target.kind === "folder") {
    createFsEntry(host, target, "create-dir", "folder", name);
    return;
  }
  if (target.kind === "file") {
    createFsEntry(host, target, "write-file", "file", name);
    return;
  }
  if (target.kind === "worktree") {
    onCreateWorktree(host, target, name);
    return;
  }
  onCreateRepository(host, target, name);
}

/** Create a folder/file on disk and refresh the parent listing. */
function createFsEntry(
  host: ExplorerHost,
  target: CreateTarget,
  command: "create-dir" | "write-file",
  kind: "folder" | "file",
  name: string,
): void {
  const targetPath = joinPath(target.path, name);
  void host
    .dispatch(command, { path: targetPath, root: target.root })
    .then((result) => {
      const r = result as { ok?: boolean; error?: string } | undefined;
      if (r && !r.ok) {
        host.log?.error(`explorer: cannot create ${kind} "${name}": ${r?.error ?? "failed"}`);
      }
      refreshDir(host, target.path);
    })
    .catch((err) =>
      host.log?.error(`explorer: create ${kind} failed for "${targetPath}": ${String(err)}`),
    );
}

/** Re-read a directory so a newly-created entry appears in the sorted list. */
function refreshDir(host: ExplorerHost, path: string): void {
  void host
    .dispatch("read-dir", { path, depth: prefetchDepthOf(host) })
    .then((res) => {
      const r = res as { ok?: boolean; entries?: ReadDirEntry[]; error?: string } | undefined;
      host.setState((prev) =>
        r && r.ok
          ? applyReadDir(withRoots(host, prev), path, r.entries)
          : setNodeError(withRoots(host, prev), path, r?.error ?? "read failed"),
      );
    })
    .catch((err) => host.log?.error(`explorer: refresh failed for "${path}": ${String(err)}`));
}

/** `+ add worktree` confirmed: ask the platform to check out the branch and
 *  add it to the open workspace, then show it under the repo. Until then the
 *  create row shows the branch being checked out; a failure reopens it. */
function onCreateWorktree(host: ExplorerHost, target: CreateTarget, branch: string): void {
  const repoName = target.path;
  if (!host.workspace) {
    host.log?.error("explorer: workspace actions unavailable; cannot add worktree");
    return;
  }
  const key = createRowKey(target);
  host.setState((prev) => setPending(withRoots(host, prev), key, { name: branch }));
  const fail = (message: string) =>
    host.setState((prev) => failAdd(withRoots(host, prev), target, branch, message));
  void host.workspace.addWorktree(repoName, branch).then(
    (res) => {
      if (!res.ok || !res.path) {
        fail(res.error ?? `no worktree was created for '${branch}'`);
        return;
      }
      const path = res.path;
      host.setState((prev) => {
        const seeded = setPending(withRoots(host, prev), key, undefined);
        const repo = findNode(seeded.roots, repoName);
        const current = (repo?.children ?? [])
          .filter((c) => c.nodeType === "worktree")
          .map((c) => ({ branch: c.name, path: c.path, exists: true }));
        if (current.some((w) => w.path === path)) return seeded;
        return applyWorktrees(seeded, repoName, [...current, { branch, path, exists: true }]);
      });
    },
    (err: unknown) => fail(String(err)),
  );
}

/** `+ add repository` confirmed: ask the platform to clone the URL into the
 *  open workspace, then add it to the tree. Until then the create row shows
 *  the URL and the clone's progress; a failure reopens it. */
function onCreateRepository(host: ExplorerHost, target: CreateTarget, url: string): void {
  if (!host.workspace) {
    host.log?.error("explorer: workspace actions unavailable; cannot add repository");
    return;
  }
  const key = createRowKey(target);
  host.setState((prev) => setPending(withRoots(host, prev), key, { name: url }));
  const fail = (message: string) =>
    host.setState((prev) => failAdd(withRoots(host, prev), target, url, message));
  const cloning = host.workspace.addRepository(url);
  cloning.onProgress((p) =>
    host.setState((prev) =>
      prev.pending?.[key] ? setPending(prev, key, { name: url, percent: p.percent }) : prev,
    ),
  );
  void cloning.done.then(
    (res) => {
      if (!res.ok) {
        fail(res.error ?? "clone failed");
        return;
      }
      const name = res.repoName ?? deriveRepoName(url);
      host.setState((prev) => {
        const seeded = setPending(withRoots(host, prev), key, undefined);
        return { ...seeded, roots: addRepoNode(seeded.roots, name) };
      });
    },
    (err: unknown) => fail(String(err)),
  );
}
