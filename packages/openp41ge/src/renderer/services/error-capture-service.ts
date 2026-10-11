/**
 * ErrorCaptureService — captures runtime errors (renderer + main process),
 * logs them to the log bus + on-disk file (and Sentry where available), and
 * surfaces them via a NON-BLOCKING persistent error toast.
 *
 * The old full-screen blocking overlay and the toast-click modal are gone.
 * Instead, captured errors are held in a reactive list that any UI (e.g. the
 * manager window's "Logs" tab badge + error-detail drawer) can subscribe to.
 * Clicking an error toast switches the manager window to its Logs tab via the
 * "openp41ge:open-logs-tab" document event.
 *
 * Renderer errors: window.onerror, unhandledrejection, console.error
 * Main process errors: forwarded via IPC channel "openp41ge:error"
 *
 * Install at the VERY TOP of bootstrap.start() so startup errors are caught.
 */

const STORAGE_KEY = "openp41ge:captured-errors";

import { createLogger } from "openp41ge-core-logger";
import * as Sentry from "@sentry/electron/renderer";
import { MAX_ERRORS } from "openp41ge-core-constants";
import { toastService } from "../components/openp41ge-toast";

const log = createLogger("openp41ge", "error-capture");

export interface CapturedError {
  message: string;
  source: string;
  stack: string;
  timestamp: number;
  type: "exception" | "rejection" | "console" | "main-process";
  /** True when this error should NOT surface a toast (still captured + logged). */
  skipToast?: boolean;
}

let errors: CapturedError[] = [];
let isInstalled = false;

/** ── Error-toast policy ────────────────────────────────────────────────
 * Toasts are surfaced in development but suppressed in production by default
 * (see `installErrorCapture`). Callers can also opt a single error out of the
 * toast by logging with a structured config object:
 *
 *   log.error("upstream unavailable", { skipToast: true });
 *
 * The error is still written to the log bus / on-disk file and still appears in
 * the manager's Logs tab list — only the pop-up toast is skipped. The policy can
 * be tuned at runtime with `setErrorToastEnabled()`. */
let _toastEnabled = true;

/** True when any console arg is a structured data object requesting no toast. */
function _skipToastRequested(args: unknown[]): boolean {
  for (const a of args) {
    if (a && typeof a === "object" && !Array.isArray(a) && !(a instanceof Error)) {
      if ((a as Record<string, unknown>)["skipToast"] === true) return true;
    }
  }
  return false;
}

/** Enable or disable error toasts globally (default: enabled in dev, disabled in prod). */
export function setErrorToastEnabled(enabled: boolean): void {
  _toastEnabled = enabled;
}

/** Current error-toast policy (true = toasts surfaced). */
export function isErrorToastEnabled(): boolean {
  return _toastEnabled;
}

/** Subscribe to the captured-errors list. The listener is called immediately
 *  with the current list, then again on every change. */
type ErrorListener = (errors: CapturedError[]) => void;
const _listeners = new Set<ErrorListener>();

/**
 * True while this service is emitting a `log.error` (which the console
 * transport replays to console.error and would hence re-trigger the console
 * interceptor below). Guards the double-count of an uncaught error — the
 * onerror / rejection handler adds it explicitly once.
 */
let _suppressConsoleCapture = false;

/** ── Runaway-error guard ─────────────────────────────────────────────
 * A bug that throws in a tight loop (e.g. a Lit render that keeps
 * re-scheduling) can fire tens of thousands of errors per second. Without a
 * guard, each one is written to the log bus, persisted to disk, stored in
 * sessionStorage, and re-emitted to every subscriber — which is exactly how
 * an error loop ballooned a log to multiple GB in minutes and took the app
 * down. Each distinct error signature is fully captured only a handful of
 * times per window; identical repeats are aggregated and dropped. */
const THROTTLE_WINDOW_MS = 5_000;
const THROTTLE_FULL_CAPTURES = 5;
const THROTTLE_SUMMARY_EVERY = 100;
const _errThrottle = new Map<string, { count: number; windowStart: number; suppressed: number }>();

function _errorSignature(err: CapturedError): string {
  const frame = (err.stack || "").split("\n").find((l) => l.trim().length > 0) || "";
  return `${err.type}\u0000${err.message.slice(0, 300)}\u0000${frame.slice(0, 200)}`;
}

function _pruneThrottle(now: number): void {
  if (_errThrottle.size <= 400) return;
  for (const [k, v] of _errThrottle) {
    if (now - v.windowStart > THROTTLE_WINDOW_MS) _errThrottle.delete(k);
  }
}

/** True only for occurrences that should be fully captured (logged + shown). */
function _shouldCapture(err: CapturedError): boolean {
  const sig = _errorSignature(err);
  const now = Date.now();
  const rec = _errThrottle.get(sig);
  if (!rec || now - rec.windowStart > THROTTLE_WINDOW_MS) {
    _errThrottle.set(sig, { count: 1, windowStart: now, suppressed: 0 });
    _pruneThrottle(now);
    return true;
  }
  rec.count++;
  if (rec.count <= THROTTLE_FULL_CAPTURES) return true;
  rec.suppressed++;
  if (rec.suppressed === THROTTLE_SUMMARY_EVERY) {
    // Surface one aggregate line so a flood is never silent. Suppress the
    // console replay so this summary isn't re-captured as a "console" error.
    _suppressConsoleCapture = true;
    try {
      log.error("error-burst", {
        message: `Error repeated ${rec.count}\u00d7 in ${THROTTLE_WINDOW_MS / 1000}s; suppressing further identical occurrences`,
        signature: sig,
      });
    } finally {
      _suppressConsoleCapture = false;
    }
  }
  return false;
}

/** Coalesce rapid duplicate error toasts so a burst never floods the screen. */
let _lastToastMessage = "";
let _lastToastAt = 0;

function emitChanges(): void {
  const snapshot = errors;
  for (const cb of _listeners) {
    try {
      cb(snapshot);
    } catch {
      /* a listener must never break error capture */
    }
  }
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(errors.slice(0, 20)));
  } catch {
    /* quota exceeded */
  }
}

function addError(err: CapturedError): void {
  errors = [err, ...errors].slice(0, MAX_ERRORS);
  persist();
  showErrorToast(err);
  emitChanges();
}

function describeError(err: CapturedError): string {
  return `${err.type === "main-process" ? "[MAIN PROCESS] " : ""}${err.message}`;
}

function showErrorToast(err: CapturedError): void {
  // Per-error skip (via the log data option) or a global production disable.
  if (err.skipToast || !_toastEnabled) return;
  const full = describeError(err);
  const now = Date.now();
  if (full === _lastToastMessage && now - _lastToastAt < 2000) {
    // Same error repeated recently — refresh the coalesce window, don't stack.
    _lastToastAt = now;
    return;
  }
  _lastToastMessage = full;
  _lastToastAt = now;

  const preview = full.length > 180 ? `${full.slice(0, 180)}…` : full;
  // Errors never auto-dismiss (duration 0) — the user must dismiss them, or
  // click the toast to open the dedicated Logs window (where the row lives).
  toastService.show(`Error: ${preview}`, "error", 0, () => {
    window.openp41ge?.windowManager.openLogsWindow();
  });
}

/** Current captured errors (newest first). */
export function getCapturedErrors(): CapturedError[] {
  return errors;
}

/** Subscribe to captured-error changes. Returns a cancel function. */
export function subscribeErrors(listener: ErrorListener): () => void {
  _listeners.add(listener);
  try {
    listener(errors);
  } catch {
    /* ignore */
  }
  return () => {
    _listeners.delete(listener);
  };
}

/** Clear all captured errors (e.g. when a workspace loads, so stale errors from
 *  a previous session / hot reload don't linger). */
export function clearCapturedErrors(): void {
  errors = [];
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emitChanges();
}

/**
 * Install global error handlers for the renderer process.
 * Also sets up an IPC listener for errors forwarded from the main process.
 */
export function installErrorCapture(): void {
  if (isInstalled) return;
  isInstalled = true;

  // ── Listen for main-process errors forwarded via IPC ────────────────
  try {
    if (window.openp41ge?.lifecycle?.onError) {
      window.openp41ge.lifecycle.onError((data) => {
        const captured: CapturedError = {
          message: data.message || "(no message)",
          source: data.source || "main-process",
          stack: data.stack || "",
          timestamp: Date.now(),
          type: "main-process",
        };
        if (_shouldCapture(captured)) addError(captured);
      });
    }
  } catch {
    /* preload might not be ready */
  }

  // ── window.onerror ──────────────────────────────────────────────────
  const origOnerror = window.onerror;
  window.onerror = ((
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ) => {
    const msg = typeof message === "string" ? message : String(message);
    // Benign browser diagnostics (e.g. ResizeObserver loop completion) also
    // arrive through window.onerror as uncaught "exceptions" — skip them so
    // they never surface, matching the console.error filter below.
    if (!isBenignRendererDiagnostic(msg)) {
      // Land the error in the log bus + file. The console transport replays
      // ERROR to console.error, which our own interceptor would otherwise add
      // AGAIN (type "console") — suppress it during the emit so a single
      // uncaught error is only shown once.
      const captured: CapturedError = {
        message: msg,
        source: source || "",
        stack: error?.stack || "",
        timestamp: Date.now(),
        type: "exception",
      };
      if (_shouldCapture(captured)) {
        _suppressConsoleCapture = true;
        try {
          log.error("uncaught-error", {
            message: captured.message,
            source: captured.source || "",
            stack: captured.stack,
          });
        } finally {
          _suppressConsoleCapture = false;
        }
        addError(captured);
      }
    }
    if (typeof origOnerror === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origOnerror as any)(message, source, lineno, colno, error);
    }
    return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // ── Unhandled rejections ────────────────────────────────────────────
  const origOnrejection = window.onunhandledrejection;
  window.onunhandledrejection = ((event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const captured: CapturedError = {
      message: reason?.message || String(reason),
      source: "",
      stack: reason?.stack || "",
      timestamp: Date.now(),
      type: "rejection",
    };
    if (_shouldCapture(captured)) {
      // Land the rejection in the log bus + file (suppress the replay into the
      // console interceptor so it isn't double-counted as a console error).
      _suppressConsoleCapture = true;
      try {
        log.error("unhandled-rejection", {
          message: captured.message,
          stack: captured.stack,
        });
      } finally {
        _suppressConsoleCapture = false;
      }
      addError(captured);
    }
    if (typeof origOnrejection === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (origOnrejection as any)(event);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // ── console.error interception ──────────────────────────────────────
  // eslint-disable-next-line no-console
  const origConsoleError = console.error;
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    const msg = args.map((a: unknown) => (typeof a === "object" ? String(a) : String(a))).join(" ");
    // Skip benign browser-internal warnings that are not real app errors
    if (isBenignRendererDiagnostic(msg)) {
      origConsoleError.apply(console, args);
      return;
    }
    // Suppress the re-entry from this service's own log.error emit so a single
    // uncaught error isn't surfaced twice (see _suppressConsoleCapture).
    if (_suppressConsoleCapture) {
      origConsoleError.apply(console, args);
      return;
    }
    // Per-error opt-out: a structured config object (`{ skipToast: true }`)
    // logged alongside the message suppresses the toast for this entry only.
    const skipToast = _skipToastRequested(args);
    // Breadcrumb so a Sentry event (uncaught errors are auto-captured by the
    // browser SDK's global handler) carries the console context that preceded
    // it. Safe no-op when Sentry isn't initialized (e.g. no DSN).
    const captured: CapturedError = {
      message: msg,
      source: "",
      stack: new Error().stack || "",
      timestamp: Date.now(),
      type: "console",
      ...(skipToast ? { skipToast: true } : {}),
    };
    if (_shouldCapture(captured)) {
      try {
        Sentry.addBreadcrumb({
          category: "console",
          level: "error",
          message: msg.slice(0, 300),
        });
      } catch {
        // never let telemetry throw
      }
      addError(captured);
    }
    origConsoleError.apply(console, args);
  };

  // Restore any errors stored from a previous page load — surface a single
  // summary toast (never a blocking screen). Clicking it opens the Logs window.
  // The summary toast follows the same global toast policy.
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      errors = JSON.parse(stored);
      if (errors.length > 0) {
        if (_toastEnabled) {
          toastService.show(
            `${errors.length} error${errors.length !== 1 ? "s" : ""} detected from a previous session`,
            "error",
            0,
            () => {
              window.openp41ge?.windowManager.openLogsWindow();
            },
          );
        }
        emitChanges();
      }
    }
  } catch {
    /* ignore */
  }

  // ── Default toast policy by environment ────────────────────────────────
  // Surface error toasts in dev, suppress them for packaged (production)
  // builds. Unknown/unavailable `isDev` falls back to showing toasts.
  let dev = true;
  try {
    if (typeof window !== "undefined" && typeof window.openp41ge?.isDev === "function") {
      dev = !!window.openp41ge.isDev();
    }
  } catch {
    dev = true;
  }
  _toastEnabled = dev;
}

/**
 * True when a message is a benign browser-internal diagnostic that must NOT
 * surface as an error. The browser reports these itself (e.g. ResizeObserver
 * loop completion) and recovers internally — they are not app errors. Used in
 * BOTH the console.error interceptor and the window.onerror handler, because
 * Chromium can emit the SAME message through either path.
 */
function isBenignRendererDiagnostic(msg: string): boolean {
  return msg.includes("ResizeObserver loop completed with undelivered notifications");
}
