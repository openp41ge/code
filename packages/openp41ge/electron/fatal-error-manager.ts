/**
 * fatal-error-manager.ts — the fatal error window.
 *
 * A fatal (unrecoverable) error is a system-level concern, entirely outside the
 * logging system. When the main process hits one (uncaught exception /
 * unhandled rejection), it must not continue in an unknown state. This manager
 * shows a dedicated window with the error, then waits for the user to
 * acknowledge before the app exits (crashes) via `app.exit(1)`.
 *
 * Deliberate properties:
 *
 *   - The window is **self-contained**: it loads its own `fatal.html` page and
 *     does not depend on the (likely broken) app renderer or bootstrap.
 *   - It is **frameless + always-on-top + parentless** (not a `parent` child —
 *     see confirm-dialog-manager.ts for the macOS `setEnabled(false)` dim-layer
 *     z-order bug).
 *   - The app does **not** exit immediately: the fatal window stays up until
 *     the user clicks "Acknowledge & Quit" (or closes the window), so the user
 *     can read the error. Only then does the process exit.
 *   - The fatal error is **never** written to the log bus / log viewer / disk.
 *     Fatal is outside logging. The message is shown in this window and is the
 *     one thing allowed to reach the console (`console.error` in the caller).
 *   - Only one fatal window at a time; concurrent calls are ignored.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** True when running from a packaged build (production), read live. */
function isPackagedBuild(): boolean {
  return app.isPackaged;
}

/** The fatal window's fixed content size. */
const FATAL_WIDTH = 560;
const FATAL_HEIGHT = 420;

/** Shown in production instead of the real error message/stack. */
const GENERIC_FATAL_MESSAGE = "The application encountered an unrecoverable error and must close.";

/** Payload shown in the fatal window. */
export interface FatalErrorPayload {
  message: string;
  stack?: string;
  timestamp?: number;
}

let _fatalWin: BrowserWindow | null = null;
let _isShown = false;
let _handlersRegistered = false;

/**
 * Register the fatal-accept IPC handler (idempotent). `onAcknowledge` is called
 * exactly once when the user acknowledges (or closes) the fatal window, giving
 * the application a hook to crash/exit.
 */
export function registerFatalHandlers(onAcknowledge: (code: number) => void): void {
  if (_handlersRegistered) return;
  _handlersRegistered = true;

  ipcMain.on("fatal:ack", () => {
    onAcknowledge(1);
  });
}

/**
 * Show the fatal error window. Idempotent-ish: if a fatal window is already
 * open, the new payload is ignored (a fatal window is already up). Returns true
 * if the window was shown (or already showing).
 *
 * In production the raw error is not shown to the user: only a generic message
 * is displayed (no stack, no error text), so we don't leak internals. In dev
 * builds the message + stack are shown for debugging.
 */
export function showFatalErrorWindow(payload: FatalErrorPayload): boolean {
  if (_isShown) return true;
  _isShown = true;

  // Don't leak the actual error to the user in production — show only a
  // generic fatal message. Dev keeps the detail for debugging.
  const userPayload: FatalErrorPayload = isPackagedBuild()
    ? {
        message: GENERIC_FATAL_MESSAGE,
        stack: undefined,
        timestamp: payload.timestamp,
      }
    : payload;

  try {
    const win = new BrowserWindow({
      width: FATAL_WIDTH,
      height: FATAL_HEIGHT,
      minWidth: FATAL_WIDTH,
      minHeight: FATAL_HEIGHT,
      frame: false,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: "openp41ge",
      backgroundColor: "#252526",
      // Do NOT set `parent`. See confirm-dialog-manager.ts: on macOS,
      // disabling/covering the parent renders a full-screen dimmed layer that
      // macOS orders above a child window. A parentless always-on-top window
      // stays in front.
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    _fatalWin = win;

    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });

    // When the user closes the window, treat it as acknowledgment (crash).
    win.on("closed", () => {
      _isShown = false;
      _fatalWin = null;
      ipcMain.removeAllListeners("fatal:ack");
      _handlersRegistered = false;
      app.exit(1);
    });

    win.webContents.once("did-finish-load", (): void => {
      if (win.isDestroyed()) return;
      win.webContents.send("fatal:show", JSON.stringify(userPayload));
    });

    if (isPackagedBuild()) {
      win.loadFile(path.join(__dirname, "../../dist/fatal.html"));
    } else {
      win.loadURL("http://localhost:8642/fatal.html");
    }

    return true;
  } catch {
    // If the fatal window itself cannot be created, there is nothing left to
    // do but exit. Fatal is outside logging.
    _isShown = false;
    _fatalWin = null;
    app.exit(1);
    return false;
  }
}

/** True when the fatal window is currently open. */
export function isFatalWindowOpen(): boolean {
  return _isShown && !!_fatalWin && !_fatalWin.isDestroyed();
}

/** Close/acknowledge the fatal window (used by tests). */
export function _closeFatalWindowForTests(): void {
  if (_fatalWin && !_fatalWin.isDestroyed()) {
    _fatalWin.close();
  }
}

/** Reset all module state (used by tests). */
export function _resetFatalManagerForTests(): void {
  _isShown = false;
  _fatalWin = null;
  _handlersRegistered = false;
}
