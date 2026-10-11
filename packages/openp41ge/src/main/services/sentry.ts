/**
 * openp41ge-sentry-client — safe Capture helpers for the main process.
 *
 * This module is the single place main-process services (`src/main/services/*`)
 * capture errors / breadcrumbs to Sentry. It intentionally does NOT import the
 * `electron` module, so unit tests can import these services without Electron
 * present (in test, `@sentry/electron/main` is aliased to a no-op stub and the
 * helpers short-circuit).
 *
 * All helpers are safe to call from anywhere: they are no-ops when Sentry is
 * not initialized (e.g. no DSN / during tests), and they never throw
 * themselves. Callers should treat Sentry as best-effort telemetry, not as
 * control flow.
 */

import * as Sentry from "@sentry/electron/main";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "sentry-client");

export type SentryLogLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

export interface SentryCaptureOptions {
  /** Product-scoped tags, e.g. { operation: "chat.stream", model, channel }. */
  tags?: Record<string, string>;
  /** Extra structured context. NEVER put secrets (apiKey, tokens) or full
   *  home-directory paths here — use basenames/redacted values. */
  extra?: Record<string, unknown>;
  level?: SentryLogLevel;
}

/** True when the Sentry client is active (an init succeeded). */
function sentryReady(): boolean {
  try {
    return typeof Sentry.isInitialized === "function"
      ? Sentry.isInitialized()
      : !!Sentry.getClient();
  } catch {
    return false;
  }
}

function applyScope(scope: Sentry.Scope, options: SentryCaptureOptions): void {
  if (options.level) scope.setLevel(options.level);
  if (options.tags) scope.setTags(options.tags);
  if (options.extra) scope.setExtras(options.extra);
}

/** Capture an exception (or a non-Error value) with optional tags/extra. */
export function captureError(error: unknown, options: SentryCaptureOptions = {}): void {
  if (!sentryReady()) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.withScope((scope) => {
      applyScope(scope, options);
      Sentry.captureException(err);
    });
  } catch (e) {
    log.warn("Sentry captureException failed:", e);
  }
}

/** Capture a structured (non-exception) failure message. */
export function captureMessage(message: string, options: SentryCaptureOptions = {}): void {
  if (!sentryReady()) return;
  try {
    Sentry.withScope((scope) => {
      applyScope(scope, options);
      Sentry.captureMessage(message);
    });
  } catch (e) {
    log.warn("Sentry captureMessage failed:", e);
  }
}

/** Add a breadcrumb to the current scope (kept when events are captured). */
export function addSentryBreadcrumb(data: {
  message?: string;
  category?: string;
  level?: SentryLogLevel;
  data?: Record<string, unknown>;
}): void {
  if (!sentryReady()) return;
  try {
    Sentry.addBreadcrumb({
      ...(data.message ? { message: data.message } : {}),
      ...(data.category ? { category: data.category } : {}),
      ...(data.level ? { level: data.level } : {}),
      ...(data.data ? { data: data.data } : {}),
    });
  } catch (e) {
    log.warn("Sentry addBreadcrumb failed:", e);
  }
}

/** Set a tag on the current scope (persists until the scope is replaced). */
export function setSentryTag(key: string, value: string): void {
  if (!sentryReady()) return;
  try {
    Sentry.setTag(key, value);
  } catch (e) {
    log.warn("Sentry setTag failed:", e);
  }
}
