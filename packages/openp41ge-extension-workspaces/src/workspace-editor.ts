/**
 * workspace-editor.ts — the Workspaces extension **grid** surface renderer.
 *
 * A single grid cell edits one `.openp41ge-workspace` config file. It offers two
 * views toggled by a button in the bottom bar:
 *
 *   - **JSON view**: the platform's standard `<json-editor>` (schema-aware:
 *     hover tooltips from the JSON Schema, code folding, auto-format).
 *   - **UI view**: a form over the editable manifest fields (name, repos).
 *
 * Only the editable manifest fields (`WORKSPACE_EDITABLE_FIELDS`) are surfaced
 * in either view; platform metadata (`id`, `version`, `createdAt`, `dataDir`)
 * and session state are preserved verbatim on round-trip (see
 * `pickEditableFields`).
 *
 * The render function is a pure function of the `SurfaceHost`. The target
 * workspace path/dir arrive via the platform-injected per-surface context
 * (`host.context.path` / `host.context.dir`); on first render the surface
 * kicks off an async read and repaints via `setState`.
 *
 * The bottom bar is the reusable `<we-bottom-bar>` component: the surface
 * registers its Save and view-toggle buttons into it (via its `buttons`
 * registry). The Save button's icon turns blue (accent) while there are
 * unsaved changes, and Cmd/Ctrl+S saves. The `<json-editor>` element comes
 * from the UI toolkit (`openp41ge-sdk-uikit/json-editor`), which the
 * platform's import map routes to its own instance.
 */

import { html, nothing, type TemplateResult } from "lit";
import { directive, Directive } from "lit/directive.js";
import type { ElementPart } from "lit/directive.js";
import { deriveRepoName, validateRepoUrl, type SurfaceHost } from "openp41ge-sdk";
import "openp41ge-sdk-uikit/json-editor";
import { autofocus } from "./autofocus-directive.js";
import "./workspace-bottom-bar.js";
import type { WorkspaceBottomBarButton } from "./workspace-bottom-bar.js";
import type { WorkspaceFileData, WorkspaceRepo } from "./workspace-file.js";
import { findRepoByName, mergeWorkspaceEdits, migrateWorkspaceFileData } from "./workspace-file.js";
import { WORKSPACE_FILE_SCHEMA, editableView, mergeEditableFields } from "./workspace-schema.js";

/** Save icon (floppy+disk outline), as SVG markup for the bottom-bar button. */
const SAVE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7l3 3v7H3V3z"/><path d="M5 3v3h4V3"/><path d="M5 13v-3h6v3"/></svg>';

/** Open-in-new-window icon (the toolbar's Open), as SVG markup. */
const OPEN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/></svg>';

/** Closed-padlock icon (locked workspace name), as SVG markup. */
const LOCK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/></svg>';

/** Open-padlock icon (unlocked workspace name), as SVG markup. */
const UNLOCK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M240-640h360v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85h-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640Zm0 480h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM240-160v-400 400Z"/></svg>';

// --- Global surface shortcuts (Cmd/Ctrl+S save, Cmd/Ctrl+Z undo) ---
//
// The shortcuts cannot live only on `.we-root`: clicking a row action (e.g.
// ✕ delete) removes the focused element, moving focus to `<body>`, so a
// subsequent keydown never reaches the surface's own `@keydown` handler. We
// instead run one document-level capture listener that routes the shortcuts
// to the *visible* workspace-editor surface. Inactive tabs have their grid
// container `display:none`, so `offsetParent` is null and they're skipped.
// Routing picks a single host, keeping each tab's undo history isolated.
const surfaceRoots = new Map<HTMLElement, WorkspaceEditorHost>();

class SurfaceRootDirective extends Directive {
  private host: WorkspaceEditorHost | null = null;
  render(host: WorkspaceEditorHost): unknown {
    this.host = host;
    return undefined;
  }
  update(part: ElementPart, props: Array<unknown>): unknown {
    const host = (props[0] as WorkspaceEditorHost | undefined) ?? this.host;
    if (host) surfaceRoots.set(part.element as HTMLElement, host);
    return undefined;
  }
}
const surfaceRoot = directive(SurfaceRootDirective);

function handleSurfaceKeydown(e: KeyboardEvent): void {
  if (!e.metaKey && !e.ctrlKey) return;
  const isSave = e.key === "s" || e.key === "S";
  const isUndo = e.key === "z" || e.key === "Z";
  if (!isSave && !isUndo) return;
  // Drop unmounted roots.
  for (const el of surfaceRoots.keys()) {
    if (!el.isConnected) surfaceRoots.delete(el);
  }
  const visible = [...surfaceRoots.keys()].filter(
    (el) => el.isConnected && el.offsetParent !== null,
  );
  if (!visible.length) return;
  // Route to the surface the keystroke originates in (focus inside a surface
  // reports the shadow host as activeElement, so follow the composed path).
  // Otherwise fall back to the sole visible surface: the common case where
  // focus fell to `<body>` after a row action (e.g. ✕ delete) removed the
  // focused element.
  const path = e.composedPath();
  const target =
    visible.find((el) => path.includes(el)) ??
    (document.activeElement === document.body ? visible[0] : undefined);
  if (!target) return;
  e.preventDefault();
  const host = surfaceRoots.get(target)!;
  if (isSave) void saveEditorState(host);
  else undoEditorState(host);
}

let shortcutsInstalled = false;
function installSurfaceShortcuts(): void {
  if (shortcutsInstalled) return;
  shortcutsInstalled = true;
  document.addEventListener("keydown", handleSurfaceKeydown, true);
}

let inlineAwayHandler: ((e: MouseEvent) => void) | null = null;
/** Cancel the inline repo-URL edit when the user clicks anywhere outside the
 *  inline editor. Installed while `editingRepo` is open, so it is independent
 *  of focus/blur (focus is unreliable while the grid surface mounts). */
function installInlineAwayCancel(onAway: () => void): void {
  if (inlineAwayHandler) document.removeEventListener("mousedown", inlineAwayHandler, true);
  inlineAwayHandler = (e: MouseEvent): void => {
    const t = e.composedPath()[0];
    const inside = t instanceof Element && !!t.closest(".we-inline");
    if (!inside) onAway();
  };
  document.addEventListener("mousedown", inlineAwayHandler, true);
}
function uninstallInlineAwayCancel(): void {
  if (inlineAwayHandler) document.removeEventListener("mousedown", inlineAwayHandler, true);
  inlineAwayHandler = null;
}

/** JSON catalogue icon (braces), as SVG markup for the bottom-bar button. */
const MAX_UNDO = 100;

const JSON_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5C5 3.5 4.5 4 4.5 5v1c0 .8-.4 1.2-1.5 1.5 1.1.3 1.5.7 1.5 1.5v1c0 1 .5 1.5 1.5 1.5"/><path d="M10 3.5c1 0 1.5.5 1.5 1.5v1c0 .8.4 1.2 1.5 1.5-1.1.3-1.5.7-1.5 1.5v1c0 1-.5 1.5-1.5 1.5"/></svg>';

/** The workspace-editor surface's owned state. */
export interface WorkspaceEditorState {
  /** Absolute path of the workspace file being edited. */
  readonly path: string;
  /** Workspaces directory (for read/write confinement). */
  readonly dir: string;
  /** The current (possibly edited) data. Undefined until the file loads. */
  readonly data: WorkspaceFileData | undefined;
  /** "json" | "ui" — which view is active. */
  readonly mode: "json" | "ui";
  /** True while the initial read is in flight. */
  readonly loading: boolean;
  /** True once the file has been read / saved successfully. */
  readonly saved: boolean;
  /** Load/save error text (file missing, write failure, …). */
  readonly error?: string;
  /** Indices of the repos whose worktree sections are open (view-local). */
  readonly openRepos?: readonly number[];
  /** Index of the repo whose URL is being edited inline (view-local). */
  readonly editingRepo: number | null;
  /** Inline URL edit value while editing (view-local). */
  readonly editingValue: string | null;
  /** The worktree whose branch name is being edited inline: its repo and
   *  index (view-local). */
  readonly editingWorktree: { readonly repo: number; readonly index: number } | null;
  /** Inline worktree edit value while editing (view-local). */
  readonly editingWorktreeValue: string | null;
  /** The always-present "add repository" inline editor value (never persisted). */
  readonly addingRepoValue: string | null;
  /** What is typed in a repo's "add worktree" inline editor, and which repo
   *  (view-local, never persisted). */
  readonly addingWorktree?: { readonly repo: number; readonly value: string } | null;
  /** Whether the workspace name field is locked (click the lock to edit). */
  readonly nameLocked: boolean;
  /** Why the last repo add (`"add"`) or URL edit (its index) was rejected (view-local). */
  readonly repoError?: { readonly at: "add" | number; readonly message: string } | null;
  /** Live background-clone status per repo URL (view-local, never persisted). */
  readonly cloneStates?: Record<string, RepoCloneState>;
  /** Per-tab undo history of prior data snapshots (never persisted). */
  readonly undoStack?: readonly WorkspaceFileData[];
  /** Last successfully saved data snapshot reference, for dirty tracking. */
  readonly savedData?: WorkspaceFileData;
}

/** Live background-clone status of a repo entry (never persisted). */
export interface RepoCloneState {
  readonly phase: "cloning" | "failed" | "done";
  readonly error?: string;
}

/** The namespaced app type of this extension's workspace-editor grid surface. */
export const WORKSPACE_EDITOR_APP_TYPE = "ext:openp41ge-extension-workspaces:workspace-editor";

/** The host this surface is mounted against. */
export type WorkspaceEditorHost = SurfaceHost<WorkspaceEditorState>;

/** Context keys the platform injects for this surface. */
export interface WorkspaceEditorContext {
  readonly path?: string;
  readonly dir?: string;
}

/** Read the workspace file and set it as the surface state. */
export async function loadEditorState(
  host: WorkspaceEditorHost,
  path: string,
  dir: string,
): Promise<void> {
  try {
    const result = (await host.dispatch("read", { dir, path })) as {
      ok?: boolean;
      entry?: { filePath: string; data: WorkspaceFileData };
      error?: string;
    };
    if (!result?.ok || !result.entry) {
      host.setState((prev) => ({
        ...prev,
        loading: false,
        error: result?.error ?? "Failed to read workspace file",
      }));
      return;
    }
    host.setState((prev) => ({
      ...prev,
      path: result.entry!.filePath,
      dir,
      data: migrateWorkspaceFileData(result.entry!.data),
      loading: false,
      error: undefined,
      saved: true,
      savedData: migrateWorkspaceFileData(result.entry!.data),
      undoStack: [],
    }));
  } catch (err) {
    host.setState((prev) => ({
      ...prev,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

/**
 * Re-read the edited file after it changed on disk (another window, the
 * workspace's own window, an extension). Without unsaved edits the editor
 * shows the file as it is now; with them, the change merges in
 * (`mergeWorkspaceEdits`: fields I left alone take the disk's values, repos
 * merge by name) — into the undo history too, so undoing never drops it.
 */
export async function reloadEditorFromDisk(host: WorkspaceEditorHost): Promise<void> {
  const ctx = host.context as WorkspaceEditorContext;
  const path = host.state.path ?? ctx.path;
  const dir = host.state.dir ?? ctx.dir;
  if (!path || !dir) return;
  const result = (await host.dispatch("read", { dir, path })) as {
    ok?: boolean;
    entry?: { data: WorkspaceFileData };
  };
  if (!result?.ok || !result.entry) return;
  const theirs = migrateWorkspaceFileData(result.entry.data);
  host.setState((prev) => {
    const { data: mine, savedData: base } = prev;
    if (!mine || !base || mine === base) {
      return { ...prev, data: theirs, savedData: theirs, saved: true, undoStack: [] };
    }
    const merged = mergeWorkspaceEdits(base, mine, theirs);
    const clean = JSON.stringify(merged) === JSON.stringify(theirs);
    return {
      ...prev,
      data: clean ? theirs : merged,
      savedData: theirs,
      saved: clean,
      undoStack: (prev.undoStack ?? []).map((u) =>
        u === base ? theirs : mergeWorkspaceEdits(base, u, theirs),
      ),
    };
  });
}

/** Each mounted editor's subscription to its file's changes. */
const following = new WeakMap<WorkspaceEditorHost, () => void>();

/**
 * Keep the editor live: reload (merging into unsaved edits) whenever the
 * platform reports its workspace file changed. Once per editor; returns the
 * unsubscribe (the platform also unsubscribes when the editor is disposed).
 */
export function followWorkspaceFile(host: WorkspaceEditorHost): () => void {
  const known = following.get(host);
  if (known) return known;
  const off = host.workspace.onWorkspaceFileChanged(({ path }) => {
    const ctx = host.context as WorkspaceEditorContext;
    if (path !== (host.state.path ?? ctx.path)) return;
    void reloadEditorFromDisk(host).catch(() => undefined);
  });
  const stop = () => {
    following.delete(host);
    off();
  };
  following.set(host, stop);
  return stop;
}

/** The repositories (by name) `before` lists and `after` does not. */
function droppedRepos(before: WorkspaceFileData | undefined, after: WorkspaceFileData): string[] {
  const names = (d: WorkspaceFileData | undefined) =>
    new Set(
      (d?.repos ?? []).flatMap((r) => (validateRepoUrl(r.url) ? [] : [deriveRepoName(r.url)])),
    );
  const kept = names(after);
  return [...names(before)].filter((name) => !kept.has(name));
}

/**
 * Persist the edited data back to the file. Repositories the save dropped are
 * then deleted from disk (the platform asks first for each); a failed delete
 * is shown, a declined one leaves the clone for the platform's cleanup.
 */
export async function saveEditorState(host: WorkspaceEditorHost): Promise<void> {
  const ctx = host.context as WorkspaceEditorContext;
  const { path, data, savedData } = host.state;
  const dir = host.state.dir ?? ctx.dir ?? "";
  if (!data || !path || !dir) return;
  try {
    const result = (await host.dispatch("write", { dir, path, data })) as {
      ok?: boolean;
      error?: string;
    };
    const ok = !!result?.ok;
    host.setState((prev) => ({
      ...prev,
      saved: ok,
      error: result?.error,
      savedData: ok ? prev.data : prev.savedData,
      // A successful save re-locks the lockable fields (the workspace name).
      nameLocked: ok ? true : prev.nameLocked,
    }));
    if (!ok) return;
    const failures: string[] = [];
    for (const repoName of droppedRepos(savedData, data)) {
      const deleted = await host.workspace.deleteRepository(repoName, path);
      if (!deleted.ok && !deleted.cancelled) {
        failures.push(`${repoName} was not deleted: ${deleted.error ?? "unknown error"}`);
      }
    }
    if (failures.length > 0) host.setState((prev) => ({ ...prev, error: failures.join("\n") }));
  } catch (err) {
    host.setState((prev) => ({
      ...prev,
      saved: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

/**
 * Clone a repo added to (or re-pointed in) the workspace being edited. The
 * platform owns clones: it clones into that workspace's repositories (named
 * by the edited file's path, which need not be the window's workspace), so
 * this asks it to and tracks the result in the view-local `cloneStates`.
 */
export function startRepoClone(host: WorkspaceEditorHost, url: string): void {
  const setCloneState = (state: RepoCloneState): void =>
    host.setState((prev) => ({
      ...prev,
      cloneStates: { ...(prev.cloneStates ?? {}), [url]: state },
    }));
  setCloneState({ phase: "cloning" });
  void host.workspace
    .cloneRepository(url, host.state.path)
    .done.then((res) =>
      setCloneState(res.ok ? { phase: "done" } : { phase: "failed", error: res.error }),
    );
}

/** Restore the most recent data edit (per-tab undo history). */
export function undoEditorState(host: WorkspaceEditorHost): void {
  host.setState((prev) => {
    const undoStack = [...(prev.undoStack ?? [])];
    const data = undoStack.pop();
    if (data == null) return prev;
    return { ...prev, data, undoStack, saved: data === prev.savedData };
  });
}

/** Show the host app's confirmation dialog and resolve true when the user
 *  confirms. Confirmations are native dialog windows owned by the platform
 *  (main process); they are requested through the preload bridge exposed as
 *  `window.openp41ge.confirm.show`. */
async function confirmRemoveRepo(url: string): Promise<boolean> {
  const bridge = (
    window as unknown as {
      openp41ge?: {
        confirm?: { show: (o: Record<string, unknown>) => Promise<{ confirmed: boolean }> };
      };
    }
  ).openp41ge?.confirm;
  if (!bridge) return false;
  try {
    const result = await bridge.show({
      title: "Remove repository",
      message: `Remove repository "${url}" from this workspace?`,
      detail:
        "When you save, its clone and worktrees are deleted from disk. " +
        "You will be asked again then, with any work not saved elsewhere.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      confirmStyle: "danger",
    });
    return !!result?.confirmed;
  } catch {
    return false;
  }
}

/**
 * Re-point the view-local per-repo state (open sections, inline edits) after
 * repos are removed or reordered. `map` gives a repo's new index, or null
 * when it is gone — state belonging to a gone repo is dropped.
 */
function remapRepoIndices(
  prev: WorkspaceEditorState,
  map: (index: number) => number | null,
): Partial<WorkspaceEditorState> {
  const openRepos = (prev.openRepos ?? []).flatMap((i) => {
    const n = map(i);
    return n == null ? [] : [n];
  });
  const editingRepo = prev.editingRepo == null ? null : map(prev.editingRepo);
  const wt = prev.editingWorktree ?? null;
  const wtRepo = wt ? map(wt.repo) : null;
  const add = prev.addingWorktree ?? null;
  const addRepo = add ? map(add.repo) : null;
  return {
    openRepos,
    editingRepo,
    editingValue: editingRepo == null ? null : prev.editingValue,
    editingWorktree: wt && wtRepo != null ? { ...wt, repo: wtRepo } : null,
    editingWorktreeValue: wt && wtRepo != null ? prev.editingWorktreeValue : null,
    addingWorktree: add && addRepo != null ? { ...add, repo: addRepo } : null,
  };
}

/** Confirm and then remove the repo at index `i`. The confirmation does NOT
 *  save — the user must still press Save. `confirm` is injectable so tests can
 *  drive this without mounting the host's modal. Returns true when the repo
 *  was removed. */
export function removeRepo(
  host: WorkspaceEditorHost,
  i: number,
  confirm: (url: string) => Promise<boolean> = confirmRemoveRepo,
): Promise<boolean> {
  const url = host.state.data?.repos?.[i]?.url ?? "";
  return confirm(url).then((confirmed) => {
    if (!confirmed) return false;
    host.setState((prev) => {
      if (!prev.data) return prev;
      const repos = prev.data.repos ?? [];
      const data = migrateWorkspaceFileData({
        ...prev.data,
        repos: repos.filter((_, idx) => idx !== i),
      });
      const undoStack = [...(prev.undoStack ?? []), prev.data].slice(-MAX_UNDO);
      return {
        ...prev,
        data,
        undoStack,
        saved: data === prev.savedData,
        ...remapRepoIndices(prev, (idx) => (idx === i ? null : idx > i ? idx - 1 : idx)),
      };
    });
    return true;
  });
}

/** Render the workspace editor surface. */
export function renderWorkspaceEditor(host: WorkspaceEditorHost): TemplateResult {
  installSurfaceShortcuts();
  const ctx = host.context as WorkspaceEditorContext;
  const uninitialized = !("loading" in host.state);
  if (uninitialized) {
    const path = ctx.path ?? "";
    const dir = ctx.dir ?? "";
    // Kick off the async read once. setState during render is unsafe, so we
    // defer via microtask; the host repaints with the loaded state.
    queueMicrotask(() => loadEditorState(host, path, dir));
    followWorkspaceFile(host);
    return html`<div class="we-note">Loading…</div>`;
  }

  const { mode, loading, saved, error } = host.state;
  const data = host.state.data;
  const loaded = !loading && !!data;

  const toggleView = (): void => {
    const next = mode === "json" ? "ui" : "json";
    host.setState((prev) => ({ ...prev, mode: next }));
  };

  // Cmd/Ctrl+S while the editor is focused saves the workspace file.
  // Cmd/Ctrl+S save and Cmd/Ctrl+Z undo are handled by the global
  // document-level shortcut listener (see `installSurfaceShortcuts`), which
  // works even when focus leaves the surface (e.g. after a row is removed).

  // Buttons registered into the bottom bar component.
  const barButtons: WorkspaceBottomBarButton[] = [
    {
      id: "toggle-view",
      icon: JSON_ICON,
      title: mode === "json" ? "Switch to UI view" : "Switch to JSON view",
      onClick: toggleView,
      disabled: !loaded,
      // Lit the JSON icon in the accent while the JSON editor is active.
      highlight: loaded && mode === "json",
    },
    {
      id: "save",
      icon: SAVE_ICON,
      title: "Save",
      onClick: () => saveEditorState(host),
      disabled: !loaded,
      highlight: loaded && !saved,
    },
  ];

  return html`
    <style>
      .we-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        font-family: inherit;
        overflow: hidden;
        background: var(--bg-primary, #161616);
      }
      .we-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      /* The first content row: the editor's buttons (Open first). */
      .we-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 12px 12px 0;
        flex-shrink: 0;
      }
      .we-toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        height: 26px;
        padding: 0 14px;
        font: inherit;
        font-size: 12px;
        color: var(--text-primary, #d4d4d4);
        border: 1px solid var(--divider, #333);
        border-radius: 0;
        background: transparent;
        cursor: pointer;
      }
      .we-toolbar-btn:hover {
        background: var(--bg-active, #37373d);
      }
      .we-toolbar-btn span {
        display: inline-flex;
      }
      .we-toolbar-btn svg {
        display: block;
        width: 14px;
        height: 14px;
      }
      .we-toolbar + .we-json {
        margin-top: 12px;
      }
      .we-note {
        padding: 12px;
        font-size: 12px;
        color: var(--text-secondary, #999);
      }
      .we-error {
        padding: 4px 12px;
        font-size: 11px;
        color: var(--danger, #f44336);
        background: rgba(244, 67, 54, 0.08);
        border-top: 1px solid var(--border-divider, #2a2a2a);
        flex-shrink: 0;
      }
      .we-json {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .we-json > json-editor {
        flex: 1;
        min-height: 0;
      }
      .we-ui {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
      }
      .we-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .we-field > span {
        font-size: 11px;
        color: var(--text-secondary, #999);
      }
      .we-input {
        background: var(--bg-tertiary, #2a2a2a);
        border: 1px solid var(--border-divider, #333);
        color: var(--text, #ddd);
        border-radius: 4px;
        padding: 5px 8px;
        font-size: 12px;
        font-family: inherit;
        box-sizing: border-box;
      }
      .we-input:focus {
        outline: none;
        border-color: var(--accent, #569cd6);
      }
      .we-card {
        background: var(--bg-tertiary, #222);
        border: 1px solid var(--border-divider, #333);
        border-radius: 6px;
        box-sizing: border-box;
        overflow: hidden;
      }
      .we-card--detached {
        border-color: var(--border-divider, #333);
      }
      /* The repositories accordion: each git-repo URL is a flush segment.
         Collapsed, all segments sit in one card; the open segment DETACHES
         into its own accent card, splitting the remaining segments into
         separate cards around it (first→2 cards; middle→3; last→3, where the
         bottom card is the ＋ Add repository row). An open segment reveals its
         worktrees as a sub-list. Delete (✕) buttons sit INSIDE at the end of
         each row. */
      .we-card > .we-seg {
        border-top: 1px solid var(--border-divider, #2a2a2a);
      }
      .we-card > .we-seg:first-child {
        border-top: none;
      }
      .we-seg {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }
      .we-seg--open {
        background: transparent;
      }
      .we-seg-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        cursor: pointer;
        user-select: none;
      }
      .we-seg-head:hover {
        background: var(--bg-tertiary, #2a2a2a);
      }
      .we-seg--add .we-seg-head {
        cursor: default;
      }
      .we-seg--add .we-seg-head:hover {
        background: transparent;
      }
      .we-seg--add .we-card-main {
        padding-left: 22px;
      }
      .we-card-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .we-card-main .we-input {
        width: 100%;
        box-sizing: border-box;
      }
      .we-card-name {
        font-size: 13px;
        line-height: 18px;
        color: var(--text, #ddd);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .we-card-meta {
        font-size: 11px;
        color: var(--text-secondary, #999);
      }
      .we-card-url {
        font-size: 11px;
        line-height: 15px;
        color: var(--text-secondary, #999);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .we-repo-error {
        font-size: 11px;
        color: #f44336;
      }
      .we-seg--invalid .we-card-name,
      .we-seg--invalid .we-card-url {
        color: #f44336;
      }
      .we-clone-status {
        font-style: italic;
        margin-left: 8px;
        position: relative;
      }
      .we-clone-status--live {
        color: var(--text-secondary, #999);
      }
      .we-clone-status:not(.we-clone-status--live) {
        color: #c98a4b;
      }
      /* Hover tooltip showing the underlying clone error ("inline modal"). */
      .we-clone-tip {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 30;
        display: none;
        width: max-content;
        max-width: 340px;
        max-height: 160px;
        overflow: auto;
        padding: 6px 8px;
        border: 1px solid #4a4a4a;
        border-radius: 4px;
        background: #1c1c1c;
        color: #d8d8d8;
        font-style: normal;
        font-weight: 400;
        font-size: 11px;
        line-height: 1.4;
        white-space: normal;
        word-break: break-word;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
      }
      .we-clone-status:hover .we-clone-tip {
        display: block;
      }
      .we-dots {
        display: inline-block;
        margin-left: 1px;
      }
      .we-dot {
        display: inline-block;
        opacity: 0;
        animation: weDot 1.4s infinite;
      }
      .we-dot::before {
        content: ".";
      }
      .we-dot:nth-child(2) {
        animation-delay: 0.18s;
      }
      .we-dot:nth-child(3) {
        animation-delay: 0.36s;
      }
      @keyframes weDot {
        0%,
        50%,
        100% {
          opacity: 0;
        }
        30% {
          opacity: 1;
        }
      }
      .we-chev {
        align-self: flex-start;
        flex-shrink: 0;
        width: 14px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary, #999);
        font-size: 12px;
        transition: transform 0.15s ease;
      }
      .we-seg--open .we-chev {
        transform: rotate(90deg);
      }
      .we-card-x {
        flex-shrink: 0;
        box-sizing: border-box;
        padding: 0;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #3a3a3a;
        border: none;
        color: var(--text-secondary, #999);
        border-radius: 4px;
        cursor: pointer;
        transition:
          color 0.12s ease,
          background-color 0.12s ease;
      }
      .we-card-x svg {
        width: 17px;
        height: 17px;
      }
      .we-card-x:hover {
        background: #4a2f2f;
        color: #f44336;
      }
      .we-card-edit {
        flex-shrink: 0;
        box-sizing: border-box;
        padding: 0;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #3a3a3a;
        border: none;
        color: var(--text-secondary, #999);
        border-radius: 4px;
        cursor: pointer;
        transition:
          color 0.12s ease,
          background-color 0.12s ease;
      }
      .we-card-edit svg {
        width: 14px;
        height: 14px;
      }
      .we-card-edit:hover {
        background: #2e404f;
        color: #569cd6;
      }
      .we-card-edit--active {
        background: #2e404f;
        color: #569cd6;
      }
      .we-reorder {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
      }
      .we-reorder-btn {
        flex-shrink: 0;
        box-sizing: border-box;
        padding: 0;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #3a3a3a;
        border: none;
        color: var(--text-secondary, #999);
        border-radius: 4px;
        cursor: pointer;
        transition:
          color 0.12s ease,
          background-color 0.12s ease,
          opacity 0.12s ease;
      }
      .we-reorder-btn svg {
        width: 14px;
        height: 14px;
      }
      .we-reorder-btn:hover:not([disabled]) {
        background: #2e404f;
        color: #569cd6;
      }
      .we-reorder-btn[disabled] {
        opacity: 0.35;
        cursor: default;
      }
      .we-inline {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        max-width: 100%;
        font-size: 13px;
        color: var(--text, #ddd);
        height: 18px;
        line-height: 18px;
      }
      .we-inline-field {
        position: relative;
        display: inline-block;
        margin-right: 8px;
      }
      .we-inline-mirror {
        visibility: hidden;
        white-space: pre;
        font: inherit;
        color: var(--text, #ddd);
      }
      .we-inline-input {
        position: absolute;
        inset: 0;
        width: 100%;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        color: var(--text, #ddd);
        outline: none;
      }
      .we-inline-btn {
        flex-shrink: 0;
        box-sizing: border-box;
        padding: 0;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #3a3a3a;
        border: none;
        color: var(--text-secondary, #999);
        cursor: pointer;
        border-radius: 4px;
        transition:
          color 0.12s ease,
          background-color 0.12s ease;
      }
      .we-inline-btn svg {
        width: 17px;
        height: 17px;
      }
      .we-inline-btn--ok:hover {
        color: #4caf50;
        background: #2f4a34;
      }
      .we-inline-btn--no:hover {
        color: #f44336;
        background: #4a2f2f;
      }
      .we-seg-body {
        display: flex;
        flex-direction: column;
        padding: 2px 8px 4px 26px;
      }
      .we-seg-body .we-input {
        flex: 1;
        width: 100%;
        box-sizing: border-box;
      }
      .we-tree-row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        box-sizing: border-box;
        min-height: 26px;
        padding-left: 22px;
      }
      .we-tree-row::before {
        content: "";
        position: absolute;
        left: 9px;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--text-secondary, #999);
      }
      .we-tree-row::after {
        content: "";
        position: absolute;
        left: 9px;
        top: 13px;
        width: 11px;
        height: 1px;
        background: var(--text-secondary, #999);
      }
      .we-tree-row--last::before {
        bottom: 50%;
      }
      .we-tree-main {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
      }
      .we-tree-name {
        font-size: 13px;
        line-height: 18px;
        color: var(--text, #ddd);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .we-name-text {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        line-height: 18px;
        color: var(--text, #ddd);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .we-name-card {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        background: var(--bg-tertiary, #222);
        border: 1px solid var(--border-divider, #333);
        border-radius: 4px;
        padding: 3px 8px;
        box-sizing: border-box;
      }
      .we-name-card--hidden {
        background: transparent;
        border-color: transparent;
      }
      .we-name-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--text, #ddd);
        font-size: 13px;
        font-family: inherit;
        padding: 0;
      }
      .we-lock-btn {
        flex-shrink: 0;
        box-sizing: border-box;
        padding: 0;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.12s ease;
      }
      .we-lock-btn svg {
        width: 16px;
        height: 16px;
        display: block;
      }
      .we-lock-btn--locked {
        background: #3a3a3a;
      }
      .we-lock-btn--locked:hover {
        background: #464646;
      }
      .we-lock-btn--unlocked {
        background: #2e404f;
      }
      .we-lock-btn--unlocked:hover {
        background: #38566f;
      }
      .we-seg-body .we-tree-row .we-reorder {
        margin-left: auto;
      }
      .we-seg-body .we-card-addrow {
        border-top: none;
        padding-left: 9px;
        gap: 0;
        margin-top: 6px;
      }
      .we-card-addrow {
        width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 0;
        padding: 6px 8px;
        background: transparent;
        border: none;
        border-top: 1px solid var(--border-divider, #2a2a2a);
        color: var(--text-secondary, #999);
        font-size: 11px;
        cursor: pointer;
      }
      .we-card-addrow:hover {
        background: var(--bg-tertiary, #2a2a2a);
        color: var(--text, #ddd);
      }
      .we-addplus {
        flex-shrink: 0;
      }
      .we-card > .we-card-addrow {
        gap: 8px;
      }
      .we-card > .we-card-addrow .we-addplus {
        width: 14px;
        text-align: center;
      }
      .we-seg-body .we-addplus {
        width: 13px;
        text-align: center;
        transform: translateX(-6.5px);
      }
      .we-card > .we-card-addrow:first-child,
      .we-card > .we-addseg:first-child {
        border-top: none;
      }
      .we-addseg {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-top: 1px solid var(--border-divider, #2a2a2a);
        box-sizing: border-box;
      }
      .we-addseg .we-input {
        flex: 1;
      }
      .we-btn {
        background: transparent;
        border: 1px solid var(--border-divider, #2a2a2a);
        color: var(--text, #ddd);
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 11px;
        cursor: pointer;
      }
      .we-btn:hover {
        background: var(--bg-tertiary, #2a2a2a);
      }
      .we-btn--icon {
        padding: 0 4px;
        font-size: 12px;
      }
      .we-btn--add {
        align-self: flex-start;
      }
    </style>
    <div class="we-root" ${surfaceRoot(host)}>
      <div class="we-body">
        ${
          loading
            ? html`<div class="we-note">Loading…</div>`
            : !data
              ? html`<div class="we-note">${error ?? "Unable to load workspace file."}</div>`
              : html`${renderToolbar(host)}${mode === "json" ? renderJsonView(host) : renderUiView(host)}`
        }
        ${error && loaded ? html`<div class="we-error">${error}</div>` : nothing}
      </div>
      <we-bottom-bar .buttons=${barButtons}></we-bottom-bar>
    </div>
  `;

  function renderToolbar(h: WorkspaceEditorHost): TemplateResult {
    return html`
      <div class="we-toolbar">
        <button
          type="button"
          class="we-toolbar-btn"
          data-action="open-window"
          @click=${() => h.workspace.openWindow(h.state.path)}
        >
          <span .innerHTML=${OPEN_ICON}></span>Open
        </button>
      </div>
    `;
  }

  function renderJsonView(h: WorkspaceEditorHost): TemplateResult {
    const data = h.state.data!;
    return html`
      <div class="we-json">
        <json-editor
          .value=${editableView(data)}
          .schema=${WORKSPACE_FILE_SCHEMA}
          @json-editor-change=${(e: CustomEvent) => {
            const value = (e.detail as { value: unknown }).value ?? {};
            // Only the editable fields may come back from the JSON view; merge
            // them onto the preserved full data so platform-owned metadata and
            // session state survive the round-trip.
            h.setState((prev) => {
              if (!prev.data) return prev;
              // Only the editable fields may come back from the JSON view; merge
              // them onto the preserved full data so platform-owned metadata and
              // session state survive the round-trip.
              const editable = mergeEditableFields(prev.data, value as Record<string, unknown>);
              const data = migrateWorkspaceFileData({ ...prev.data, ...editable });
              const undoStack = [...(prev.undoStack ?? []), prev.data].slice(-MAX_UNDO);
              return { ...prev, data, undoStack, saved: data === prev.savedData };
            });
          }}
        ></json-editor>
      </div>
    `;
  }

  function renderUiView(h: WorkspaceEditorHost): TemplateResult {
    const d = h.state.data!;
    const setData = (patch: Partial<WorkspaceFileData>): void => {
      h.setState((prev) => {
        if (!prev.data) return prev;
        const data = migrateWorkspaceFileData({ ...prev.data, ...patch });
        const undoStack = [...(prev.undoStack ?? []), prev.data].slice(-MAX_UNDO);
        return { ...prev, data, undoStack, saved: data === prev.savedData };
      });
    };
    // View-local UI state (never persisted): which accordion segment is
    // expanded (detached, revealing its worktrees), and whether the add-row
    // inputs are showing.
    const setUi = (
      patch: Partial<
        Pick<
          WorkspaceEditorState,
          | "openRepos"
          | "editingRepo"
          | "editingValue"
          | "editingWorktree"
          | "editingWorktreeValue"
          | "addingRepoValue"
          | "addingWorktree"
          | "nameLocked"
          | "repoError"
        >
      >,
    ): void => h.setState((prev) => ({ ...prev, ...patch }));
    // Record a repo's live clone status (merges by URL, never persisted).
    const cloneStates = h.state.cloneStates ?? {};

    const repos = d.repos ?? [];
    const openRepos = h.state.openRepos ?? [];
    const editingRepo = h.state.editingRepo ?? null;
    const editingValue = h.state.editingValue ?? "";
    const editingWorktree = h.state.editingWorktree ?? null;
    const editingWorktreeValue = h.state.editingWorktreeValue ?? "";
    const addingRepoValue = h.state.addingRepoValue ?? "";
    const repoError = h.state.repoError ?? null;
    /** Why `url` cannot be added (or set at `except`): not a full clone URL, or
     *  a repo already in the workspace (each repo is held once). */
    const rejectRepoUrl = (url: string, except?: number): string | null =>
      validateRepoUrl(url) ??
      (findRepoByName(repos, url, except) === -1
        ? null
        : `${deriveRepoName(url)} is already in this workspace`);
    const addingWorktree = h.state.addingWorktree ?? null;
    /** What is typed in repo `i`'s add-worktree input. */
    const addingWorktreeValueOf = (i: number): string =>
      addingWorktree?.repo === i ? addingWorktree.value : "";
    const nameLocked = h.state.nameLocked ?? true;

    // Accordion: repo remove/commit. Remove is guarded by a confirmation modal
    // (UI view only); the confirmation does not save — the user still must
    // press Save. The exported `removeRepo` applies the removal on confirm.
    const removeRepoHandler = (i: number): void => {
      void removeRepo(h, i);
    };
    const updateRepoUrl = (i: number, url: string): void =>
      setData({ repos: repos.map((r, idx) => (idx === i ? { ...r, url } : r)) });
    // Move a repo one slot up/down, keeping the open/edit indices in sync.
    const shiftIndex = (idx: number, i: number, j: number): number => {
      if (idx === i) return j;
      if (idx === j) return i;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      return idx > lo && idx < hi ? idx + (j > i ? -1 : 1) : idx;
    };
    const moveRepo = (i: number, delta: number): void => {
      const j = i + delta;
      if (j < 0 || j >= repos.length) return;
      const next = [...repos];
      const [moved] = next.splice(i, 1);
      next.splice(j, 0, moved);
      setData({ repos: next });
      h.setState((prev) => ({
        ...prev,
        ...remapRepoIndices(prev, (idx) => shiftIndex(idx, i, j)),
      }));
    };
    const startEdit = (i: number): void =>
      setUi({ editingRepo: i, editingValue: repos[i]?.url ?? "" });
    const commitEdit = (): void => {
      if (editingRepo != null) {
        const url = (editingValue ?? "").trim();
        const rejected = url ? rejectRepoUrl(url, editingRepo) : null;
        if (rejected) {
          setUi({ repoError: { at: editingRepo, message: rejected } });
          return;
        }
        if (url && url !== repos[editingRepo]?.url) {
          updateRepoUrl(editingRepo, url);
          // A new URL is a new repo: clone it now, as when one is added.
          startClone(url);
        }
      }
      setUi({ editingRepo: null, editingValue: null, repoError: null });
    };
    const cancelEdit = (): void =>
      setUi({ editingRepo: null, editingValue: null, repoError: null });
    // Cancel on click-away (mousedown outside the inline editor).
    if (editingRepo != null || editingWorktree != null)
      installInlineAwayCancel(() => {
        if (editingRepo != null) cancelEdit();
        if (editingWorktree != null) cancelEditWorktree();
      });
    else uninstallInlineAwayCancel();

    // A repo's worktree section: add / remove / reorder / rename worktrees.
    // Several repos can be open at once, so each action names its repo `ri`.
    const commitAddWorktree = (): void => {
      const wt = (addingWorktree?.value ?? "").trim();
      const ri = addingWorktree?.repo;
      if (ri != null && wt) {
        setData({
          repos: repos.map((r, idx) =>
            idx === ri ? { ...r, worktrees: [...(r.worktrees ?? []), wt] } : r,
          ),
        });
      }
      setUi({ addingWorktree: null });
    };
    const cancelWorktree = (): void => setUi({ addingWorktree: null });
    // Kick off a background clone of a newly-added repo into the workspace
    // data dir. The repo stays in the list regardless of the outcome; the row
    // shows the live clone progress / a "clone failed" marker.
    const startClone = (url: string): void => startRepoClone(h, url);
    const commitAddRepo = (): void => {
      const url = (addingRepoValue ?? "").trim();
      const rejected = url ? rejectRepoUrl(url) : null;
      if (rejected) {
        setUi({ repoError: { at: "add", message: rejected } });
        return;
      }
      if (url) {
        setData({ repos: [...repos, { url, worktrees: [] }] });
        startClone(url);
      }
      setUi({ addingRepoValue: "", repoError: null });
    };
    const cancelAddRepo = (): void => setUi({ addingRepoValue: "", repoError: null });
    const setWorktrees = (ri: number, worktrees: string[]): void =>
      setData({ repos: repos.map((r, idx) => (idx === ri ? { ...r, worktrees } : r)) });
    const removeWorktree = (ri: number, wi: number): void => {
      setWorktrees(
        ri,
        (repos[ri]?.worktrees ?? []).filter((_, k) => k !== wi),
      );
      if (editingWorktree?.repo !== ri) return;
      if (editingWorktree.index === wi)
        setUi({ editingWorktree: null, editingWorktreeValue: null });
      else if (editingWorktree.index > wi)
        setUi({ editingWorktree: { repo: ri, index: editingWorktree.index - 1 } });
    };
    const moveWorktree = (ri: number, wi: number, delta: number): void => {
      const wts = repos[ri]?.worktrees ?? [];
      const j = wi + delta;
      if (j < 0 || j >= wts.length) return;
      const next = [...wts];
      const [moved] = next.splice(wi, 1);
      next.splice(j, 0, moved);
      setWorktrees(ri, next);
      if (editingWorktree?.repo === ri)
        setUi({ editingWorktree: { repo: ri, index: shiftIndex(editingWorktree.index, wi, j) } });
    };
    const startEditWorktree = (ri: number, wi: number): void =>
      setUi({
        editingWorktree: { repo: ri, index: wi },
        editingWorktreeValue: (repos[ri]?.worktrees ?? [])[wi] ?? "",
      });
    const commitEditWorktree = (): void => {
      if (editingWorktree != null) {
        const val = (editingWorktreeValue ?? "").trim();
        const { repo: ri, index: wi } = editingWorktree;
        if (val)
          setWorktrees(
            ri,
            (repos[ri]?.worktrees ?? []).map((w, k) => (k === wi ? val : w)),
          );
      }
      setUi({ editingWorktree: null, editingWorktreeValue: null });
    };
    const cancelEditWorktree = (): void =>
      setUi({ editingWorktree: null, editingWorktreeValue: null });

    const segNode = (r: WorkspaceRepo, i: number) => {
      const open = openRepos.includes(i);
      const wtCount = r.worktrees?.length ?? 0;
      const cs = cloneStates[r.url];
      // An entry that is not a clone URL (e.g. written by an older version)
      // is never cloned: say so, so it does not look like a repo that
      // silently fails. Editing the URL fixes it.
      const invalidUrl = editingRepo === i ? null : validateRepoUrl(r.url ?? "");
      const cloneStatus =
        cs?.phase === "cloning"
          ? { label: "Cloning repository", live: true, error: "" }
          : cs?.phase === "failed"
            ? { label: "Clone failed", live: false, error: cs.error ?? "" }
            : null;
      return html`
        <div class="we-seg ${open ? "we-seg--open" : ""} ${invalidUrl ? "we-seg--invalid" : ""}">
          <div
            class="we-seg-head"
            @click=${() =>
              setUi({ openRepos: open ? openRepos.filter((x) => x !== i) : [...openRepos, i] })}
          >
            <span class="we-chev">›</span>
            <div class="we-card-main">
              ${
                editingRepo === i
                  ? html`
                      <span class="we-inline">
                        <span class="we-inline-field">
                          <span class="we-inline-mirror">${editingValue}</span>
                          <input
                            type="text"
                            class="we-inline-input"
                            .value=${editingValue}
                            ${autofocus()}
                            @input=${(e: InputEvent) =>
                              setUi({
                                editingValue: (e.target as HTMLInputElement).value,
                                repoError: null,
                              })}
                            @keydown=${(e: KeyboardEvent) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit();
                              } else if (e.key === "Escape") {
                                cancelEdit();
                              }
                            }}
                          />
                        </span>
                        <button
                          type="button"
                          class="we-inline-btn we-inline-btn--ok"
                          title="Confirm"
                          @mousedown=${(e: MouseEvent) => e.preventDefault()}
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            commitEdit();
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            height="24"
                            viewBox="0 -960 960 960"
                            width="24"
                            fill="currentColor"
                          >
                            <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="we-inline-btn we-inline-btn--no"
                          title="Cancel"
                          @mousedown=${(e: MouseEvent) => e.preventDefault()}
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            height="24"
                            viewBox="0 -960 960 960"
                            width="24"
                            fill="currentColor"
                          >
                            <path
                              d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                            />
                          </svg>
                        </button>
                      </span>
                    `
                  : html`<div class="we-card-name">
                        ${r.url ? deriveRepoName(r.url) : "(unset)"}
                      </div>
                      ${r.url ? html`<div class="we-card-url">${r.url}</div>` : nothing}`
              }
              ${
                repoError && repoError.at === i
                  ? html`<div class="we-repo-error">${repoError.message}</div>`
                  : invalidUrl
                    ? html`<div class="we-repo-error" data-invalid-url>
                        Not a clone URL, so it is not cloned. ${invalidUrl}
                      </div>`
                    : nothing
              }
              <div class="we-card-meta">
                ${wtCount}
                worktree${wtCount === 1 ? "" : "s"}${
                  cloneStatus
                    ? html`<span
                        class="we-clone-status${cloneStatus.live ? " we-clone-status--live" : ""}"
                        >${cloneStatus.label}${
                          cloneStatus.live
                            ? html`<span class="we-dots" aria-hidden="true"
                                ><span class="we-dot"></span><span class="we-dot"></span
                                ><span class="we-dot"></span
                              ></span>`
                            : nothing
                        }${
                          cloneStatus.error
                            ? html`<span class="we-clone-tip" role="tooltip"
                                >${cloneStatus.error}</span
                              >`
                            : nothing
                        }</span
                      >`
                    : nothing
                }
              </div>
            </div>
            <div class="we-reorder">
              <button
                type="button"
                class="we-reorder-btn"
                title="Move up"
                ?disabled=${i === 0}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  moveRepo(i, -1);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="24"
                  viewBox="0 -960 960 960"
                  width="24"
                  fill="currentColor"
                >
                  <path d="M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z" />
                </svg>
              </button>
              <button
                type="button"
                class="we-reorder-btn"
                title="Move down"
                ?disabled=${i === repos.length - 1}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  moveRepo(i, 1);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="24"
                  viewBox="0 -960 960 960"
                  width="24"
                  fill="currentColor"
                >
                  <path d="M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              class="we-card-edit ${editingRepo === i ? "we-card-edit--active" : ""}"
              title="Edit repository URL"
              @click=${(e: Event) => {
                e.stopPropagation();
                startEdit(i);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24"
                viewBox="0 -960 960 960"
                width="24"
                fill="currentColor"
              >
                <path
                  d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"
                />
              </svg>
            </button>
            <button
              type="button"
              class="we-card-x"
              title="Remove repository"
              @click=${(e: Event) => {
                e.stopPropagation();
                removeRepoHandler(i);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="24"
                viewBox="0 -960 960 960"
                width="24"
                fill="currentColor"
              >
                <path
                  d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                />
              </svg>
            </button>
          </div>
          ${
            open
              ? html`
                  <div class="we-seg-body">
                    ${(r.worktrees ?? []).map((wt, wi) => {
                      const wts = r.worktrees ?? [];
                      const isLastWt = wi === wts.length - 1;
                      const editing = editingWorktree?.repo === i && editingWorktree.index === wi;
                      return html`
                        <div class="we-tree-row">
                          <div class="we-tree-main">
                            ${
                              editing
                                ? html`
                                    <span class="we-inline">
                                      <span class="we-inline-field">
                                        <span class="we-inline-mirror"
                                          >${editingWorktreeValue}</span
                                        >
                                        <input
                                          type="text"
                                          class="we-inline-input"
                                          .value=${editingWorktreeValue}
                                          ${autofocus()}
                                          @input=${(e: InputEvent) =>
                                            setUi({
                                              editingWorktreeValue: (e.target as HTMLInputElement)
                                                .value,
                                            })}
                                          @keydown=${(e: KeyboardEvent) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              commitEditWorktree();
                                            } else if (e.key === "Escape") {
                                              cancelEditWorktree();
                                            }
                                          }}
                                        />
                                      </span>
                                      <button
                                        type="button"
                                        class="we-inline-btn we-inline-btn--ok"
                                        title="Confirm"
                                        @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                        @click=${(e: Event) => {
                                          e.stopPropagation();
                                          commitEditWorktree();
                                        }}
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          height="24"
                                          viewBox="0 -960 960 960"
                                          width="24"
                                          fill="currentColor"
                                        >
                                          <path
                                            d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"
                                          />
                                        </svg>
                                      </button>
                                      <button
                                        type="button"
                                        class="we-inline-btn we-inline-btn--no"
                                        title="Cancel"
                                        @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                        @click=${(e: Event) => {
                                          e.stopPropagation();
                                          cancelEditWorktree();
                                        }}
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          height="24"
                                          viewBox="0 -960 960 960"
                                          width="24"
                                          fill="currentColor"
                                        >
                                          <path
                                            d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                                          />
                                        </svg>
                                      </button>
                                    </span>
                                  `
                                : html`<span class="we-tree-name">${wt}</span>`
                            }
                          </div>
                          <div class="we-reorder">
                            <button
                              type="button"
                              class="we-reorder-btn"
                              title="Move up"
                              ?disabled=${wi === 0}
                              @click=${(e: Event) => {
                                e.stopPropagation();
                                moveWorktree(i, wi, -1);
                              }}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                height="24"
                                viewBox="0 -960 960 960"
                                width="24"
                                fill="currentColor"
                              >
                                <path
                                  d="M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              class="we-reorder-btn"
                              title="Move down"
                              ?disabled=${isLastWt}
                              @click=${(e: Event) => {
                                e.stopPropagation();
                                moveWorktree(i, wi, 1);
                              }}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                height="24"
                                viewBox="0 -960 960 960"
                                width="24"
                                fill="currentColor"
                              >
                                <path
                                  d="M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z"
                                />
                              </svg>
                            </button>
                          </div>
                          <button
                            type="button"
                            class="we-card-edit"
                            title="Edit worktree branch"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              startEditWorktree(i, wi);
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              height="24"
                              viewBox="0 -960 960 960"
                              width="24"
                              fill="currentColor"
                            >
                              <path
                                d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            class="we-card-x"
                            title="Remove worktree"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              removeWorktree(i, wi);
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              height="24"
                              viewBox="0 -960 960 960"
                              width="24"
                              fill="currentColor"
                            >
                              <path
                                d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                              />
                            </svg>
                          </button>
                        </div>
                      `;
                    })}
                    <div class="we-tree-row we-tree-row--last">
                      <div class="we-tree-main">
                        <span class="we-inline">
                          <span class="we-inline-field">
                            <span class="we-inline-mirror"
                              >${addingWorktreeValueOf(i) || "worktree branch"}</span
                            >
                            <input
                              type="text"
                              class="we-inline-input"
                              placeholder="worktree branch"
                              .value=${addingWorktreeValueOf(i)}
                              @input=${(e: InputEvent) =>
                                setUi({
                                  addingWorktree: {
                                    repo: i,
                                    value: (e.target as HTMLInputElement).value,
                                  },
                                })}
                              @keydown=${(e: KeyboardEvent) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitAddWorktree();
                                } else if (e.key === "Escape") {
                                  cancelWorktree();
                                }
                              }}
                            />
                          </span>
                          ${
                            addingWorktreeValueOf(i)
                              ? html`
                                  <button
                                    type="button"
                                    class="we-inline-btn we-inline-btn--ok"
                                    title="Confirm"
                                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                    @click=${(e: Event) => {
                                      e.stopPropagation();
                                      commitAddWorktree();
                                    }}
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      height="24"
                                      viewBox="0 -960 960 960"
                                      width="24"
                                      fill="currentColor"
                                    >
                                      <path
                                        d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    class="we-inline-btn we-inline-btn--no"
                                    title="Cancel"
                                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                                    @click=${(e: Event) => {
                                      e.stopPropagation();
                                      cancelWorktree();
                                    }}
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      height="24"
                                      viewBox="0 -960 960 960"
                                      width="24"
                                      fill="currentColor"
                                    >
                                      <path
                                        d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                                      />
                                    </svg>
                                  </button>
                                `
                              : nothing
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                `
              : nothing
          }
        </div>
      `;
    };

    const addRepoNode = () => html`
      <div class="we-seg we-seg--add">
        <div class="we-seg-head">
          <div class="we-card-main">
            <span class="we-inline">
              <span class="we-inline-field">
                <span class="we-inline-mirror"
                  >${addingRepoValue || "git@github.com:org/repo.git"}</span
                >
                <input
                  type="text"
                  class="we-inline-input"
                  placeholder="git@github.com:org/repo.git"
                  .value=${addingRepoValue}
                  @input=${(e: InputEvent) =>
                    setUi({
                      addingRepoValue: (e.target as HTMLInputElement).value,
                      repoError: null,
                    })}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitAddRepo();
                    } else if (e.key === "Escape") {
                      cancelAddRepo();
                    }
                  }}
                />
              </span>
              ${
                addingRepoValue
                  ? html`
                      <button
                        type="button"
                        class="we-inline-btn we-inline-btn--ok"
                        title="Confirm"
                        @mousedown=${(e: MouseEvent) => e.preventDefault()}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          commitAddRepo();
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24"
                          viewBox="0 -960 960 960"
                          width="24"
                          fill="currentColor"
                        >
                          <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="we-inline-btn we-inline-btn--no"
                        title="Cancel"
                        @mousedown=${(e: MouseEvent) => e.preventDefault()}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          cancelAddRepo();
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24"
                          viewBox="0 -960 960 960"
                          width="24"
                          fill="currentColor"
                        >
                          <path
                            d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
                          />
                        </svg>
                      </button>
                    `
                  : nothing
              }
            </span>
            ${
              repoError?.at === "add"
                ? html`<div class="we-repo-error">${repoError.message}</div>`
                : html`<div class="we-card-meta">0 worktrees</div>`
            }
          </div>
        </div>
      </div>
    `;

    const card = (items: { r: WorkspaceRepo; i: number }[], trailing?: TemplateResult) => html`
      <div class="we-card">${items.map(({ r, i }) => segNode(r, i))} ${trailing ?? nothing}</div>
    `;

    // Each open repo is a detached card; runs of closed repos share a card,
    // and the add-repository row ends the last card.
    const cards: TemplateResult[] = [];
    let group: { r: WorkspaceRepo; i: number }[] = [];
    repos.forEach((r, i) => {
      if (!openRepos.includes(i)) {
        group.push({ r, i });
        return;
      }
      if (group.length) cards.push(card(group));
      group = [];
      cards.push(html`<div class="we-card we-card--detached">${segNode(r, i)}</div>`);
    });
    cards.push(card(group, addRepoNode()));

    return html`
      <div class="we-ui">
        <div class="we-field">
          <span>Name</span>
          <div class="we-name-card ${nameLocked ? "we-name-card--hidden" : ""}">
            ${
              nameLocked
                ? html`<span class="we-name-text">${d.name ?? "(unset)"}</span>`
                : html`
                    <input
                      type="text"
                      class="we-name-input"
                      .value=${d.name ?? ""}
                      ${autofocus()}
                      @input=${(e: InputEvent) =>
                        setData({ name: (e.target as HTMLInputElement).value })}
                    />
                  `
            }
            <button
              type="button"
              class="we-lock-btn ${nameLocked ? "we-lock-btn--locked" : "we-lock-btn--unlocked"}"
              title=${nameLocked ? "Unlock to edit the workspace name" : "Lock the workspace name"}
              aria-pressed=${nameLocked}
              @click=${() => setUi({ nameLocked: !nameLocked })}
            >
              ${
                nameLocked
                  ? html`<span .innerHTML=${LOCK_ICON}></span>`
                  : html`<span .innerHTML=${UNLOCK_ICON}></span>`
              }
            </button>
          </div>
        </div>
        <div class="we-field">
          <span>Repositories</span>
          ${cards}
        </div>
      </div>
    `;
  }
}
