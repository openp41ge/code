/**
 * What the Releases tab and a release's grid tab read and do: the release
 * list (checked in the background by the main process), the update channel
 * setting, and the updater. One place, so tests can replace it
 * (`setReleasesDeps`).
 */

import { appServices } from "../app";
import { showConfirm } from "../confirm-service";

export interface ReleasesDeps {
  getReleases(): Promise<ReleasesSnapshot>;
  /** Check for releases now. */
  refreshReleases(): Promise<ReleasesSnapshot>;
  onReleasesChange(cb: (snapshot: ReleasesSnapshot) => void): () => void;
  /** The `updateChannel` setting ("latest" when unset). */
  getChannel(): string;
  onChannelChange(cb: (channel: string) => void): () => void;
  /** The installed app version (e.g. "0.1.0"), or "" when unknown. */
  getInstalledVersion(): Promise<string>;
  /** Download the update the updater resolves for the channel. */
  download(): Promise<UpdaterStatus>;
  getStatus(): Promise<UpdaterStatus>;
  onUpdaterStatus(cb: (status: UpdaterStatus) => void): () => void;
  quitAndInstall(): void;
  /** Ask before restarting into a downloaded update. */
  confirmRestart(): Promise<boolean>;
}

export const IDLE_STATUS: UpdaterStatus = { state: "idle", channel: "latest" };

const NO_RELEASES: ReleasesSnapshot = {
  releases: [],
  fetchedAt: null,
  checking: false,
  error: null,
};

let override: Partial<ReleasesDeps> | null = null;

/** Replace (some of) the dependencies; null restores the real ones. */
export function setReleasesDeps(deps: Partial<ReleasesDeps> | null): void {
  override = deps;
}

export function releasesDeps(): ReleasesDeps {
  return override ? { ...defaults(), ...override } : defaults();
}

function channelOf(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "latest";
}

function defaults(): ReleasesDeps {
  const bridge = window.openp41ge;
  return {
    getReleases: async () => (await bridge?.releases?.get?.()) ?? NO_RELEASES,
    refreshReleases: async () => (await bridge?.releases?.refresh?.()) ?? NO_RELEASES,
    onReleasesChange: (cb) => bridge?.releases?.onChange?.(cb) ?? (() => {}),
    getChannel: () => channelOf(appServices.configService.get("updateChannel")),
    onChannelChange: (cb) =>
      appServices.configService.onKeyChange("updateChannel", (v) => cb(channelOf(v))),
    getInstalledVersion: async () => (await bridge?.updater?.getCurrentVersion?.()) ?? "",
    download: async () => (await bridge?.updater?.download?.()) ?? IDLE_STATUS,
    getStatus: async () => (await bridge?.updater?.getStatus?.()) ?? IDLE_STATUS,
    onUpdaterStatus: (cb) => bridge?.updater?.onStatus?.(cb) ?? (() => {}),
    quitAndInstall: () => void bridge?.updater?.quitAndInstall?.(),
    confirmRestart: () =>
      showConfirm({
        message: "Restart now to install the update? Your session will be preserved on relaunch.",
        confirmLabel: "Restart",
        cancelLabel: "Later",
      }),
  };
}
