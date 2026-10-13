/**
 * openp41ge-releases-pane — the manager window's Releases sidebar tab.
 *
 * The app's published releases, one row each (tag, channel, a Current pill
 * on the installed one, date):
 *   - **Releases** (default): every release in the range the `updateChannel`
 *     setting allows (e.g. `alpha` → alpha, beta, rc and stable), newest first.
 *   - **Channels** (the bottom bar's toggle): the latest release of each
 *     channel in that range.
 * Clicking a row opens the release in a grid tab (a double click pins it):
 * the pane dispatches `open-release` ({ tag, pinned }) for the manager.
 *
 * The list comes from the main process, which checks in the background (see
 * electron/releases-feed.ts), so showing the tab fetches nothing. Skeleton
 * rows show until there is a list; the refresh button checks now, and says
 * in a toast when that check fails (a failed background check keeps the list
 * quietly). The bottom bar holds buttons, never messages.
 *
 * Release text is untrusted external text and is rendered escaped (never
 * `unsafeHTML`).
 */
import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createLogger } from "openp41ge-core-logger";
import { releasesDeps } from "../services/releases-deps";
import { toastService } from "./openp41ge-toast";
import {
  selectInRange,
  selectLatestPerChannel,
  channelFromTag,
  formatReleaseDate,
  type GithubRelease,
} from "../services/releases-service";

const log = createLogger("openp41ge", "releases-pane");

export const CHANNEL_LABELS: Record<string, string> = {
  latest: "Stable",
  stable: "Stable",
  alpha: "Alpha",
  beta: "Beta",
  rc: "RC",
};

/** Skeleton rows shown while there is no list yet. */
const SKELETON_ROWS = 6;

/** The Channels toggle's icon (Material Symbols "notes"). */
const CHANNELS_ICON = html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
  <path d="M280-240v-80h400v80H280ZM120-440v-80h720v80H120Zm160-200v-80h400v80H280Z" />
</svg>`;

const REFRESH_ICON = html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
  <path
    d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"
  />
</svg>`;

/** A release tag as the updater writes versions ("v0.1.0" → "0.1.0"). */
export function releaseVersion(tag: string): string {
  return tag.replace(/^v/i, "");
}

@customElement("openp41ge-releases-pane")
export class Openp41geReleasesPane extends LitElement {
  @state() private _snapshot: ReleasesSnapshot = {
    releases: [],
    fetchedAt: null,
    checking: true,
    error: null,
  };
  @state() private _channel = "latest";
  @state() private _installedVersion = "";
  /** Show the latest of each channel instead of every release. */
  @state() private _channelsView = false;

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
  }

  override disconnectedCallback(): void {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    super.disconnectedCallback();
  }

  private _visible(): GithubRelease[] {
    const releases = [...this._snapshot.releases];
    return this._channelsView
      ? selectLatestPerChannel(this._channel, releases)
      : selectInRange(this._channel, releases);
  }

  private _open(tag: string, pinned: boolean): void {
    this.dispatchEvent(
      new CustomEvent("open-release", { detail: { tag, pinned }, bubbles: true, composed: true }),
    );
  }

  private _refresh(): void {
    void releasesDeps()
      .refreshReleases()
      .then(
        (snapshot) => {
          if (snapshot.error) this._checkFailed(snapshot.error);
        },
        (err: unknown) => this._checkFailed(err),
      );
  }

  private _checkFailed(err: unknown): void {
    log.warn("releases check failed:", err);
    toastService.show("Couldn't check for releases", "error", 5000);
  }

  override render(): TemplateResult {
    const { checking, fetchedAt } = this._snapshot;
    const hasList = this._snapshot.releases.length > 0 || (fetchedAt !== null && !checking);
    return html`
      <div class="rp">
        <div class="rp-scroll" role="list">${this._body(hasList)}</div>
        <footer class="rp-footer">
          <span class="rp-footer-spacer"></span>
          <button
            class="rp-footer-btn"
            aria-label="Show the latest of each channel"
            title="Show the latest of each channel"
            aria-pressed=${this._channelsView ? "true" : "false"}
            @click=${() => {
              this._channelsView = !this._channelsView;
            }}
          >
            ${CHANNELS_ICON}
          </button>
          <button
            class="rp-footer-btn"
            aria-label="Check for releases"
            title="Check for releases"
            aria-busy=${checking ? "true" : "false"}
            @click=${() => this._refresh()}
          >
            ${REFRESH_ICON}
          </button>
        </footer>
      </div>
    `;
  }

  private _body(hasList: boolean): TemplateResult | TemplateResult[] {
    if (!hasList) {
      if (this._snapshot.error && !this._snapshot.checking) {
        return html`<p class="rp-state rp-state--error" title=${this._snapshot.error}>
          Couldn't check for releases.
        </p>`;
      }
      return Array.from(
        { length: SKELETON_ROWS },
        () =>
          html`<div class="rp-skeleton" aria-hidden="true">
            <span class="rp-bone rp-bone--tag"></span>
            <span class="rp-bone rp-bone--date"></span>
          </div>`,
      );
    }
    const visible = this._visible();
    if (visible.length === 0) return html`<p class="rp-state">No releases yet.</p>`;
    return visible.map((r) => this._row(r));
  }

  private _row(r: GithubRelease): TemplateResult {
    const channel = channelFromTag(r.tag_name);
    const installed = releaseVersion(r.tag_name) === this._installedVersion;
    return html`<div
      class="rp-row"
      role="listitem"
      data-tag=${r.tag_name}
      title=${r.tag_name}
      @click=${() => this._open(r.tag_name, false)}
      @dblclick=${() => this._open(r.tag_name, true)}
    >
      <div class="rp-row-head">
        <span class="rp-tag">${r.tag_name}</span>
        <span class="rp-badge rp-badge--${channel}">${CHANNEL_LABELS[channel] ?? channel}</span>
        ${installed ? html`<span class="rp-chip rp-chip--current">Current</span>` : nothing}
      </div>
      <div class="rp-date">${formatReleaseDate(r.published_at)}</div>
    </div>`;
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      color: var(--text-primary, #d4d4d4);
    }
    .rp {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .rp-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .rp-state {
      margin: 0;
      padding: 10px;
      font-size: 12px;
      font-style: italic;
      color: var(--muted-color, #8b93a1);
    }
    .rp-state--error {
      color: #e57373;
    }
    /* ── Rows ─────────────────────────────────────────────────────────── */
    .rp-row,
    .rp-skeleton {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--divider, #2a2a2a);
    }
    .rp-row {
      cursor: pointer;
      user-select: none;
    }
    .rp-row:hover {
      background: var(--bg-hover, #2a2d2e);
    }
    .rp-row-head {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .rp-tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rp-date {
      font-size: 10px;
      color: var(--muted-color, #8b93a1);
    }
    .rp-badge,
    .rp-chip {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 600;
      padding: 0 6px;
      border-radius: 999px;
    }
    .rp-badge {
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .rp-badge--stable,
    .rp-chip--current {
      background: rgba(111, 200, 114, 0.16);
      color: #6fc872;
    }
    .rp-badge--alpha {
      background: rgba(237, 137, 54, 0.16);
      color: #ef8946;
    }
    .rp-badge--beta {
      background: rgba(190, 137, 255, 0.16);
      color: #c597ff;
    }
    .rp-badge--rc {
      background: rgba(79, 156, 249, 0.16);
      color: #6aa9ff;
    }
    /* ── Skeleton rows ────────────────────────────────────────────────── */
    .rp-bone {
      display: block;
      height: 10px;
      border-radius: 3px;
      background: var(--bg-tertiary, #2c2c2c);
      animation: rp-pulse 1.2s ease-in-out infinite;
    }
    .rp-bone--tag {
      width: 60%;
      height: 12px;
    }
    .rp-bone--date {
      width: 30%;
    }
    @keyframes rp-pulse {
      50% {
        opacity: 0.45;
      }
    }
    /* ── Bottom bar: square buttons ──────────────────────────── */
    .rp-footer {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      height: 34px;
      padding-left: 10px;
      border-top: 1px solid var(--divider, #333);
      background: var(--bg-secondary, #161616);
    }
    .rp-footer-spacer {
      flex: 1;
    }
    .rp-footer-btn {
      border: none;
      background: transparent;
      color: var(--text-secondary, #999);
      border-radius: 0;
      height: 100%;
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      border-left: 1px solid var(--divider, #333);
      user-select: none;
    }
    .rp-footer-btn:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .rp-footer-btn[aria-pressed="true"] {
      color: var(--accent, #4a9eff);
    }
    .rp-footer-btn svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    /* A check is running: the refresh icon is blue and turns, pauses, turns… */
    .rp-footer-btn[aria-busy="true"] {
      color: var(--accent, #4a9eff);
    }
    .rp-footer-btn[aria-busy="true"] svg {
      animation: rp-spin 1.4s ease-in-out infinite;
    }
    @keyframes rp-spin {
      0% {
        transform: rotate(0deg);
      }
      50%,
      100% {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .rp-footer-btn[aria-busy="true"] svg {
        animation: none;
      }
    }
  `;
}
