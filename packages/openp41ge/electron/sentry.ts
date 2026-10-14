/**
 * openp41ge-sentry — Sentry (error monitoring) init for the Electron main
 * process.
 *
 * This module is imported ONLY by electron-process entry code
 * (`electron/main.ts`). It depends on the `electron` module (`app`), and must
 * stay out of the import graph of `src/main/services/*` so unit tests
 * (which run without Electron) never load it.
 *
 * The windows (renderers) forward their errors to the main
 * process over Sentry's IPC (see `@sentry/electron`), so this single
 * main-process init is the one place with the real DSN. The renderer SDK only
 * needs a bare `Sentry.init()`; the DSN and environment are propagated by
 * `@sentry/electron` itself and sent with the main client.
 *
 * The DSN is baked in as the default (Sentry DSNs are public client-side
 * identifiers, not secrets). It can still be overridden at runtime with the
 * `OPENP41GE_SENTRY_DSN` environment variable (useful for dev / pointing at a
 * different project); when the env var is set to an empty value, Sentry is
 * left disabled entirely — no network calls, no event capture.
 *
 * IMPORTANT: `Sentry.init()` MUST run before Electron's `app` "ready" event —
 * the SDK registers the `sentry-ipc` privileged scheme and IPC/protocol
 * handlers during init, and the scheme registration is only allowed before
 * ready. That is why `initSentry()` is called from `electron/main.ts` at module
 * load, ahead of `Openp41geApplication.start()`.
 */

import { app } from "electron";
import * as Sentry from "@sentry/electron/main";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "sentry");

/** Default DSN for the openp41ge Sentry project (public client-side key). */
const DEFAULT_DSN =
  "https://c8d2d39392387bbd32284dda4961ebf5@o4506695653392384.ingest.us.sentry.io/4512165816369152";

/**
 * The Sentry DSN for this app, or undefined to disable Sentry. An empty
 * `OPENP41GE_SENTRY_DSN` disables it; otherwise the env var overrides the
 * baked-in default.
 */
function sentryDsn(): string | undefined {
  const envDsn = process.env.OPENP41GE_SENTRY_DSN;
  if (envDsn !== undefined) {
    return envDsn.trim() !== "" ? envDsn.trim() : undefined;
  }
  return DEFAULT_DSN;
}

/**
 * Initialize Sentry in the main process. No-op only when a DSN is unavailable
 * (i.e. `OPENP41GE_SENTRY_DSN` is set to an empty value). Call this as early as
 * possible (before `app.whenReady()`).
 */
export function initSentry(): void {
  const dsnValue = sentryDsn();
  if (!dsnValue) {
    log.debug("Sentry disabled — OPENP41GE_SENTRY_DSN cleared.");
    return;
  }

  // Prefer the build-time injected version/channel (set by the release
  // pipeline via esbuild --define); fall back to app metadata in dev or when
  // not injected. This makes the reported release exactly match the version
  // source maps are uploaded under, and the environment reflect the channel.
  const bakedVersion =
    typeof __OPENP41GE_VERSION__ !== "undefined" ? __OPENP41GE_VERSION__ : undefined;
  const bakedChannel =
    typeof __OPENP41GE_CHANNEL__ !== "undefined" ? __OPENP41GE_CHANNEL__ : undefined;
  const version = bakedVersion && bakedVersion !== "0.0.0-dev" ? bakedVersion : app.getVersion();
  const environment =
    bakedChannel && bakedChannel !== "development"
      ? bakedChannel
      : app.isPackaged
        ? "production"
        : "development";

  Sentry.init({
    dsn: dsnValue,
    release: version,
    environment,
    // Error monitoring for now; adjust once tracing is wanted.
    tracesSampleRate: 0,
  });
  log.debug(`Sentry initialized (environment=${environment}, release=${version}).`);
}
