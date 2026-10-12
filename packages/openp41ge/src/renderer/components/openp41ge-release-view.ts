/**
 * openp41ge-release-view — a release's grid tab (the `release` app type): its
 * tag, channel, date, notes and a link to it on GitHub.
 *
 * The build the updater can install — the latest release of the configured
 * update channel — offers Download (unless it is installed). Clicking it
 * shows "Downloading…" at once: the updater may first check again, and a
 * download may send no progress until it is done. Then the progress, then
 * Update, which asks before restarting into it.
 *
 * Release notes are untrusted external text and are rendered escaped (never
 * `unsafeHTML`).
 */
import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createLogger } from "openp41ge-core-logger";
import { IDLE_STATUS, releasesDeps } from "../services/releases-deps";
import {
  channelFromTag,
  channelsForUpdateChannel,
  formatReleaseDate,
  selectLatestPerChannel,
} from "../services/releases-service";
import { CHANNEL_LABELS, releaseVersion } from "./openp41ge-releases-pane";

const log = createLogger("openp41ge", "release-view");

@customElement("openp41ge-release-view")
export class Openp41geReleaseView extends LitElement {
  /** The release's tag (e.g. "v0.1.0-alpha.8"). */
  @property() tag = "";

  @state() private _snapshot: ReleasesSnapshot | null = null;
  @state() private _channel = "latest";
  @state() private _installedVersion = "";
  @state() private _status: UpdaterStatus = IDLE_STATUS;
  /** Download was clicked and the updater has not reported back yet. */
  @state() private _starting = false;

  private _unsubs: Array<() => void> = [];

  override connectedCallback(): void {
    super.connectedCallback();
    const deps = releasesDeps();
    this._channel = deps.getChannel();
    this._unsubs.push(
      deps.onChannelChange((channel) => {
        this._channel = channel;
      }),
      deps.onReleasesChange((snapshot) => {
        this._snapshot = snapshot;
      }),
      deps.onUpdaterStatus((status) => {
        this._status = status;
        // The updater re-checks (checking, update-available) before it
        // downloads; anything after that ends "Downloading…".
        if (!["idle", "checking", "update-available"].includes(status.state)) {
          this._starting = false;
        }
      }),
    );
    void deps.getReleases().then(
      (snapshot) => {
        this._snapshot = snapshot;
      },
      (err: unknown) => log.warn("releases list unavailable:", err),
    );
    void deps.getInstalledVersion().then(
      (version) => {
        this._installedVersion = version;
      },
      () => undefined,
    );
    void deps.getStatus().then(
      (status) => {
        this._status = status;
      },
      () => undefined,
    );
  }

  override disconnectedCallback(): void {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    super.disconnectedCallback();
  }

  /** Whether this release is the one the updater would install. */
  private _installable(): boolean {
    const channel = channelsForUpdateChannel(this._channel)[0];
    const latest = selectLatestPerChannel(this._channel, [
      ...(this._snapshot?.releases ?? []),
    ]).find((r) => channelFromTag(r.tag_name) === channel);
    return latest?.tag_name === this.tag;
  }

  private async _download(): Promise<void> {
    this._starting = true;
    try {
      const status = await releasesDeps().download();
      this._status = status;
    } catch (err) {
      this._status = { state: "error", message: err instanceof Error ? err.message : String(err) };
    } finally {
      this._starting = false;
    }
  }

  private async _restart(): Promise<void> {
    const deps = releasesDeps();
    if (await deps.confirmRestart()) deps.quitAndInstall();
  }

  override render(): TemplateResult {
    if (!this._snapshot) return html`<p class="rv-state">Loading…</p>`;
    const r = this._snapshot.releases.find((x) => x.tag_name === this.tag);
    if (!r) {
      return html`<p class="rv-state">${this.tag} isn't in the release list.</p>`;
    }
    const channel = channelFromTag(r.tag_name);
    const installed = releaseVersion(r.tag_name) === this._installedVersion;
    return html`
      <article class="rv">
        <header class="rv-head">
          <h2 class="rv-tag">${r.tag_name}</h2>
          <span class="rv-badge rv-badge--${channel}">${CHANNEL_LABELS[channel] ?? channel}</span>
          ${installed ? html`<span class="rv-chip">Installed</span>` : nothing}
          <span class="rv-date">${formatReleaseDate(r.published_at)}</span>
        </header>
        <div class="rv-actions">
          ${!installed && this._installable() ? this._update(releaseVersion(r.tag_name)) : nothing}
          ${
            r.html_url
              ? html`<a
                  class="rv-github"
                  href=${r.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  >View on GitHub</a
                >`
              : nothing
          }
        </div>
        ${r.body ? html`<div class="rv-notes">${r.body}</div>` : nothing}
      </article>
    `;
  }

  /** Download / its progress / Update, for the installable build. */
  private _update(version: string): TemplateResult {
    const s = this._status;
    if (s.state === "update-downloaded" && releaseVersion(s.version) === version) {
      return html`<span class="rv-note">Downloaded</span>
        <button class="rv-btn rv-btn--update" @click=${() => void this._restart()}>Update</button>`;
    }
    if (s.state === "downloading" && releaseVersion(s.version) === version) {
      return html`<span class="rv-progress"
          ><span class="rv-progress-bar" style="width:${s.progress}%"></span></span
        ><span class="rv-note">${Math.round(s.progress)}%</span>`;
    }
    if (this._starting) {
      return html`<span class="rv-progress rv-progress--busy"
          ><span class="rv-progress-bar"></span></span
        ><span class="rv-note">Downloading…</span>`;
    }
    return html`${s.state === "error" ? html`<span class="rv-error">${s.message}</span>` : nothing}
      <button class="rv-btn rv-btn--download" @click=${() => void this._download()}>
        Download
      </button>`;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      color: var(--text-primary, #d4d4d4);
    }
    .rv {
      padding: 16px 20px;
      max-width: 860px;
    }
    .rv-state {
      margin: 0;
      padding: 16px 20px;
      font-size: 13px;
      color: var(--muted-color, #8b93a1);
    }
    .rv-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .rv-tag {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 16px;
      font-weight: 600;
    }
    .rv-badge,
    .rv-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 999px;
    }
    .rv-badge {
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .rv-badge--stable,
    .rv-chip {
      background: rgba(111, 200, 114, 0.16);
      color: #6fc872;
    }
    .rv-badge--alpha {
      background: rgba(237, 137, 54, 0.16);
      color: #ef8946;
    }
    .rv-badge--beta {
      background: rgba(190, 137, 255, 0.16);
      color: #c597ff;
    }
    .rv-badge--rc {
      background: rgba(79, 156, 249, 0.16);
      color: #6aa9ff;
    }
    .rv-date {
      margin-left: auto;
      font-size: 12px;
      color: var(--muted-color, #8b93a1);
    }
    .rv-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0 16px;
      min-height: 26px;
    }
    .rv-btn {
      font: inherit;
      font-size: 12px;
      height: 26px;
      padding: 0 14px;
      border: 1px solid var(--divider, #333);
      border-radius: 0;
      background: transparent;
      cursor: pointer;
    }
    .rv-btn:hover {
      background: var(--bg-active, #37373d);
    }
    .rv-btn--download {
      color: #6fc872;
    }
    .rv-btn--update {
      color: #6aa9ff;
    }
    .rv-progress {
      position: relative;
      width: 120px;
      height: 6px;
      overflow: hidden;
      background: var(--bg-tertiary, #333);
    }
    .rv-progress-bar {
      display: block;
      height: 100%;
      background: var(--accent, #4a9eff);
      transition: width 0.15s linear;
    }
    /* Busy (no progress yet): a bar sweeping across. */
    .rv-progress--busy .rv-progress-bar {
      position: absolute;
      width: 35%;
      animation: rv-sweep 1.1s ease-in-out infinite;
    }
    @keyframes rv-sweep {
      from {
        left: -35%;
      }
      to {
        left: 100%;
      }
    }
    .rv-note {
      font-size: 12px;
      color: var(--muted-color, #8b93a1);
    }
    .rv-error {
      font-size: 12px;
      color: #e57373;
    }
    .rv-github {
      font-size: 12px;
      color: var(--accent, #4a9eff);
      text-decoration: none;
    }
    .rv-github:hover {
      text-decoration: underline;
    }
    .rv-notes {
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
      color: color-mix(in srgb, var(--text-primary, #d4d4d4) 85%, #000);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-release-view": Openp41geReleaseView;
  }
}
