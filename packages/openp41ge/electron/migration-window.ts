/**
 * migration-window.ts — the window shown at startup while the data updates
 * (instruction sets) this version needs run, before the app reads any data.
 *
 * It opens only when updates are pending, when one this version requires
 * could not be downloaded (offline: it checks what the download needs —
 * internet, GitHub — every few seconds, and Continue, once they are met,
 * downloads again), when the release lacks one (failed), when the check
 * itself failed (Retry), or when the data was last used by a newer version
 * (Quit only: this version may not understand it). It runs them
 * straight away showing only the progress (n of N; what they are and their
 * errors stay in the journal and the logs), and closes itself shortly after
 * they are done (`onDone` then starts the app). When one fails it stays,
 * suggesting the app is downloaded again from GitHub (Download, Quit);
 * closing it then quits the app — the app never opens on half-updated data.
 */

import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import { appTitle, keepWindowTitle } from "./app-title.js";
import path from "path";
import { fileURLToPath } from "url";
import {
  MigrationSession,
  type MigrationSessionState,
} from "../src/main/services/migrations/migration-session.js";
import type { SourcedSet } from "../src/main/services/migrations/pending-migrations.js";
import type { StartupPlan } from "../src/main/services/migrations/startup-migrations.js";
import { toWindowView } from "../src/main/services/migrations/window-view.js";
import {
  checkRequirements,
  requirementsMet,
  type Requirements,
  type RequirementsProbe,
} from "../src/main/services/migrations/requirements.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDTH = 520;
/** The height before the page reports its own (it fits its content). */
const HEIGHT = 200;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
/** Show the window anyway if the page has not reported its height by then. */
const SHOW_FALLBACK_MS = 1000;
/** How long "Done" shows before the window closes. */
const DONE_MS = 800;
/** Where a failed update sends the user: the app's releases. */
const DOWNLOAD_URL = "https://github.com/openp41ge/code/releases";
/** How often the offline checklist is checked again. */
const REQUIREMENTS_MS = 3000;
/** How long one check waits for an answer. */
const PROBE_TIMEOUT_MS = 5000;

/** The network, through Electron's `net` (the system's proxy settings). */
const probe: RequirementsProbe = {
  isOnline: () => net.isOnline(),
  get: async (url) => {
    const res = await net.fetch(url, {
      headers: { "User-Agent": "openp41ge", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { status: res.status, text: await res.text() };
  },
  reach: async (url) => {
    await net.fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "openp41ge" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  },
};

/** The window's state: the session's, or downloading / offline. */
type WindowState =
  | MigrationSessionState
  | { readonly phase: "checking"; readonly rows: readonly [] }
  | {
      readonly phase: "offline";
      readonly rows: readonly [];
      readonly error: string;
      readonly requirements?: Requirements;
    }
  | { readonly phase: "failed"; readonly rows: readonly []; readonly error: string }
  | { readonly phase: "error"; readonly rows: readonly []; readonly error: string }
  | { readonly phase: "newer"; readonly rows: readonly []; readonly dataVersion: string };

export interface MigrationWindowOptions {
  /** What startup found: sets to run, or offline. */
  readonly initial: StartupPlan;
  /** Decide again (Retry while offline: download again). */
  replan(): Promise<StartupPlan>;
  /** Run one set and record it in the journal. */
  apply(set: SourcedSet): { ok: boolean; error?: string };
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
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: appTitle(app.isPackaged, "Updating your data"),
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  keepWindowTitle(win);

  let session: MigrationSession | null = null;
  let state: WindowState = { phase: "checking", rows: [] };
  const show = (next: WindowState) => {
    state = next;
    if (!win.isDestroyed()) win.webContents.send("migrations:state", toWindowView(state));
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
      void checkNow();
    } else if (plan.kind === "missing") {
      show({ phase: "failed", rows: [], error: plan.error });
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

  /** Offline: check what the download needs, and show it if it changed. */
  let checking = false;
  const checkNow = async (): Promise<Requirements | null> => {
    if (checking || state.phase !== "offline") return null;
    checking = true;
    const requirements = await checkRequirements(probe, state.requirements, (progress) => {
      if (state.phase === "offline") show({ ...state, requirements: progress });
    });
    checking = false;
    if (state.phase !== "offline") return null;
    if (JSON.stringify(requirements) !== JSON.stringify(state.requirements)) {
      show({ ...state, requirements });
    }
    return requirements;
  };
  const recheck = setInterval(() => void checkNow(), REQUIREMENTS_MS);

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
    if (state.phase === "offline") {
      // Continue is only offered once everything is met; check it still is.
      const requirements = (await checkNow()) ?? state.requirements;
      if (!requirements || !requirementsMet(requirements)) return;
    }
    if (state.phase === "offline" || state.phase === "error") {
      show({ phase: "checking", rows: [] });
      follow(await options.replan());
    } else {
      void run();
    }
  };

  ipcMain.handle("migrations:get", (event) => (fromThisWindow(event) ? toWindowView(state) : null));
  ipcMain.on("migrations:retry", (event) => {
    if (fromThisWindow(event)) void retry();
  });
  ipcMain.on("migrations:quit", (event) => {
    if (fromThisWindow(event)) app.quit();
  });
  // The page reports its height after each render; the window fits it, and
  // shows once it has (so it does not open at the wrong size).
  const reveal = () => {
    if (win.isDestroyed() || win.isVisible()) return;
    win.show();
    win.focus();
  };
  ipcMain.on("migrations:size", (event, height: unknown) => {
    if (!fromThisWindow(event) || typeof height !== "number" || !Number.isFinite(height)) return;
    const h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)));
    win.setContentSize(WIDTH, h);
    reveal();
  });
  ipcMain.on("migrations:download", (event) => {
    if (fromThisWindow(event)) void shell.openExternal(DOWNLOAD_URL);
  });

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    setTimeout(reveal, SHOW_FALLBACK_MS);
    follow(options.initial);
  });
  win.on("closed", () => {
    clearInterval(recheck);
    ipcMain.removeHandler("migrations:get");
    ipcMain.removeAllListeners("migrations:retry");
    ipcMain.removeAllListeners("migrations:quit");
    ipcMain.removeAllListeners("migrations:download");
    ipcMain.removeAllListeners("migrations:size");
    if (done) options.onDone(outcome);
    else app.quit();
  });

  if (app.isPackaged) {
    void win.loadFile(path.join(__dirname, "../../dist/migrations.html"));
  } else {
    void win.loadURL("http://localhost:8642/migrations.html");
  }
}
