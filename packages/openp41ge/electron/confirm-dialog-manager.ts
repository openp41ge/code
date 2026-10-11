/**
 * ConfirmDialogManager — owns the dedicated confirm `BrowserWindow`.
 *
 * A confirmation is a small frameless, always-on-top window centred over the
 * window that launched it (on the same display). While a confirm is pending the
 * launching window is disabled and shown a mask (via `confirm:mask-show` /
 * `confirm:mask-hide`) pointing the user at the dialog.
 *
 * The confirm window answers over IPC (`confirm:result`); if it is closed
 * without answering the confirm resolves to `{ confirmed: false }`.
 *
 * This is the single confirmation mechanism for the whole app. It replaces the
 * old in-window `<openp41ge-confirm-modal>`, the `openp41ge:show-confirm` /
 * `confirm-response` renderer bridge, and the native `dialog.showMessageBoxSync`
 * fallback.
 */

import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "confirm-dialog");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

/** The confirm dialog's content size (width fixed; height set by content). */
const CONFIRM_WIDTH = 420;

/** Result of a confirmation. */
export interface ConfirmResult {
  confirmed: boolean;
  checked: boolean;
}

/** Axis-aligned rectangle (screen coordinates). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure centring computation: centre `dialog` over `parent`, clamped to
 * `workArea`. Used by `positionConfirm`; exported so it can be unit-tested
 * without an Electron dependency.
 */
export function computeConfirmBounds(
  parent: Rect,
  dialog: { width: number; height: number },
  workArea: Rect,
): { x: number; y: number } {
  let x = Math.round(parent.x + (parent.width - dialog.width) / 2);
  let y = Math.round(parent.y + (parent.height - dialog.height) / 2);
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - dialog.width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - dialog.height));
  return { x, y };
}

/** Options shown in the confirm dialog. */
export interface ConfirmOptions {
  message: string;
  title?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmStyle?: "danger" | string;
  checkboxLabel?: string;
  checkboxDetail?: string;
}

/** Payload the confirm window posts back with its answer. */
interface ConfirmAnswerPayload {
  confirmId: string;
  confirmed: boolean;
  checked: boolean;
}

/** A pending confirm, keyed by its confirm window id. */
interface PendingConfirm {
  confirmId: string;
  win: BrowserWindow;
  parent: BrowserWindow;
  options: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
  timeout: NodeJS.Timeout | null;
}

const pendingByWindow = new Map<string, PendingConfirm>();

let handlersRegistered = false;

/** Register the confirm IPC handlers (idempotent). */
export function registerConfirmHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Renderer-initiated confirm: the sender's window is the launching window.
  ipcMain.handle("confirm:show", async (event, options: ConfirmOptions) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent) {
      // No window to launch from — reject; callers should treat as cancelled.
      return { confirmed: false, checked: false };
    }
    try {
      return await showConfirm(parent, options);
    } catch (err) {
      log.error("confirm:show failed:", err, { skipToast: true });
      return { confirmed: false, checked: false };
    }
  });

  // The confirm window's answer.
  ipcMain.on("confirm:result", (_event, payload: ConfirmAnswerPayload) => {
    resolveConfirm(payload.confirmId, {
      confirmed: !!payload.confirmed,
      checked: !!payload.checked,
    });
  });

  // The confirm window asks for its size so the main process can fix the
  // window's height (content-driven) and re-centre over the parent.
  ipcMain.on("confirm:fitsize", (_event, payload: { confirmId: string; height: number }) => {
    const pending = pendingByWindow.get(payload.confirmId);
    if (!pending || pending.win.isDestroyed()) return;
    const height = Math.max(96, Math.min(payload.height, 640));
    pending.win.setContentSize(CONFIRM_WIDTH, height);
    positionConfirm(pending);
  });
}

/** True when a confirm is already pending for `parent`. */
export function hasPendingConfirm(parent: BrowserWindow): boolean {
  for (const p of pendingByWindow.values()) {
    if (p.parent === parent) return true;
  }
  return false;
}

/**
 * Show a confirmation centred over `parent`. Resolves with the user's answer
 * (or `{ confirmed: false }` if the dialog is dismissed/closed without
 * answering). Rejects (returns `false`) if a confirm is already pending for the
 * same parent window.
 */
export function showConfirm(
  parent: BrowserWindow,
  options: ConfirmOptions,
): Promise<ConfirmResult> {
  if (parent.isDestroyed()) {
    return Promise.resolve({ confirmed: false, checked: false });
  }

  // Only one confirm at a time per launching window. A second request resolves
  // immediately as cancelled (deterministic; the pixel is already in flight).
  if (hasPendingConfirm(parent)) {
    log.warn("confirm already pending for window; rejecting second request");
    return Promise.resolve({ confirmed: false, checked: false });
  }

  return new Promise((resolve) => {
    const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const win = new BrowserWindow({
      width: CONFIRM_WIDTH,
      height: 140,
      minWidth: CONFIRM_WIDTH,
      maxWidth: CONFIRM_WIDTH,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: "openp41ge",
      backgroundColor: "#252526",
      // Do NOT set `parent` on the confirm window. On macOS, disabling the
      // parent (setEnabled(false)) makes Electron/macOS render a full-screen
      // dimmed layer for the disabled window; when the confirm is a *child*
      // of that parent, that dim layer is ordered ABOVE the child and covers
      // the dialog (the "confirm under the mask" bug). Leaving the confirm
      // parentless but always-on-top keeps it in front of the dim layer.
      //
      // Nor do we use `modal: true` — a modal would become a macOS sheet
      // attached to the parent's title bar instead of a free-floating centred
      // dialog. The parent is disabled explicitly instead.
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const pending: PendingConfirm = {
      confirmId,
      win,
      parent,
      options,
      resolve,
      timeout: setTimeout(() => {
        log.warn("confirm timed out; cancelling");
        resolveConfirm(confirmId, { confirmed: false, checked: false });
      }, 120000),
    };
    pendingByWindow.set(confirmId, pending);

    // Disable the launching window so it is fully blocked while the confirm is
    // open; show the mask and restore both when the confirm closes.
    parent.setEnabled(false);
    try {
      parent.webContents.send("confirm:mask-show");
    } catch (err) {
      log.warn("failed to show confirm mask:", err);
    }

    win.once("ready-to-show", () => {
      positionConfirm(pending);
      win.show();
      win.focus();
    });

    win.on("closed", () => {
      resolveConfirm(confirmId, { confirmed: false, checked: false });
    });

    win.webContents.once("did-finish-load", (): void => {
      if (win.isDestroyed()) return;
      win.webContents.send("confirm:show-options", JSON.stringify({ confirmId, options }));
    });

    if (!isDev) {
      win.loadFile(path.join(__dirname, "../../dist/confirm.html"));
    } else {
      win.loadURL("http://localhost:8642/confirm.html");
    }
  });
}

/** Resolve a pending confirm and tear down its window + parent mask. */
function resolveConfirm(confirmId: string, result: ConfirmResult): void {
  const pending = pendingByWindow.get(confirmId);
  if (!pending) return;
  pendingByWindow.delete(confirmId);

  if (pending.timeout) clearTimeout(pending.timeout);

  // Restore the launching window before/while closing the dialog.
  try {
    if (!pending.parent.isDestroyed()) {
      pending.parent.setEnabled(true);
      pending.parent.webContents.send("confirm:mask-hide");
    }
  } catch (err) {
    log.warn("failed to restore parent window after confirm:", err);
  }

  try {
    if (!pending.win.isDestroyed()) pending.win.close();
  } catch (err) {
    log.warn("failed to close confirm window:", err);
  }

  pending.resolve(result);
}

/** Centre the confirm window over its parent, clamped to the same display. */
function positionConfirm(pending: PendingConfirm): void {
  if (pending.win.isDestroyed() || pending.parent.isDestroyed()) return;
  const parentBounds = pending.parent.getBounds();
  const [w, h] = pending.win.getContentSize();
  const display = screen.getDisplayMatching(parentBounds);
  const workArea = display.workArea;

  const { x, y } = computeConfirmBounds(parentBounds, { width: w, height: h }, workArea);
  pending.win.setPosition(x, y);
}
