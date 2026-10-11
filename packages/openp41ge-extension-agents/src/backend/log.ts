/**
 * log.ts — the backend's logging.
 *
 * A backend gets the extension's logger with each call (`ctx.log`), but its
 * services are long-lived modules. The entry points this module at `ctx.log`
 * on every dispatch (`useLog`); each service logs through `logFor(name)`,
 * which prefixes its name. Nothing is logged before the first dispatch.
 */

/** The logging the backend uses (a subset of the extension's logger). */
export interface Log {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const SILENT: Log = { debug() {}, info() {}, warn() {}, error() {} };

let current: Log = SILENT;

/** Log to the extension's logger (`ctx.log`) from now on. */
export function useLog(log: Log): void {
  current = log;
}

/** A logger for one service: its messages start with `[name]`. */
export function logFor(name: string): Log {
  const tag = `[${name}]`;
  return {
    debug: (...args) => current.debug(tag, ...args),
    info: (...args) => current.info(tag, ...args),
    warn: (...args) => current.warn(tag, ...args),
    error: (...args) => current.error(tag, ...args),
  };
}
