/**
 * Window manager — Electron window creation, lifecycle, and helpers.
 *
 * Maintains the `openp41geWindows` map and provides helper functions
 * for window management that are reused across IPC handlers.
 */

import { app, BrowserWindow, screen } from "electron";
import { appTitle, keepWindowTitle } from "./app-title.js";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "openp41ge-core-logger";
import { showsState } from "./window-binding.js";
import { logsOpenInPlace } from "./logs-routing.js";
import { showConfirm } from "./confirm-dialog-manager.js";
import type { TabNameGenerator } from "../src/main/index.js";
import type { OperationDispatcher } from "../src/main/index.js";
import type { WorkspaceRegistry } from "../src/main/services/workspace-registry.js";

const log = createLogger("openp41ge", "window-manager");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

// ─── Window state ────────────────────────────────────────────────────────
export const openp41geWindows = new Map<string, BrowserWindow>();

// When the whole app quits (Cmd+Q) we preserve the workspace's open windows so
// reopening the workspace restores them. A single window closed by hand (no
// quit in flight) still removes that window from state.
let _appQuitting = false;

export function setAppQuitting(value: boolean): void {
  _appQuitting = value;
}

// ─── Window type / binding ───────────────────────────────────────────────

/**
 * Kinds of window the app can host. `workspace` windows are bound to a
 * `.openp41ge-workspace` file; `manager` windows list/open workspaces.
 * Not exhaustive — future window types register via a factory (see plan).
 */
export type Openp41geWindowType = "workspace" | "manager" | "logs";

/** Metadata describing a created window (its kind + workspace binding). */
export interface Openp41geWindowMeta {
  windowType: Openp41geWindowType;
  /** `.openp41ge-workspace` path the window is bound to (null for window-manager). */
  workspacePath: string | null;
  /** Initial tab to open in a window-manager window ("workspaces" | "settings"). */
  initialTab?: WindowManagerTab;
  /** A logs window's error to open on launch (an entry's `errorId`). */
  revealErrorId?: string;
}

/** Tabs the compact Window Manager window can open with. */
export type WindowManagerTab = "workspaces" | "settings" | "welcome" | "releases" | "cleanup";

/** Tracks the type/binding of every open window, keyed by window id. */
export const openp41geWindowMeta = new Map<string, Openp41geWindowMeta>();

/** Read the metadata for an open window id, or null if it isn't tracked. */
export function getWindowMeta(openp41geWinId: string): Openp41geWindowMeta | null {
  return openp41geWindowMeta.get(openp41geWinId) ?? null;
}

// ─── Module-level dispatcher reference (set during wiring) ───────────────
let _dispatcher: OperationDispatcher | null = null;
let _registry: WorkspaceRegistry | null = null;
let _tabNames: TabNameGenerator | null = null;

export function setDispatcher(d: OperationDispatcher): void {
  _dispatcher = d;
}

/** Provide the workspace registry so windows route state ops per binding. */
export function setRegistry(r: WorkspaceRegistry): void {
  _registry = r;
}

/** The id a live window is known by, or null. */
export function windowIdOf(win: BrowserWindow): string | null {
  for (const [id, bw] of openp41geWindows) if (bw === win) return id;
  return null;
}

/**
 * Give a live window a new id and binding (switching its workspace), then
 * reload it so its renderer starts over as that window.
 */
export function rebindWindow(
  win: BrowserWindow,
  newId: string,
  meta: Pick<Openp41geWindowMeta, "windowType" | "workspacePath">,
): void {
  const oldId = windowIdOf(win);
  if (oldId === null) return;
  openp41geWindows.delete(oldId);
  openp41geWindowMeta.delete(oldId);
  openp41geWindows.set(newId, win);
  openp41geWindowMeta.set(newId, {
    windowType: meta.windowType,
    workspacePath: meta.workspacePath,
  });
  log.info("window-rebind", { from: oldId, to: newId, workspacePath: meta.workspacePath });
  notifyOpenWindowsChanged();
  win.webContents.reload();
}

/** The id of the openp41ge window a webContents belongs to, or null. */
export function windowIdForSender(event: { sender: Electron.WebContents }): string | null {
  for (const [id, bw] of openp41geWindows) {
    if (bw.webContents === event.sender) return id;
  }
  return null;
}

/** The workspace path a webContents (window) is bound to, or null if unbound. */
export function workspacePathForSender(event: { sender: Electron.WebContents }): string | null {
  for (const [id, bw] of openp41geWindows) {
    if (bw.webContents === event.sender) {
      return openp41geWindowMeta.get(id)?.workspacePath ?? null;
    }
  }
  return null;
}

/** Resolve the dispatcher responsible for a workspace path (registry → default). */
export function resolveDispatcherFor(
  workspacePath: string | null | undefined,
): OperationDispatcher | null {
  if (workspacePath && _registry) {
    const d = _registry.get(workspacePath);
    if (d) return d;
  }
  return _dispatcher;
}

/** Resolve the dispatcher for the window that sent an IPC message. */
export function dispatcherForEvent(event: {
  sender: Electron.WebContents;
}): OperationDispatcher | null {
  return resolveDispatcherFor(workspacePathForSender(event));
}

/** Send a serialized state update to every window showing `workspacePath`'s
 *  state (null: the no-workspace state). */
export function broadcastToWorkspace(workspacePath: string | null, serialized: string): void {
  for (const [id, bw] of openp41geWindows) {
    if (bw.isDestroyed()) continue;
    const meta = openp41geWindowMeta.get(id);
    if (!meta || !showsState(meta, workspacePath)) continue;
    try {
      bw.webContents.send("openp41ge:state-update", serialized);
    } catch {
      // window might be closing
    }
  }
}

export function setTabNames(t: TabNameGenerator): void {
  _tabNames = t;
}

/** The app-data root windows are told about (set at start, see `_initPaths`). */
let _appDataDir = "";

export function setAppDataDir(dir: string): void {
  _appDataDir = dir;
}

// ─── Window creation ─────────────────────────────────────────────────────

/** True if `source` is the compact Window-Manager picker window. */
function sourceIsWindowManager(source?: BrowserWindow): boolean {
  if (!source || source.isDestroyed()) return false;
  for (const [id, bw] of openp41geWindows) {
    if (bw === source) return openp41geWindowMeta.get(id)?.windowType === "manager";
  }
  return false;
}

export function createOpenp41geWindow(
  openp41geWinId: string,
  isMaster: boolean,
  sourceWindow?: BrowserWindow,
  dropScreenX?: number,
  dropScreenY?: number,
  meta?: Partial<Openp41geWindowMeta>,
): void {
  const windowMeta: Openp41geWindowMeta = {
    windowType: meta?.windowType ?? "workspace",
    workspacePath: meta?.workspacePath ?? null,
    initialTab: meta?.initialTab,
    revealErrorId: meta?.revealErrorId,
  };

  // The Window Manager is a full-sized window (sidebar + main grid): it is
  // freely resizable and inherits the source window's size rather than being
  // capped to a compact picker width.
  const isWindowManager = windowMeta.windowType === "manager";
  // A workspace window opened from the Window Manager must not inherit the
  // picker's (possibly narrow) size — open it large, clamped to the work area.
  const fromWindowManager = !isWindowManager && sourceIsWindowManager(sourceWindow);

  // Inherit size from the source window, falling back to defaults.
  let width = 1280;
  let height = 860;
  if (sourceWindow && !sourceWindow.isDestroyed() && !fromWindowManager) {
    const bounds = sourceWindow.getBounds();
    width = bounds.width;
    height = bounds.height;
  }

  let display: ReturnType<typeof screen.getDisplayMatching> | undefined;
  if (fromWindowManager) {
    display = screen.getDisplayMatching(sourceWindow!.getBounds());
    const workArea = display.workArea;
    width = Math.min(1280, workArea.width);
    height = Math.min(860, workArea.height);
  }

  let x: number | undefined;
  let y: number | undefined;

  if (dropScreenX !== undefined && dropScreenY !== undefined) {
    // Position the window near the drop point, clamped to the work area
    const display = screen.getDisplayNearestPoint({ x: dropScreenX, y: dropScreenY });
    const workArea = display.workArea;

    // Try to align the top-left of the window near the drop point.
    // Clamp so the window doesn't overflow off the work area.
    let candidateX = dropScreenX - Math.round(width / 4);
    let candidateY = dropScreenY - Math.round(height / 4);

    x = Math.max(workArea.x, Math.min(candidateX, workArea.x + workArea.width - width));
    y = Math.max(workArea.y, Math.min(candidateY, workArea.y + workArea.height - height));
  } else if (fromWindowManager && display) {
    // Centre the freshly-opened workspace window on the Window Manager's display.
    const workArea = display.workArea;
    x = workArea.x + Math.round((workArea.width - width) / 2);
    y = workArea.y + Math.round((workArea.height - height) / 2);
  } else if (sourceWindow && !sourceWindow.isDestroyed()) {
    const bounds = sourceWindow.getBounds();
    x = bounds.x + 30;
    y = bounds.y + 30;
  } else {
    // No drop point and no source window to inherit from: open on whichever
    // display the cursor is currently on, rather than letting Electron default
    // to the primary/first screen.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = display.workArea;
    x = workArea.x + Math.round((workArea.width - width) / 2);
    y = workArea.y + Math.round((workArea.height - height) / 2);
  }

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 600,
    minHeight: 200,
    // The Window Manager has no native window chrome: it renders its own
    // close / minimize / fullscreen traffic lights. It is freely resizable
    // (no maxWidth cap) and can go fullscreen.
    ...(isWindowManager ? { frame: false } : {}),
    title: appTitle(app.isPackaged),
    ...(!isWindowManager ? { titleBarStyle: "hiddenInset" } : {}),
    // Match the app's dark surface so the areas exposed while the window
    // grows (native maximize animation, resize) never flash white.
    backgroundColor: "#161616",
    x,
    y,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  keepWindowTitle(win);
  const openp41geWinIdAtCreate = openp41geWinId;

  openp41geWindows.set(openp41geWinId, win);
  openp41geWindowMeta.set(openp41geWinId, windowMeta);

  log.info("window-create", {
    windowId: openp41geWinId,
    type: windowMeta.windowType,
    workspacePath: windowMeta.workspacePath,
    isDev,
  });

  // Tell any open Window Manager to refresh its "open windows" column.
  notifyOpenWindowsChanged();

  // The window's id and binding can change (switching its workspace), so the
  // handlers below read them when they run.
  win.webContents.on("did-finish-load", () => {
    const windowId = windowIdOf(win) ?? openp41geWinId;
    const meta = openp41geWindowMeta.get(windowId) ?? windowMeta;
    log.info("window-loaded", { windowId, type: meta.windowType });
    const d = resolveDispatcherFor(meta.workspacePath);
    if (d) {
      win.webContents.send("openp41ge:init", {
        windowId,
        workspace: JSON.stringify(d.getWorkspace()),
        isDev,
        windowType: meta.windowType,
        workspacePath: meta.workspacePath,
        initialTab: meta.initialTab,
        revealErrorId: meta.revealErrorId,
        dataDir: _appDataDir,
      });
    }
  });

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    log.warn("window-load-failed", { windowId: openp41geWinId, code, desc });
  });

  win.on("closed", () => {
    const openp41geWinId = windowIdOf(win) ?? openp41geWinIdAtCreate;
    const meta = openp41geWindowMeta.get(openp41geWinId);
    log.info("window-close", {
      windowId: openp41geWinId,
      type: meta?.windowType ?? "unknown",
    });
    openp41geWindows.delete(openp41geWinId);
    openp41geWindowMeta.delete(openp41geWinId);
    // Tell any open Window Manager to drop the closed window immediately.
    notifyOpenWindowsChanged();
    // Don't mutate workspace state during a full app quit — the whole session
    // (all open windows) is preserved so reopening the workspace restores them.
    if (!isMaster && !_appQuitting) {
      // Closing a window while other windows of the same workspace remain open
      // *edits* the workspace (removes the window). Closing the LAST live
      // window closes the workspace itself — persist the layout (keep every
      // window, including this one, in the file) so the skeleton keeps
      // rendering the right grid and reopening restores it.
      const isWorkspace = meta?.windowType === "workspace";
      const wsPath = meta?.workspacePath;
      // A window with no workspace keeps its tabs in memory only: closing it
      // drops them.
      if (isWorkspace && !wsPath) {
        const d = resolveDispatcherFor(null);
        if (d?.getWorkspace().windows.some((w) => w.id === openp41geWinId)) {
          d.apply("closeWindow", [openp41geWinId]);
          d.broadcast();
        }
        return;
      }
      if (isWorkspace && wsPath) {
        const d = resolveDispatcherFor(wsPath);
        if (!d) return;
        let otherLive = 0;
        for (const [id, bw] of openp41geWindows) {
          if (bw.isDestroyed()) continue;
          const otherMeta = openp41geWindowMeta.get(id);
          if (otherMeta?.windowType === "workspace" && otherMeta.workspacePath === wsPath) {
            otherLive++;
          }
        }
        if (otherLive === 0) {
          // Last live window -> closing the workspace: persist, don't remove.
          d.persist();
        } else {
          // Editing the workspace -> remove this window from the layout.
          d.apply("closeWindow", [openp41geWinId]);
          d.broadcast();
        }
      }
    }
  });

  if (!isDev) {
    win.loadFile(path.join(__dirname, "../../dist/index.html"));
  } else {
    win.loadURL("http://localhost:8642");
  }

  // DevTools is NOT auto-opened on window load anymore. In non-production
  // (unpackaged) builds it is available from the Window menu → Devtools.
}

// ─── Window-manager window ────────────────────────────────────────────────

/** Callback invoked when a workspace window should be opened for `workspacePath`. */
export type OpenWorkspaceWindowHandler = (workspacePath: string, source?: BrowserWindow) => void;

let _openWorkspaceWindow: OpenWorkspaceWindowHandler | null = null;

/** Wire the handler the window-manager uses to open a workspace-bound window. */
export function setOpenWorkspaceWindowHandler(fn: OpenWorkspaceWindowHandler): void {
  _openWorkspaceWindow = fn;
}

/**
 * Create a new thin window-manager window (not bound to any workspace layout
 * Window). Returns the window id. When `dropScreenX`/`dropScreenY` are given
 * the window is opened near that point (a dragged-out tab's release point).
 */
export function createWindowManagerWindow(
  sourceWindow?: BrowserWindow,
  tab?: WindowManagerTab,
  dropScreenX?: number,
  dropScreenY?: number,
): string {
  const winId = `wm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createOpenp41geWindow(winId, false, sourceWindow, dropScreenX, dropScreenY, {
    windowType: "manager",
    workspacePath: null,
    initialTab: tab,
  });
  return winId;
}

/**
 * Open (or focus) a window-manager window. When a window already exists and
 * `tab` is given, the tab is activated in it and the window brought to front.
 */
export function openWindowManager(sourceWindow?: BrowserWindow, tab?: WindowManagerTab): void {
  for (const [id, bw] of openp41geWindows) {
    if (openp41geWindowMeta.get(id)?.windowType !== "manager") continue;
    if (bw.isDestroyed()) continue;
    // Activate the requested tab in the already-open window.
    if (tab) {
      bw.webContents.send("window-manager:activate-tab", tab);
    }
    if (bw.isMinimized()) bw.restore();
    bw.focus();
    return;
  }
  createWindowManagerWindow(sourceWindow, tab);
}

/**
 * Create a new resizable logs window (not bound to any workspace layout
 * Window), opening the error `revealErrorId` if given. Returns the window id.
 */
export function createLogsWindow(sourceWindow?: BrowserWindow, revealErrorId?: string): string {
  const winId = `logs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  createOpenp41geWindow(winId, false, sourceWindow, undefined, undefined, {
    windowType: "logs",
    workspacePath: null,
    revealErrorId,
  });
  return winId;
}

/**
 * Open logs: in the requesting window when it is a workspace window (a Logs
 * tab in its grid), else in the logs window — reusing an existing one, so a
 * second "Logs" action brings it to the front instead of stacking. With
 * `revealErrorId`, that error's log entry is opened.
 */
export function openLogsWindow(sourceWindow?: BrowserWindow, revealErrorId?: string): void {
  // A workspace window shows its logs in its own grid.
  if (sourceWindow && !sourceWindow.isDestroyed()) {
    const sourceId = [...openp41geWindows].find(([, bw]) => bw === sourceWindow)?.[0];
    const sourceType = sourceId ? (openp41geWindowMeta.get(sourceId)?.windowType ?? null) : null;
    if (logsOpenInPlace(sourceType)) {
      sourceWindow.webContents.send("logs:open-in-window", revealErrorId ?? null);
      sourceWindow.focus();
      return;
    }
  }
  for (const [id, bw] of openp41geWindows) {
    if (openp41geWindowMeta.get(id)?.windowType !== "logs") continue;
    if (bw.isDestroyed()) continue;
    if (revealErrorId) bw.webContents.send("logs-window:reveal-error", revealErrorId);
    if (bw.isMinimized()) bw.restore();
    bw.focus();
    return;
  }
  createLogsWindow(sourceWindow, revealErrorId);
}

/** Summaries of every open window (id, kind, workspace binding). */
export interface OpenWindowSummary {
  windowId: string;
  windowType: Openp41geWindowType;
  workspacePath: string | null;
}

/** List open windows for the window-manager's "open windows" column. */
export function getOpenWindowSummaries(): OpenWindowSummary[] {
  return Array.from(openp41geWindows.keys()).map((id) => ({
    windowId: id,
    windowType: openp41geWindowMeta.get(id)?.windowType ?? "workspace",
    workspacePath: openp41geWindowMeta.get(id)?.workspacePath ?? null,
  }));
}

/**
 * Notify every live window-manager window that the set of open windows
 * changed, so it refreshes its "open windows" column immediately (instead of
 * waiting for the window to regain focus).
 */
export function notifyOpenWindowsChanged(): void {
  for (const [id, bw] of openp41geWindows) {
    if (bw.isDestroyed()) continue;
    if (openp41geWindowMeta.get(id)?.windowType !== "manager") continue;
    bw.webContents.send("window-manager:open-windows-changed");
  }
}

/** Open a workspace window bound to `workspacePath` (delegates to the app). */
export function openWorkspaceWindow(workspacePath: string, sourceWindow?: BrowserWindow): void {
  if (_openWorkspaceWindow) {
    _openWorkspaceWindow(workspacePath, sourceWindow);
  } else {
    // Fallback: a plain workspace window with no binding.
    const ws = _dispatcher?.getWorkspace();
    const id = ws?.windows[0]?.id ?? `win-${Date.now()}-0`;
    createOpenp41geWindow(id, false, sourceWindow, undefined, undefined, {
      windowType: "workspace",
      workspacePath,
    });
  }
}

/** Focus the first live workspace window bound to `workspacePath`, if any. */
export function focusWorkspaceWindow(workspacePath: string): boolean {
  for (const [id, bw] of openp41geWindows) {
    if (bw.isDestroyed()) continue;
    const meta = openp41geWindowMeta.get(id);
    if (meta?.windowType !== "workspace" || meta.workspacePath !== workspacePath) continue;
    if (bw.isMinimized()) bw.restore();
    bw.focus();
    return true;
  }
  return false;
}

// ─── Window lifecycle helpers ────────────────────────────────────────────

export function closeOrphanedWindows(workspacePath?: string | null): void {
  const d = resolveDispatcherFor(workspacePath);
  if (!d) return;
  const ws = d.getWorkspace();
  const activeIds = new Set(ws.windows.map((w) => w.id as string));
  for (const [openp41geWinId, bw] of openp41geWindows) {
    if (bw.isDestroyed()) continue;
    // Only workspace-layout windows are bound to a layout window; any other
    // window type (window-manager, logs) is never "orphaned" by the workspace
    // layout and must NOT be closed by a layout dispatch (e.g. a workspace
    // shortcut accidentally fired from the standalone Logs window).
    const meta = openp41geWindowMeta.get(openp41geWinId);
    if (meta?.windowType !== "workspace") continue;
    if (workspacePath && meta.workspacePath !== workspacePath) continue;
    if (!activeIds.has(openp41geWinId)) {
      bw.close();
    }
  }
}

export function handleNewTab(_openp41geWinId: string): void {
  // Cmd+T is no longer bound — new-tab creation is removed.
  // This will be replaced with something else in the future.
}

export async function handleCloseCurrentTab(openp41geWinId: string): Promise<void> {
  const d = resolveDispatcherFor(openp41geWindowMeta.get(openp41geWinId)?.workspacePath);
  if (!d) return;
  const ws = d.getWorkspace();
  const win = ws.windows.find((w) => w.id === openp41geWinId);
  if (!win) return;

  // If the window has no grid placements, close the window
  if (win.grid.placements.length === 0) {
    const bw = openp41geWindows.get(openp41geWinId);
    if (bw && !bw.isDestroyed()) {
      bw.close();
    }
    return;
  }

  // Close the active tab in the first cell
  const firstCell = win.grid.placements[0];
  if (firstCell && firstCell.tabIds.length > 0) {
    const activeTabId = firstCell.activeTabId ?? firstCell.tabIds[0];
    if (!activeTabId) return;
    const bw = openp41geWindows.get(openp41geWinId);
    if (bw) {
      const { confirmed } = await showConfirm(bw, {
        title: "Close tab?",
        message: "Close the active tab?",
        confirmLabel: "Close Tab",
      });
      if (!confirmed) return;
    }
    d.apply("removeTabFromCell", [openp41geWinId, activeTabId]);
    d.broadcast();
    return;
  }
}

export function handleNewColumn(openp41geWinId: string): void {
  const d = resolveDispatcherFor(openp41geWindowMeta.get(openp41geWinId)?.workspacePath);
  if (!d) return;
  d.apply("addColumnTab", [openp41geWinId]);
  d.broadcast();
}

export async function promptQuit(parentWindow?: BrowserWindow): Promise<void> {
  // No launching window (e.g. macOS dock/app-menu Quit with no focused window):
  // there is nothing to confirm against, so quit directly instead of showing
  // a dialog. In practice confirmations always come from a live window.
  if (!parentWindow) {
    app.quit();
    return;
  }
  const { confirmed } = await showConfirm(parentWindow, {
    title: "Quit openp41ge code?",
    message: "Are you sure you want to quit openp41ge code? All panes will be closed.",
    confirmLabel: "Quit",
  });
  if (confirmed) app.quit();
}
