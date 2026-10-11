/**
 * migration-window.ts — the window shown at startup while the data updates
 * (instruction sets) this version needs run, before the app reads any data.
 *
 * It opens only when updates are pending, when one this version requires
 * could not be downloaded (offline: Retry downloads again), when the check
 * itself failed (Retry), or when the data was last used by a newer version
 * (Quit only: this version may not understand it). It runs them
 * straight away showing each one's progress, and closes itself shortly after
 * they are done (`onDone` then starts the app). When one fails it stays,
 * with the error, Retry, Quit and Show the journal; closing it then quits the
 * app — the app never opens on half-updated data.
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import {
  MigrationSession,
  type MigrationSessionState,
} from "../src/main/services/migrations/migration-session.js";
import type { SourcedSet } from "../src/main/services/migrations/pending-migrations.js";
import type { StartupPlan } from "../src/main/services/migrations/startup-migrations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 520;
const HEIGHT = 380;
/** How long "Done" shows before the window closes. */
const DONE_MS = 800;

/** The window's state: the session's, or downloading / offline. */
type WindowState =
  | MigrationSessionState
  | { readonly phase: "checking"; readonly rows: readonly [] }
  | { readonly phase: "offline"; readonly rows: readonly []; readonly error: string }
  | { readonly phase: "error"; readonly rows: readonly []; readonly error: string }
  | { readonly phase: "newer"; readonly rows: readonly []; readonly dataVersion: string };

export interface MigrationWindowOptions {
  /** What startup found: sets to run, or offline. */
  readonly initial: StartupPlan;
  /** Decide again (Retry while offline: download again). */
  replan(): Promise<StartupPlan>;
  /** Run one set and record it in the journal. */
  apply(set: SourcedSet): { ok: boolean; error?: string };
  /** The journal file (Show the journal reveals it). */
  readonly journalFile: string;
  /** Start the app: the sets `ran`, or a retry found `none` left or that
   *  they can wait (`deferred`). Called once, after the window closes. */
  onDone(outcome: "ran" | "none" | "deferred"): void;
}

/** Open the migration window and run the pending updates. */
export function openMigrationWindow(options: MigrationWindowOptions): void {
  let done = false;
  let outcome: "ran" | "none" | "deferred" = "none";
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: WIDTH,
    minHeight: 300,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: "Openp41ge — Updating your data",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let session: MigrationSession | null = null;
  let state: WindowState = { phase: "checking", rows: [] };
  const show = (next: WindowState) => {
    state = next;
    if (!win.isDestroyed()) win.webContents.send("migrations:state", state);
  };
  const finish = (how: typeof outcome) => {
    outcome = how;
    done = true;
    setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, DONE_MS);
  };
  /** Act on a plan: run its sets, show offline, or finish. */
  const follow = (plan: StartupPlan) => {
    if (plan.kind === "run") {
      session = new MigrationSession(
        plan.sets,
        (set) => options.apply(set),
        (s) => show(s),
      );
      show(session.state());
      void run();
    } else if (plan.kind === "offline") {
      show({ phase: "offline", rows: [], error: plan.error });
    } else if (plan.kind === "error") {
      show({ phase: "error", rows: [], error: plan.error });
    } else if (plan.kind === "newer") {
      show({ phase: "newer", rows: [], dataVersion: plan.dataVersion });
    } else {
      finish(plan.kind);
    }
  };
  const fromThisWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !win.isDestroyed() && event.sender === win.webContents;

  let running = false;
  const run = async () => {
    if (running || !session) return;
    running = true;
    const ok = await session.run();
    running = false;
    if (ok) finish("ran");
  };
  const retry = async () => {
    if (running) return;
    if (state.phase === "offline" || state.phase === "error") {
      show({ phase: "checking", rows: [] });
      follow(await options.replan());
    } else {
      void run();
    }
  };

  ipcMain.handle("migrations:get", (event) => (fromThisWindow(event) ? state : null));
  ipcMain.on("migrations:retry", (event) => {
    if (fromThisWindow(event)) void retry();
  });
  ipcMain.on("migrations:quit", (event) => {
    if (fromThisWindow(event)) app.quit();
  });
  ipcMain.on("migrations:show-journal", (event) => {
    if (fromThisWindow(event)) shell.showItemInFolder(options.journalFile);
  });

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
    follow(options.initial);
  });
  win.on("closed", () => {
    ipcMain.removeHandler("migrations:get");
    ipcMain.removeAllListeners("migrations:retry");
    ipcMain.removeAllListeners("migrations:quit");
    ipcMain.removeAllListeners("migrations:show-journal");
    if (done) options.onDone(outcome);
    else app.quit();
  });

  if (app.isPackaged) {
    void win.loadFile(path.join(__dirname, "../../dist/migrations.html"));
  } else {
    void win.loadURL("http://localhost:8642/migrations.html");
  }
}
