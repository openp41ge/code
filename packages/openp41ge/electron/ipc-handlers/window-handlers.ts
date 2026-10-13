/**
 * Window control IPC handlers — new-tab, close-tab, add-column, new-window,
 * minimize, maximize, toggleFullScreen, close, isMaximized.
 */

import { ipcMain, BrowserWindow, screen, type IpcMainEvent } from "electron";
import type { OperationDispatcher } from "../../src/main/index.js";
import type { TabNameGenerator } from "../../src/main/index.js";
import {
  openp41geWindows,
  createOpenp41geWindow,
  handleCloseCurrentTab,
  handleNewColumn,
} from "../window-manager.js";

export function registerWindowHandlers(
  resolve: (event: { sender: Electron.WebContents }) => OperationDispatcher | null,
  _tabNames: TabNameGenerator,
): void {
  ipcMain.on("openp41ge:new-tab", (_event) => {
    // Cmd+T new-tab is removed — will be replaced with something else.
  });

  ipcMain.on("openp41ge:close-tab", (event) => {
    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw) return;
    for (const [id, existing] of openp41geWindows) {
      if (existing === bw) {
        handleCloseCurrentTab(id);
        return;
      }
    }
  });

  ipcMain.on("openp41ge:add-column", (event) => {
    const bw = BrowserWindow.fromWebContents(event.sender);
    if (!bw) return;
    for (const [id, existing] of openp41geWindows) {
      if (existing === bw) {
        handleNewColumn(id);
        return;
      }
    }
  });

  ipcMain.on("openp41ge:new-window", (event: IpcMainEvent) => {
    const d = resolve(event);
    if (!d) return;
    d.apply("newWindow", []);
    const ws = d.getWorkspace();
    const newWin = ws.windows[ws.windows.length - 1];
    if (newWin) {
      d.broadcast();
      const src = BrowserWindow.fromWebContents(event.sender);
      createOpenp41geWindow(newWin.id, false, src ?? undefined);
    }
  });

  // ── Window controls ──────────────────────────────────────────────────────

  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  // The frameless management window's green traffic light.
  ipcMain.on("window:toggleFullScreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.on("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });

  // ── Animated maximize / restore (custom title-bar double-click) ─────────
  // Steps the window bounds to the screen work area with an ease-in-out
  // curve; every setBounds resizes the web contents, so the renderer gets a
  // live resize + relayout each frame — the UI grows WITH the window instead
  // of freezing during macOS's native zoom animation. We remember the
  // original bounds in `maxState` so a second double-click can restore them.
  // We deliberately do NOT use win.maximize() for this path: we move the
  // window to the target before anything else, and macOS would then record
  // the target itself as the restore frame, making unmaximize a no-op.

  type MaxAnimToken = { cancelled: boolean };
  const maxTokens = new WeakMap<BrowserWindow, MaxAnimToken>();
  const maxState = new WeakMap<BrowserWindow, Electron.Rectangle>();

  function cancelWindowAnimation(win: BrowserWindow): void {
    const token = maxTokens.get(win);
    if (token) token.cancelled = true;
    maxTokens.delete(win);
  }

  function animateWindowBounds(
    win: BrowserWindow,
    from: Electron.Rectangle,
    to: Electron.Rectangle,
    onDone: () => void,
  ): void {
    cancelWindowAnimation(win);
    const token: MaxAnimToken = { cancelled: false };
    maxTokens.set(win, token);
    const steps = 12;
    const per = 16; // ~190ms total, close to macOS's zoom ease
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    let i = 0;
    const tick = (): void => {
      if (token.cancelled) {
        onDone();
        return;
      }
      if (i > steps) {
        maxTokens.delete(win);
        onDone();
        return;
      }
      const e = ease(i / steps);
      win.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.round(from.width + (to.width - from.width) * e),
        height: Math.round(from.height + (to.height - from.height) * e),
      });
      i += 1;
      setTimeout(tick, per);
    };
    tick();
  }

  ipcMain.on("window:maximize-animated", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const restore = maxState.get(win);
    if (restore) {
      // Second double-click: reduce back to the original bounds.
      maxState.delete(win);
      animateWindowBounds(win, win.getBounds(), restore, () => undefined);
      return;
    }
    if (win.isMaximized()) {
      // Maximized natively (e.g. the macOS green button) — restore natively.
      win.unmaximize();
      return;
    }

    const start = win.getBounds();
    const target = screen.getDisplayMatching(start).workArea;
    maxState.set(win, { ...start });
    animateWindowBounds(win, start, target, () => undefined);
  });

  // ── Custom titlebar drag ───────────────────────────────────────────────
  // The bar is permanently `no-drag` so the renderer can intercept the
  // double-click for the animated maximize above. We reimplement the window
  // move over IPC: the renderer sends the desired absolute top-left (DIP),
  // and we setPosition it. Moves are rAF-throttled renderer-side (one IPC per
  // frame) so pointer tracking stays tight.

  const activeDrags = new WeakSet<BrowserWindow>();

  ipcMain.on("window:start-drag", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    cancelWindowAnimation(win);
    const restore = maxState.get(win);
    if (restore) {
      // Maximized by our animated grow — drop back to the original bounds
      // first (macOS-style restore-on-drag) so dragging moves a normal window.
      maxState.delete(win);
      win.setBounds(restore);
    } else if (win.isMaximized()) {
      win.unmaximize(); // natively maximized — restore before dragging
    }
    activeDrags.add(win);
  });

  ipcMain.on("window:drag-move", (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !activeDrags.has(win)) return;
    win.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on("window:end-drag", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) activeDrags.delete(win);
  });

  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:isMaximized", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() || maxState.has(win) : false;
  });

  ipcMain.handle("window:getBounds", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.getBounds() ?? null;
  });

  ipcMain.on("window:open-dev-tools", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: "detach" });
  });
}
