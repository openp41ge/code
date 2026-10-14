/**
 * extension-renderer-loader.ts — live-air loader for renderer-driven
 * extensions.
 *
 * For every active extension that ships a renderer entry (`api: "0.2"`,
 * manifest `openp41ge.renderer`), this loads the entry module over the
 * privileged `openp41ge-ext://` protocol under a scoped extension context,
 * captures its `registerRenderers(...)` registrations, derives the platform's
 * app-type / system-tab registrations, and registers them into the platform
 * registries.
 *
 * The extension entry and the app bundle both resolve `lit`, the SDK and the
 * UI toolkit to the SAME shared runtime modules (the app's
 * `extension-runtime/<name>.js`, routed by the injected import map), so a
 * self-contained copy of the API would silently capture zero
 * registrations — the import map is what makes the scoped registration store
 * shared.
 */

import { createLogger, type ILogger } from "openp41ge-core-logger";
import { qualifyName, validateRepoUrl, type ContextMenuEntry } from "openp41ge-sdk";
import { registerAppType, registerSystemTabType } from "../apps/app-registry";
import { getActiveExtensions } from "./extension-contributions";
import { workspaceFileService, deriveRepoName } from "./workspace-file-service";
import {
  deriveSurfaceCatalog,
  loadExtensionRenderers,
  subscribeExtensionTopic,
  type RendererSurfaceHostDeps,
} from "./extension-renderer-runtime";
import { extensionDrag } from "./extension-drag";
import { createWorkspaceActions } from "./extension-workspace-actions";
import { showConfirm } from "../confirm-service";
import { setContextMenuActive } from "./drag-context";
import { createOpenp41geContextMenu } from "../interfaces/element-guards";
import { Openp41geTabsEventHandler } from "./openp41ge-tabs-event-handler";
import { RepositoryStates } from "./repository-states";
import { extensionConfigs } from "./extension-configs";
import { CONFIG_EDITOR_APP_TYPE } from "../apps/config-editor/title";

const EXTENSION_PROTOCOL = "openp41ge-ext";

const log = createLogger("openp41ge", "extension-renderer-loader");

/** Monotonic sequence so each renderer-entry load re-executes the module. */
let rendererLoadSeq = 0;

/** The `<dataDir>/workspaces/` directory that holds `.openp41ge-workspace` files. */
export function dataDirWorkspaces(): string {
  const dataDir = window.openp41ge?.dataDir?.() ?? "";
  if (!dataDir) return "";
  // Browser renderer: `node:path` is externalized (its accessor throws), so
  // join by hand. Platform dataDir paths use `/` separators.
  const base = dataDir.length > 1 ? dataDir.replace(/\/+$/, "") : dataDir;
  return `${base}/workspaces`;
}

/** A repository injected into a renderer surface's context, with its worktrees. */
export interface WorkspaceRepoInfo {
  readonly name: string;
  /** The repo's git dir on disk (absent when it is not cloned). */
  readonly gitDir?: string;
  readonly worktrees: readonly WorkspaceWorktreeInfo[];
}

/** A worktree within a repo: its branch name + on-disk root to browse. */
export interface WorkspaceWorktreeInfo {
  readonly name: string;
  /** On-disk path to browse (a checked-out worktree root). */
  readonly path: string;
}

/**
 * Wait (bounded) for the workspace file service to have loaded its data.
 *
 * A renderer surface can mount before the resolve-window-workspace step binds the
 * workspace, so reading `openData` immediately would bake in an empty repo
 * list. In a workspace-bound window we first await the preload init signal,
 * then poll briefly until the workspace file is loaded. Windows without a
 * workspace binding (window-manager / logs) have no repos to surface and
 * return immediately.
 */
async function waitForWorkspaceData(): Promise<void> {
  try {
    await window.openp41ge?.workspace?.waitForInit?.();
  } catch {
    // Ignore — fall through to the bounded poll.
  }
  const path = window.openp41ge?.workspace?.getWorkspacePath?.() ?? null;
  if (!path) return;
  const deadline = Date.now() + 5000;
  while (!workspaceFileService.openData && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Workspace repo URLs already warned about as not full clone URLs. */
const warnedRepoUrls = new Set<string>();

/**
 * Build the platform-injected context for renderer surfaces: the workspace's
 * repositories, each carrying its git dir and its checked-out worktrees
 * (branch name + on-disk root). Best-effort — resolves nothing (empty list) when the workspace
 * service / controller is unavailable, so a bare surface still mounts. Every
 * repo is included, even one with no worktrees checked out (so the explorer
 * still shows it).
 */
export async function buildWorkspaceContext(): Promise<Readonly<Record<string, unknown>>> {
  await waitForWorkspaceData();
  // The `.openp41ge-workspace` files live under `<dataDir>/workspaces/`. This
  // is where the workspaces extension reads/writes/creates them (its backend
  // confines file access to this directory).
  const workspacesDir = dataDirWorkspaces();
  const data = workspaceFileService.openData;
  if (!data || !Array.isArray(data.repos) || data.repos.length === 0) {
    repositoryStates.track([]);
    return {
      workspaceRepos: [] as WorkspaceRepoInfo[],
      repositoryStates: {},
      workspacesDir,
    };
  }
  const gitDirs = new Map<string, string>();
  try {
    for (const r of (await window.openp41ge?.workspaceController?.listRepos?.()) ?? []) {
      gitDirs.set(r.name, r.path);
    }
  } catch (err) {
    log.debug("workspace repos: listRepos failed:", err);
  }
  const repos: WorkspaceRepoInfo[] = [];
  for (const repo of data.repos) {
    // Extensions only ever see repos with a full clone URL; a workspace file
    // (which an extension may write directly) can hold anything.
    if (validateRepoUrl(repo.url)) {
      // The context is rebuilt on every refresh: say so once per URL.
      if (!warnedRepoUrls.has(repo.url)) {
        warnedRepoUrls.add(repo.url);
        log.warn(`workspace repos: skipping "${repo.url}" — not a full clone URL`);
      }
      continue;
    }
    const repoName = deriveRepoName(repo.url);
    try {
      const worktrees = await window.openp41ge?.workspaceController?.listWorktrees?.(repoName);
      const wtInfos: WorkspaceWorktreeInfo[] = [];
      for (const wt of worktrees ?? []) {
        if (!wt.exists) continue;
        wtInfos.push({ name: wt.branch, path: wt.path });
      }
      // Include the repo even when it has no worktrees checked out (only the
      // branch names/roots below it are absent).
      const gitDir = gitDirs.get(repoName);
      repos.push({ name: repoName, ...(gitDir ? { gitDir } : {}), worktrees: wtInfos });
    } catch (err) {
      log.debug(`workspace repos: listWorktrees failed for "${repoName}":`, err);
    }
  }
  // Each repo's state arrives (and changes) later; every arrival re-resolves
  // the context, so it is the last known state here.
  listenForRepositoryChanges();
  repositoryStates.track(repos.map((r) => r.name));
  return {
    workspaceRepos: repos,
    repositoryStates: repositoryStates.snapshot(),
    workspacesDir,
  };
}

/** Each workspace repo's state (context.repositoryStates), kept up to date. */
const repositoryStates = new RepositoryStates(
  (repoName) => workspaceActions.repositoryState(repoName),
  () => repoRefreshListeners.forEach((fn) => fn()),
);

let listeningForRepositoryChanges = false;

/** Re-query a repo's state whenever the platform reports a change in it. */
function listenForRepositoryChanges(): void {
  const onChanged = window.openp41ge?.workspaceController?.onRepositoryChanged;
  if (listeningForRepositoryChanges || !onChanged) return;
  listeningForRepositoryChanges = true;
  onChanged((repoName) => repositoryStates.refresh(repoName));
}

/** `host.workspace`: clone / add worktree through the preload git API, recorded
 *  in (and saved to) the open workspace file. */
/** Surfaces to refresh when repos change on disk outside the workspace file
 *  (a fetch): same subscribers as the workspace file's change signal. */
const repoRefreshListeners = new Set<() => void>();

const workspaceActions = createWorkspaceActions(
  () => window.openp41ge?.workspaceController,
  {
    addRepo: (url) => workspaceFileService.addRepoToActive(url),
    addWorktree: (repoName, branch) => workspaceFileService.addWorktreeToActive(repoName, branch),
    hasWorktree: (repoName, branch) => workspaceFileService.hasWorktreeInActive(repoName, branch),
    removeRepo: (repoName) => workspaceFileService.removeRepoFromActive(repoName),
    removeWorktree: (repoName, branch) =>
      workspaceFileService.removeWorktreeFromActive(repoName, branch),
    refreshed: () => repoRefreshListeners.forEach((fn) => fn()),
    save: () => workspaceFileService.save(),
  },
  (options) => showConfirm({ ...options, confirmStyle: "danger" }),
  (workspaceFile) => window.openp41ge?.windowManager?.openWorkspaceWindow(workspaceFile),
);

/** `host.showContextMenu`: the app's own context menu at the event's position. */
function showExtensionContextMenu(event: MouseEvent, items: readonly ContextMenuEntry[]): void {
  document.querySelectorAll("openp41ge-contextmenu").forEach((el) => el.remove());
  setContextMenuActive(true);
  const menu = createOpenp41geContextMenu({
    x: event.clientX,
    y: event.clientY,
    items: items.map((item) =>
      "separator" in item
        ? { type: "separator" as const }
        : { label: item.label, action: () => item.onSelect() },
    ),
    onclose: () => {
      setContextMenuActive(false);
      menu.remove();
    },
  });
  document.body.appendChild(menu);
}

/**
 * Platform-side actions injected into every mounted renderer surface.
 *
 *   - `openTab`: a file opens in the host editor (`openp41ge:open-file`); any
 *     other app type opens through the grid-drop open path (`grid-open-tab`),
 *     in the last focused column, or with `placement: "next-column"` in the
 *     column right of the calling grid tab.
 *   - `dispatch` → the extension's `registerProcesses` backend handler and
 *     `subscribe` → backend topic pushes, both namespaced by extension id.
 *   - `workspace` → platform workspace actions; `onWorkspaceChange` keeps
 *     `context.workspaceRepos` live.
 *   - `config` → the extension's merged config; its editor opens as a
 *     `config-editor` grid tab.
 */
export function createRendererSurfaceDeps(
  extId: string,
  buildContext: () => Promise<Readonly<Record<string, unknown>>>,
): RendererSurfaceHostDeps {
  const deps: RendererSurfaceHostDeps = {
    log,
    buildContext,
    openTab(request, from) {
      if (request.appType === "file-viewer") {
        const filePath =
          typeof request.params?.filePath === "string" ? request.params.filePath : null;
        if (filePath) {
          const name = filePath.split(/[\\/]/).pop() ?? filePath;
          document.dispatchEvent(
            new CustomEvent("openp41ge:open-file", {
              detail: { path: filePath, name, pinned: request.pinned ?? false },
            }),
          );
        }
        return;
      }
      // Any other app type opens exactly as a grid drop of it would (the drop
      // path translates it per app type), in this window's last-focused column
      // or, for `next-column`, right of the calling tab.
      const grid = document.querySelector("tab-grid") as (HTMLElement & { winId?: string }) | null;
      const nextToTabId = request.placement === "next-column" ? from?.tabId : undefined;
      document.dispatchEvent(
        new CustomEvent("grid-open-tab", {
          detail: {
            tabType: request.appType,
            tabConfig: { ...(request.params ?? {}) },
            targetCol: Openp41geTabsEventHandler.getLastFocusedCol(grid?.winId ?? ""),
            pinned: request.pinned ?? false,
            ...(request.key ? { tabKey: request.key } : {}),
            ...(nextToTabId ? { nextToTabId } : {}),
          },
        }),
      );
    },
    openLog(errorId) {
      window.openp41ge?.windowManager?.openLogs?.({ errorId });
    },
    config: extensionConfigs().hostFor(extId, () =>
      deps.openTab({ appType: CONFIG_EDITOR_APP_TYPE, params: { extensionId: extId } }),
    ),
    dispatch(command, payload) {
      return window.openp41ge.extension.dispatch(
        qualifyName(extId, command),
        payload as Record<string, unknown> | undefined,
      );
    },
    subscribe(topic, fn) {
      return subscribeExtensionTopic(extId, topic, fn);
    },
    workspace: workspaceActions,
    onWorkspaceChange: (fn) => {
      repoRefreshListeners.add(fn);
      const off = workspaceFileService.onChange(fn);
      return () => {
        repoRefreshListeners.delete(fn);
        off();
      };
    },
    showContextMenu: showExtensionContextMenu,
  };
  return deps;
}

/** Build the protocol URL for an extension's renderer entry. */
function rendererEntryUrl(extId: string, renderer: string): string {
  return `${EXTENSION_PROTOCOL}://${extId}/${renderer.replace(/^\/+/, "")}`;
}

/**
 * Load and register the renderer-driven surfaces of every active extension
 * that ships a renderer entry. Idempotent: re-registration overwrites the
 * platform registry entries (Map semantics), matching the legacy contribution
 * path. A failed entry only fails that extension (logged, not thrown).
 */
export async function registerRendererExtensions(): Promise<void> {
  const active = getActiveExtensions();
  let loaded = 0;
  for (const ext of active) {
    if (!ext.renderer) continue;
    const url = rendererEntryUrl(ext.id, ext.renderer);
    // Entry modules self-register at top-level import time via
    // `registerRenderers`. Browsers cache modules by URL, so re-importing the
    // same URL later (e.g. after an install/update/reload) returns the cached
    // module without re-running `registerRenderers`, leaving stale
    // registrations. Cache-bust with a unique query so each load re-executes
    // and replaces (the protocol handler resolves by pathname, ignoring the
    // query).
    const importUrl = `${url}?e=${rendererLoadSeq++}`;
    const result = await loadExtensionRenderers(
      { id: ext.id, version: ext.version },
      () => import(/* @vite-ignore */ importUrl),
    );
    if (result.error) {
      log.error(`renderer entry '${url}' for '${ext.id}' failed: ${result.error}`, {
        skipToast: true,
      });
      continue;
    }
    // Config: send a renderer-registered schema to main and cache the merged
    // values before any surface mounts (so `host.config.get()` is current).
    try {
      await extensionConfigs().load(ext.id, result.configSchema);
    } catch (err) {
      log.error(`config schema for '${ext.id}' rejected:`, err, { skipToast: true });
    }
    // Drag & drop: validate + register the extension's declarations. A bad
    // declaration fails only the extension's drag wiring, not its surfaces.
    try {
      extensionDrag.registerExtension(
        ext.id,
        result.drag,
        result.renderers.map((r) => `${r.kind}:${r.id}`),
      );
    } catch (err) {
      extensionDrag.unregisterExtension(ext.id);
      log.error(`drag declarations for '${ext.id}' rejected:`, err, { skipToast: true });
    }
    const catalog = deriveSurfaceCatalog(ext.id, result.renderers, {
      ...createRendererSurfaceDeps(ext.id, buildWorkspaceContext),
      drag: extensionDrag.binderFor(ext.id),
    });
    for (const app of catalog.apps) registerAppType(app);
    for (const tab of catalog.systemTabs) registerSystemTabType(tab);
    loaded++;
  }
  if (loaded > 0) log.info(`registered renderer-driven surfaces from ${loaded} extension(s)`);
}

/** Logger re-export for dependents that need a typed logger. */
export type { ILogger };
