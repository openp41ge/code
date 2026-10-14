/**
 * Forward the main process's console.error to the renderer windows (their
 * error overlay) and Sentry's breadcrumbs, still printing it.
 *
 * An error raised while forwarding one is printed, not forwarded: sending to
 * a window whose page is going away (closing, reloading) makes Electron
 * console.error, and forwarding that again recursed forever (the main process
 * froze at 100% CPU).
 */

export interface ConsoleErrorForwarding {
  /** Send the message to every renderer window. */
  forward(message: string): void;
  /** Record it as a Sentry breadcrumb. */
  breadcrumb(message: string): void;
}

/** Whether `msg` is a Node diagnostic, not an application error. */
function isNodeWarning(msg: string): boolean {
  return (
    (/^\(node:\d+\)\s*Warning:/i.test(msg.trim()) ||
      msg.includes("Closing file descriptor") ||
      msg.includes("MaxListenersExceededWarning") ||
      msg.includes("DeprecationWarning")) &&
    !msg.toLowerCase().includes("error")
  );
}

/** Replace `target.error` with the forwarding one. */
export function installConsoleErrorForwarder(
  target: Console,
  forwarding: ConsoleErrorForwarding,
): void {
  const origError = target.error;
  let busy = false;
  target.error = (...args: unknown[]) => {
    const msg = args.map((a) => String(a)).join(" ");
    // Pure Node diagnostics are not application errors and would otherwise
    // freeze every window in the blocking overlay.
    if (!busy && !isNodeWarning(msg) && msg.trim().length > 0) {
      busy = true;
      try {
        forwarding.breadcrumb(msg.slice(0, 300));
        forwarding.forward(msg);
      } finally {
        busy = false;
      }
    }
    origError.apply(target, args);
  };
}
