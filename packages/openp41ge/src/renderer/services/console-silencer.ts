/**
 * console-silencer — makes the renderer's `console.*` calls no-ops.
 *
 * Openp41ge routes all its logging through the structured log bus
 * (`openp41ge-core-logger`), which fans entries out to the in-memory buffer, the
 * log viewer, and (via the renderer→main IPC transport) the on-disk files
 * under `~/.openp41ge/logs/`. Replaying every entry to the browser console is
 * pure duplication, so this silencer replaces `console.debug/log/info/warn/
 * error` (and `trace`) with crash-proof no-ops.
 *
 * Because it replaces the `console` methods themselves, it silences **all**
 * renderer console output at once:
 *
 *   - the logger's auto-installed console transport (it calls `console.*`),
 *   - the error-capture service's `console.error` forwarding
 *     (`origConsoleError.apply`), and
 *   - raw / third-party `console.warn`/`console.error` calls.
 *
 * Design rules:
 *
 *   - **Never crashes the process.** Every override body is wrapped in
 *     try/catch so a failing call can never throw out of a `console.*` call.
 *   - **Idempotent.** `installConsoleSilencer()` is guarded by a module flag so
 *     repeated installs are safe.
 *   - **Restorable.** The originals are retained and `restoreConsoleSilencer()`
 *     puts them back (for tests / teardown).
 *   - **Drops, not re-routes.** Console output is discarded rather than re-fed
 *     into the log bus — re-feeding would create a feedback loop (log entry →
 *     console transport → `console.*` → `pushLog` → …).
 *
 * Import/install this at the VERY TOP of the renderer entry point, before
 * `Sentry.init` and before `installErrorCapture()` install their own
 * diagnostics, so even the earliest output is suppressed.
 */

/** The `console` methods the silencer neutralises. */
const SILENCED_METHODS = ["debug", "log", "info", "warn", "error", "trace"] as const;

type ConsoleMethod = (typeof SILENCED_METHODS)[number];

/** Originals captured at install time (for restore). */
const _originals = new Map<ConsoleMethod, unknown>();

let _installed = false;
let _restore: (() => void) | null = null;

/** Build a crash-proof no-op for one console method. */
function _noop(method: ConsoleMethod): (...args: unknown[]) => void {
  return ((..._args: unknown[]) => {
    try {
      // Intentionally nothing. Console output is dropped.
      void method;
    } catch {
      /* a console call must never crash the renderer */
    }
  }) as (...args: unknown[]) => void;
}

/**
 * Replace the renderer's `console.*` methods with safe no-ops. Idempotent —
 * a second call is a no-op. Returns the original console methods (or `null`
 * if already installed).
 */
export function installConsoleSilencer(): (ConsoleMethod | null)[] | null {
  if (_installed) return null;
  _installed = true;

  const methods: (ConsoleMethod | null)[] = [];
  for (const method of SILENCED_METHODS) {
    try {
      const current = (console as unknown as Record<ConsoleMethod, unknown>)[method];
      if (typeof current === "function") {
        _originals.set(method, current);
      }
      Object.defineProperty(console, method, {
        configurable: true,
        writable: true,
        value: _noop(method),
      });
      methods.push(method);
    } catch {
      // Some environments refuse to override console methods — never crash.
      methods.push(null);
    }
  }

  _restore = () => {
    for (const method of SILENCED_METHODS) {
      try {
        const original = _originals.get(method);
        if (original !== undefined) {
          Object.defineProperty(console, method, {
            configurable: true,
            writable: true,
            value: original,
          });
        }
      } catch {
        /* ignore */
      }
    }
    _originals.clear();
    _restore = null;
    _installed = false;
  };

  return methods;
}

/**
 * Restore the original `console.*` methods. Safe to call when not installed.
 */
export function restoreConsoleSilencer(): void {
  _restore?.();
  _installed = false;
}

/** True once the silencer has been installed. */
export function isConsoleSilenced(): boolean {
  return _installed;
}
