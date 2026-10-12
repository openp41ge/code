/**
 * AutoUpdaterService — wires electron-updater into the main process.
 *
 * The update channel is driven by the persisted `updateChannel` config value
 * (set in Settings), NOT by the channel baked into `app-update.yml` at build
 * time. This is what keeps the semantic clean:
 *
 *   - `updateChannel = "latest"` (the default) -> `allowPrerelease = false`.
 *     The GitHub provider then only ever resolves GitHub's "latest" release,
 *     which is guaranteed to be a non-prerelease -> stable users can NEVER be
 *     offered an alpha/beta build.
 *   - `updateChannel = "alpha" | "beta" | "rc"` -> `allowPrerelease = true`
 *     and the matching channel, so the atom-feed walk can pick up prereleases.
 *
 * Only runs in a packaged build (dev has no `app-update.yml` / no feed). The
 * updater object is injected (or lazily imported) so unit tests can drive the
 * configuration logic without touching electron-updater.
 */

import { app } from "electron";
import { createLogger } from "openp41ge-core-logger";
import type { ConfigService } from "../src/main/services/config-service.js";

const log = createLogger("openp41ge", "auto-updater");

/** Update channels understood by electron-updater's GitHub provider.
 *  `latest` is the stable/default channel; prereleases mirror the version suffix. */
export const UPDATE_CHANNELS = ["latest", "alpha", "beta", "rc"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** electron-updater error codes that mean "nothing newer on this channel"
 *  rather than a real failure. The GitHub provider throws these when no
 *  release exists for the channel (e.g. a stable channel while only
 *  prereleases are published, or an empty feed) — not an error state, just
 *  "you're already up to date". */
export const NO_UPDATE_ERROR_CODES = new Set([
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
]);

/** The slice of electron-updater's `AppUpdater` the service needs. */
export interface UpdaterLike {
  channel: string | null;
  allowPrerelease: boolean;
  autoDownload: boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  checkForUpdates: () => Promise<unknown>;
  checkForUpdatesAndNotify: () => Promise<unknown>;
  /** Stage the update that `checkForUpdates` resolved (no-op until checked). */
  downloadUpdate: (cancellationToken?: unknown) => Promise<unknown>;
  quitAndInstall: () => void;
}

/** Renderer-facing update status snapshot. */
export type UpdaterStatus =
  | { state: "idle"; channel: string }
  | { state: "checking"; channel: string }
  | { state: "update-available"; version: string }
  | { state: "update-not-available"; version: string }
  | {
      state: "downloading";
      version: string;
      progress: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { state: "update-downloaded"; version: string }
  | { state: "error"; message: string };

export interface AutoUpdaterOptions {
  /** Overrides `app.isPackaged` (used by tests). */
  isPackaged?: boolean;
  /** Injects the updater implementation (used by tests); default lazy-imports electron-updater. */
  updaterFactory?: () => Promise<UpdaterLike>;
  /** Overrides the installed version (used by tests); default reads `app.getVersion()`. */
  getVersion?: () => string;
}

/** Pure mapping from a persisted channel value to the electron-updater config. */
export function updaterSettingsForChannel(channel: string): {
  channel: UpdateChannel;
  allowPrerelease: boolean;
} {
  const normalized = (UPDATE_CHANNELS as readonly string[]).includes(channel)
    ? (channel as UpdateChannel)
    : "latest";
  return { channel: normalized, allowPrerelease: normalized !== "latest" };
}

export class AutoUpdaterService {
  private _updater: UpdaterLike | null | undefined;
  private _status: UpdaterStatus = { state: "idle", channel: "latest" };
  private _statusListeners = new Set<(status: UpdaterStatus) => void>();
  private _started = false;
  /** The version currently being downloaded (captured from `update-available`). */
  private _targetVersion: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly options: AutoUpdaterOptions = {},
  ) {}

  /** The client's configured channel (validated, defaults to "latest"). */
  getChannel(): UpdateChannel {
    const raw = this.configService.get("updateChannel");
    const val = typeof raw === "string" ? raw : "latest";
    return updaterSettingsForChannel(val).channel;
  }

  /** The installed app version (e.g. "0.1.0"), or "" in dev if unavailable. */
  getCurrentVersion(): string {
    if (this.options.getVersion) return this.options.getVersion();
    try {
      return app.getVersion();
    } catch {
      return "";
    }
  }

  /** Current update status snapshot (safe to query before start()). */
  getStatus(): UpdaterStatus {
    return this._status;
  }

  /** Subscribe to update status changes. Returns unsubscribe. */
  onStatus(callback: (status: UpdaterStatus) => void): () => void {
    this._statusListeners.add(callback);
    return () => this._statusListeners.delete(callback);
  }

  /**
   * Configure electron-updater from the persisted channel and check on startup.
   * No-op in dev (unpackaged) or when called twice.
   */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    if (!this._packaged()) {
      log.info("auto-update disabled (dev build — no packaged updater feed)");
      return;
    }

    const { channel, allowPrerelease } = updaterSettingsForChannel(this.getChannel());
    const updater = await this._loadUpdater();
    if (!updater) return;

    updater.channel = channel;
    updater.allowPrerelease = allowPrerelease;
    // User-controlled: nothing is staged until the user picks a version in the
    // Releases tab and calls `downloadUpdate()`. The app never silently updates.
    updater.autoDownload = false;
    this._wireEvents(updater);

    log.info("auto-update ready", { channel, allowPrerelease });
    // Check on app open (not when the Releases tab is opened) so the pending
    // version is already known by the time the user reaches the tab. The check
    // is async and never blocks startup; the short deferral only lets the main
    // window finish creating. autoDownload=false means it resolves the version
    // without staging anything — the user still decides to download.
    setTimeout(() => {
      void this.checkForUpdates();
    }, 1500);
  }

  /** Trigger an update check now (idempotent; safe pre-start). */
  async checkForUpdates(): Promise<UpdaterStatus> {
    const updater = this._packaged() ? await this._loadUpdater() : null;
    if (!updater) {
      this._setStatus({ state: "error", message: this._unavailable() });
      return this._status;
    }
    this._setStatus({ state: "checking", channel: updater.channel ?? "latest" });
    try {
      // Silent check (no OS notification) — the Releases tab is the surface.
      await updater.checkForUpdates();
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      const message = err instanceof Error ? err.message : String(err);
      if (NO_UPDATE_ERROR_CODES.has(code)) {
        // Nothing newer on this channel (e.g. no stable release published yet,
        // or an empty feed). Report it as "up to date" rather than surfacing the
        // raw GitHub/feed error to the Releases tab. Log it as a warning so the
        // empty channel is visible without being presented as a hard error.
        log.warn("no published release on channel", {
          channel: updater.channel ?? "latest",
          code,
        });
        this._setStatus({ state: "update-not-available", version: this.getCurrentVersion() });
      } else {
        log.error("update check failed:", message);
        this._setStatus({ state: "error", message });
      }
    }
    return this._status;
  }

  /**
   * Stage the update that the last check resolved (the latest build for the
   * configured channel). Returns once the download COMPLETES (so the renderer
   * can prompt the user to restart). Idempotent-ish: if already downloaded,
   * returns immediately.
   */
  async downloadUpdate(): Promise<UpdaterStatus> {
    const updater = this._packaged() ? await this._loadUpdater() : null;
    if (!updater) {
      this._setStatus({ state: "error", message: this._unavailable() });
      return this._status;
    }
    // If the last check never resolved an update, run one first so the updater
    // has the update info to download.
    if (this._status.state !== "update-available" && this._status.state !== "downloading") {
      try {
        await updater.checkForUpdates();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this._setStatus({ state: "error", message });
        return this._status;
      }
    }
    if (this._status.state !== "update-available" && this._status.state !== "downloading") {
      this._setStatus({ state: "error", message: "no update available to download" });
      return this._status;
    }
    try {
      log.info("downloading update", { version: this._status.version });
      await updater.downloadUpdate();
    } catch (err) {
      if (this._status.state !== "downloading") {
        const message = err instanceof Error ? err.message : String(err);
        log.error("update download failed:", message);
        this._setStatus({ state: "error", message });
      }
    }
    return this._status;
  }

  /** Download-and-install the staged update (called when the user confirms). */
  quitAndInstall(): void {
    const updater = this._updater;
    if (!updater) return;
    try {
      updater.quitAndInstall();
    } catch (err) {
      log.error("quitAndInstall failed:", err);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _packaged(): boolean {
    return this.options.isPackaged ?? app.isPackaged;
  }

  /** Why there is no updater: a dev build has none (no packaged feed). */
  private _unavailable(): string {
    return this._packaged()
      ? "auto-update is not available"
      : "auto-update is not available in development mode";
  }

  private async _loadUpdater(): Promise<UpdaterLike | null> {
    if (this._updater !== undefined) return this._updater;
    if (this.options.updaterFactory) {
      this._updater = (await this.options.updaterFactory()) ?? null;
      return this._updater;
    }
    try {
      // Lazy import so unit tests (and dev) never evaluate electron-updater.
      const mod = (await import("electron-updater")) as {
        autoUpdater: UpdaterLike;
      };
      this._updater = mod.autoUpdater;
    } catch (err) {
      log.error("electron-updater unavailable:", err);
      this._updater = null;
    }
    return this._updater;
  }

  private _wireEvents(updater: UpdaterLike): void {
    updater.on("checking-for-update", () => {
      this._setStatus({ state: "checking", channel: updater.channel ?? "latest" });
    });
    updater.on("update-available", (info) => {
      const version =
        info && typeof info === "object" && "version" in info
          ? String((info as { version: unknown }).version)
          : "unknown";
      this._targetVersion = version;
      this._setStatus({ state: "update-available", version });
    });
    updater.on("download-progress", (info) => {
      const p =
        info && typeof info === "object"
          ? (info as {
              percent?: number;
              bytesPerSecond?: number;
              transferred?: number;
              total?: number;
            })
          : {};
      this._setStatus({
        state: "downloading",
        version: this._targetVersion ?? "unknown",
        progress: typeof p.percent === "number" ? p.percent : 0,
        bytesPerSecond: typeof p.bytesPerSecond === "number" ? p.bytesPerSecond : 0,
        transferred: typeof p.transferred === "number" ? p.transferred : 0,
        total: typeof p.total === "number" ? p.total : 0,
      });
    });
    updater.on("update-not-available", (info) => {
      const version =
        info && typeof info === "object" && "version" in info
          ? String((info as { version: unknown }).version)
          : "current";
      this._setStatus({ state: "update-not-available", version });
    });
    updater.on("update-downloaded", (info) => {
      const version =
        info && typeof info === "object" && "version" in info
          ? String((info as { version: unknown }).version)
          : "unknown";
      this._setStatus({ state: "update-downloaded", version });
    });
    updater.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      this._setStatus({ state: "error", message });
    });
  }

  private _setStatus(status: UpdaterStatus): void {
    this._status = status;
    for (const listener of this._statusListeners) {
      try {
        listener(status);
      } catch (err) {
        log.error("status listener error:", err);
      }
    }
  }
}
