/**
 * prerequisites-window.ts — the window shown instead of the app when something
 * it needs (see src/main/services/prerequisites.ts) is missing.
 *
 * It lists every prerequisite with a found / missing mark, links to where to
 * get what is missing, and re-checks on request. Once everything is met it
 * closes and the app starts normally (`onMet`); closing it while something is
 * still missing quits the app.
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { allMet, type PrerequisiteResult } from "../src/main/services/prerequisites.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 520;
const HEIGHT = 380;

export interface PrerequisitesWindowOptions {
  /** The startup results (at least one missing). */
  readonly initial: readonly PrerequisiteResult[];
  /** Re-run the checks. */
  check(): Promise<PrerequisiteResult[]>;
  /** Everything is met: start the app. Called once, after the window closes. */
  onMet(): void;
}

let _win: BrowserWindow | null = null;

/** True while the prerequisites window is open. */
export function isPrerequisitesWindowOpen(): boolean {
  return !!_win && !_win.isDestroyed();
}

/** Bring the prerequisites window to the front (no-op when not open). */
export function focusPrerequisitesWindow(): void {
  if (!isPrerequisitesWindowOpen()) return;
  if (_win!.isMinimized()) _win!.restore();
  _win!.show();
  _win!.focus();
}

/** Open the prerequisites window (focuses it when already open). */
export function openPrerequisitesWindow(options: PrerequisitesWindowOptions): void {
  if (isPrerequisitesWindowOpen()) {
    focusPrerequisitesWindow();
    return;
  }
  let results: readonly PrerequisiteResult[] = options.initial;
  let met = false;

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: WIDTH,
    minHeight: 300,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Openp41ge — Before you start",
    // The app's chrome: the page draws its own title bar (as the logs window).
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  _win = win;

  const fromThisWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !win.isDestroyed() && event.sender === win.webContents;

  ipcMain.handle("prerequisites:get", (event) => (fromThisWindow(event) ? results : []));
  ipcMain.handle("prerequisites:recheck", async (event) => {
    if (!fromThisWindow(event)) return [];
    results = await options.check();
    if (allMet(results)) {
      met = true;
      win.close();
    }
    return results;
  });
  ipcMain.on("prerequisites:open-help", (event, id: unknown) => {
    if (!fromThisWindow(event)) return;
    const url = results.find((r) => r.id === id && !r.ok)?.helpUrl;
    if (url?.startsWith("https://")) void shell.openExternal(url);
  });
  ipcMain.on("prerequisites:quit", (event) => {
    if (fromThisWindow(event)) app.quit();
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on("closed", () => {
    _win = null;
    ipcMain.removeHandler("prerequisites:get");
    ipcMain.removeHandler("prerequisites:recheck");
    ipcMain.removeAllListeners("prerequisites:open-help");
    ipcMain.removeAllListeners("prerequisites:quit");
    if (met) options.onMet();
    else app.quit();
  });

  if (app.isPackaged) {
    void win.loadFile(path.join(__dirname, "../../dist/prerequisites.html"));
  } else {
    void win.loadURL("http://localhost:8642/prerequisites.html");
  }
}
