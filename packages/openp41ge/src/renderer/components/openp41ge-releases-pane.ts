/**
 * openp41ge-releases-pane — the management window's Releases tab.
 *
 * Stale-while-revalidate catalog of the app's published GitHub releases. It
 * shows ONLY the latest build per channel in the user's configured update
 * window (e.g. for `alpha`: latest alpha + latest beta + latest rc + latest
 * stable), caches the list locally so it renders instantly on re-open, and
 * revalidates in the background.
 *
 * The pane also drives the user-controlled updater:
 *   - Shows which version is installed.
 *   - Offers an **Update** action on the latest build of the configured
 *     channel (the only build electron-updater can stage). The app never
 *     auto-downloads.
 *   - Streams download progress and, once downloaded, prompts the user to
 *     restart (via the confirm modal) before calling quit-and-install.
 *   - Every card has a **History** button opening a drawer that lists all
 *     versions ever published for that channel (lazily paging the GitHub API).
 *
 * Visual language: each release is a full-width bordered card, with the
 * Update / History actions BELOW the card as a right-aligned row of separate
 * boxed buttons.
 * The tab's own refresh control lives in a bottom bar (a square button with
 * a separator).
 *
 * Release notes are untrusted external text and are rendered escaped (never
 * `unsafeHTML`), so a crafted description cannot inject markup.
 *
 * Test seams: override the static `deps`. By default the real GitHub API, the
 * platform ConfigService and the `window.openp41ge.updater` bridge are used.
 */
import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { appServices } from "../app";
import { showConfirm } from "../confirm-service";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "releases-pane");
import {
  fetchReleases,
  fetchReleasesPage,
  selectLatestPerChannel,
  channelsForUpdateChannel,
  channelFromTag,
  formatReleaseDate,
  type GithubRelease,
  type ReleaseChannel,
} from "../services/releases-service";
// `UpdaterStatus` is a global ambient type from global.d.ts.

/** Injectable seams used by the pane. Tests replace these via the static. */
export interface ReleasesPaneDeps {
  fetchReleases?: (signal?: AbortSignal) => Promise<GithubRelease[]>;
  fetchReleasesPage?: (page: number, signal?: AbortSignal) => Promise<GithubRelease[]>;
  getChannel: () => string;
  onChannelChange: (cb: (channel: string) => void) => () => void;
  /** The installed app version (e.g. "0.1.0"), or "" when unknown. */
  getInstalledVersion: () => Promise<string>;
  /** Stage (download) the update the updater last resolved for the channel. */
  download: () => Promise<UpdaterStatus>;
  getStatus: () => Promise<UpdaterStatus>;
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void) => () => void;
  quitAndInstall: () => void;
  /** Prompt the user to restart after an update downloads. Resolves true to proceed. */
  confirmRestart: () => Promise<boolean>;
  loadCache?: () => { releases: GithubRelease[]; fetchedAt: number } | null;
  saveCache?: (data: { releases: GithubRelease[]; fetchedAt: number }) => void;
}

const CHANNEL_LABELS: Record<string, string> = {
  latest: "Stable",
  stable: "Stable",
  alpha: "Alpha",
  beta: "Beta",
  rc: "RC",
};

const CACHE_KEY = "openp41ge:releases:cache";
const IDLE_STATUS: UpdaterStatus = { state: "idle", channel: "latest" };

/** Normalize a tag (e.g. "v0.1.0-alpha.4") to the updater's version format. */
function normVersion(tag: string): string {
  return tag.replace(/^v/i, "");
}

export interface ReleaseCache {
  releases: GithubRelease[];
  fetchedAt: number;
}

@customElement("openp41ge-releases-pane")
export class Openp41geReleasesPane extends LitElement {
  /** Injectable seams; when null the real GitHub API + ConfigService are used. */
  static deps: ReleasesPaneDeps | null = null;

  @state() private _releases: GithubRelease[] = [];
  @state() private _visible: GithubRelease[] = [];
  @state() private _loading = true;
  @state() private _stale = false;
  @state() private _error: string | null = null;
  @state() private _channel = "latest";
  @state() private _installedVersion = "";
  @state() private _status: UpdaterStatus = IDLE_STATUS;
  @state() private _drawerChannel: ReleaseChannel | null = null;
  @state() private _drawerReleases: GithubRelease[] = [];
  @state() private _drawerLoading = false;
  @state() private _drawerDone = false;
  @state() private _drawerPage = 1;

  private _unsubs: Array<() => void> = [];
  private _abort: AbortController | null = null;
  private _loadToken = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    const deps = this._resolveDeps();
    this._channel = deps.getChannel();
    this._unsubs.push(
      deps.onChannelChange((ch) => {
        this._channel = ch;
        this._recompute();
      }),
      deps.onUpdaterStatus((status) => {
        this._status = status;
      }),
    );
    void this._initInstalledVersion();
    void this._initUpdaterStatus();
    void this._load();
  }

  override disconnectedCallback(): void {
    this._abort?.abort();
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    super.disconnectedCallback();
  }

  // ── Data: SWR load ────────────────────────────────────────────────────

  private async _initInstalledVersion(): Promise<void> {
    try {
      this._installedVersion = await this._resolveDeps().getInstalledVersion();
    } catch (err) {
      log.warn("releases-pane getInstalledVersion failed:", err);
      this._installedVersion = "";
    }
  }

  /** Seed the current status so an already-downloaded update shows its prompt. */
  private async _initUpdaterStatus(): Promise<void> {
    try {
      const status = await this._resolveDeps().getStatus();
      if (status) this._status = status;
    } catch (err) {
      log.debug("releases-pane getStatus failed (status stays idle):", err);
    }
  }

  /** Load cached releases (if any) instantly, then revalidate in the background. */
  private async _load(): Promise<void> {
    this._abort?.abort();
    const controller = new AbortController();
    this._abort = controller;
    const token = ++this._loadToken;
    const deps = this._resolveDeps();

    // Stale-while-revalidate: show the cache immediately.
    const cached = deps.loadCache?.() ?? null;
    if (cached && cached.releases.length > 0) {
      this._releases = cached.releases;
      this._stale = true;
      this._loading = false;
      this._recompute();
    }

    try {
      const releases = (await deps.fetchReleases?.(controller.signal)) ?? [];
      if (token !== this._loadToken) return;
      this._releases = releases;
      this._stale = false;
      this._error = null;
      this._loading = false;
      this._recompute();
      deps.saveCache?.({ releases, fetchedAt: Date.now() });
    } catch (err) {
      if (token !== this._loadToken) return;
      this._loading = false;
      // Only surface an error if we have nothing cached to show.
      if (this._releases.length === 0) {
        this._error = err instanceof Error ? err.message : "Failed to load releases";
      }
    }
  }

  private _recompute(): void {
    this._visible = selectLatestPerChannel(this._channel, this._releases);
  }

  // ── Install flow ──────────────────────────────────────────────────────

  private get _installChannel(): ReleaseChannel {
    return channelsForUpdateChannel(this._channel)[0];
  }

  private _onInstall(): void {
    void this._resolveDeps().download();
  }

  private async _onRestart(): Promise<void> {
    const deps = this._resolveDeps();
    const ok = await deps.confirmRestart();
    if (ok) deps.quitAndInstall();
  }

  // ── History drawer ────────────────────────────────────────────────────

  private _openDrawer(channel: ReleaseChannel): void {
    this._drawerChannel = channel;
    this._drawerReleases = this._releases.filter((r) => channelFromTag(r.tag_name) === channel);
    // Page 1 is already in `_releases`; the next page to fetch is 2.
    this._drawerPage = 1;
    this._drawerDone = false;
    this._drawerLoading = false;
  }

  private _closeDrawer(): void {
    this._drawerChannel = null;
    this._drawerReleases = [];
  }

  private async _loadMoreHistory(): Promise<void> {
    const channel = this._drawerChannel;
    if (!channel || this._drawerLoading) return;
    this._drawerLoading = true;
    const nextPage = this._drawerPage + 1;
    try {
      const page = (await this._resolveDeps().fetchReleasesPage?.(nextPage)) ?? [];
      const sameChannel = page.filter((r) => channelFromTag(r.tag_name) === channel);
      const seen = new Set(this._drawerReleases.map((r) => r.tag_name));
      this._drawerReleases = [
        ...this._drawerReleases,
        ...sameChannel
          .filter((r) => !seen.has(r.tag_name))
          .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")),
      ];
      this._drawerPage = nextPage;
      this._drawerDone = page.length === 0;
    } catch (err) {
      log.warn("releases-pane drawer release load failed:", err);
      this._drawerDone = true;
    } finally {
      this._drawerLoading = false;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  private _resolveDeps(): ReleasesPaneDeps {
    const injected = Openp41geReleasesPane.deps;
    const defaults = this._defaultDeps();
    return injected ? { ...defaults, ...injected } : defaults;
  }

  private _defaultDeps(): ReleasesPaneDeps {
    return {
      fetchReleases: (signal) => fetchReleases(undefined, signal),
      fetchReleasesPage: (page, signal) => fetchReleasesPage(page, undefined, signal),
      getChannel: () => {
        const c = appServices.configService.get("updateChannel");
        return typeof c === "string" && c !== "" ? c : "latest";
      },
      onChannelChange: (cb) =>
        appServices.configService.onKeyChange("updateChannel", (v) =>
          cb(typeof v === "string" && v !== "" ? v : "latest"),
        ),
      getInstalledVersion: async () =>
        (window.openp41ge?.updater?.getCurrentVersion?.() ??
          Promise.resolve("")) as Promise<string>,
      download: async () =>
        (window.openp41ge?.updater?.download?.() ??
          Promise.resolve(IDLE_STATUS)) as Promise<UpdaterStatus>,
      getStatus: async () =>
        (window.openp41ge?.updater?.getStatus?.() ??
          Promise.resolve(IDLE_STATUS)) as Promise<UpdaterStatus>,
      onUpdaterStatus: (cb) => window.openp41ge?.updater?.onStatus?.(cb) ?? (() => {}),
      quitAndInstall: () => window.openp41ge?.updater?.quitAndInstall?.(),
      confirmRestart: () =>
        showConfirm({
          message: "Restart now to install the update? Your session will be preserved on relaunch.",
          confirmLabel: "Restart",
          cancelLabel: "Later",
        }),
      loadCache: () => {
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          return raw ? (JSON.parse(raw) as ReleaseCache) : null;
        } catch (err) {
          log.debug("releases-pane cache load failed:", err);
          return null;
        }
      },
      saveCache: (data) => {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (err) {
          log.debug("releases-pane cache save failed (quota?):", err);
          // ignore quota/storage errors — cache is best-effort
        }
      },
    };
  }

  override render(): TemplateResult {
    const statusError =
      this._status.state === "error"
        ? html`<span class="rp-error">Update: ${this._status.message}</span>`
        : nothing;
    const staleNote = this._stale
      ? html`<span class="rp-stale">showing cached — refreshing…</span>`
      : nothing;
    const installed = this._installedVersion
      ? html`<span class="rp-installed"
          ><b class="rp-installed-version">v${this._installedVersion}</b></span
        >`
      : "";
    return html`
      <div class="rp">
        <div class="rp-scroll">
          ${
            this._loading && this._releases.length === 0
              ? html`<p class="rp-state">Loading releases…</p>`
              : this._error
                ? html`<p class="rp-state rp-state--error">${this._error}</p>`
                : this._visible.length === 0
                  ? html`<p class="rp-state">No releases yet.</p>`
                  : html`<ul class="rp-list">
                      ${this._visible.map((r) => this._renderRelease(r))}
                    </ul>`
          }
        </div>
        <footer class="rp-footer">
          <span class="rp-footer-status">${statusError}${installed}${staleNote}</span>
          <span class="rp-footer-spacer"></span>
          <button
            class="rp-refresh"
            aria-label="Refresh releases"
            title="Refresh releases"
            @click=${() => void this._load()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"
              />
            </svg>
          </button>
        </footer>
      </div>
      ${this._renderDrawer()}
    `;
  }

  private _renderRelease(r: GithubRelease): TemplateResult {
    const channel = channelFromTag(r.tag_name);
    const badge = CHANNEL_LABELS[channel] ?? channel;
    const norm = normVersion(r.tag_name);
    const isInstalled = norm === this._installedVersion;
    const isInstallable = channel === this._installChannel;
    const downloading = this._status.state === "downloading" ? this._status : null;
    const isDownloading = downloading !== null && normVersion(downloading.version) === norm;
    const isDownloaded =
      this._status.state === "update-downloaded" && normVersion(this._status.version) === norm;
    const showDownload = isInstallable && !isInstalled && !isDownloading && !isDownloaded;
    return html`
      <li class="rp-item ${this._drawerChannel === channel ? "rp-item--active" : ""}">
        <div class="rp-card">
          <div class="rp-card-body">
            <div class="rp-item-head">
              ${
                r.html_url
                  ? html`<a
                      class="rp-tag"
                      href=${r.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      >${r.tag_name}</a
                    >`
                  : html`<span class="rp-tag">${r.tag_name}</span>`
              }
              <span class="rp-badge rp-badge--${channel}">${badge}</span>
              ${isInstalled ? html`<span class="rp-chip rp-chip--installed">Installed</span>` : ""}
              ${
                r.published_at
                  ? html`<span class="rp-date">${formatReleaseDate(r.published_at)}</span>`
                  : ""
              }
            </div>
            ${r.body ? html`<div class="rp-body">${r.body}</div>` : ""}
          </div>
        </div>
        <div class="rp-card-foot">
          ${
            isDownloading
              ? html`<div class="rp-foot-left">
                  <span class="rp-progress"
                    ><span class="rp-progress-bar" style="width:${downloading!.progress}%"></span
                  ></span>
                  <span class="rp-progress-label">${Math.round(downloading!.progress)}%</span>
                </div>`
              : isDownloaded
                ? html`<div class="rp-foot-left">
                    <span class="rp-downloaded-note">Downloaded — ready to update</span>
                  </div>`
                : ""
          }
          <div class="rp-foot-actions">
            ${
              isDownloaded
                ? html`<button
                    class="rp-foot-btn rp-foot-btn--update rp-btn--restart"
                    @click=${() => void this._onRestart()}
                  >
                    Update
                  </button>`
                : ""
            }
            ${
              showDownload
                ? html`<button
                    class="rp-foot-btn rp-foot-btn--download rp-btn--install"
                    data-version=${norm}
                    @click=${() => this._onInstall()}
                  >
                    Download
                  </button>`
                : ""
            }
            <button
              class="rp-foot-btn rp-btn--history"
              data-channel=${channel}
              @click=${() => this._openDrawer(channel)}
            >
              History
            </button>
          </div>
        </div>
      </li>
    `;
  }

  private _renderDrawer(): TemplateResult {
    const channel = this._drawerChannel;
    if (!channel) return html``;
    const label = CHANNEL_LABELS[channel] ?? channel;
    return html`
      <div class="rp-drawer-backdrop" @click=${() => this._closeDrawer()}></div>
      <aside class="rp-drawer">
        <header class="rp-drawer-head">
          <span class="rp-drawer-title">${label} history</span>
          <button class="rp-btn rp-btn--history" @click=${() => this._closeDrawer()}>✕</button>
        </header>
        <ul class="rp-drawer-list">
          ${
            this._drawerReleases.length === 0
              ? html`<p class="rp-state">No ${label} releases yet.</p>`
              : this._drawerReleases.map(
                  (r) => html`
                    <li class="rp-drawer-item">
                      <div class="rp-drawer-item-head">
                        <span class="rp-tag">${r.tag_name}</span>
                        <span class="rp-date">${formatReleaseDate(r.published_at)}</span>
                      </div>
                      ${r.body ? html`<div class="rp-body">${r.body}</div>` : ""}
                      ${
                        r.html_url
                          ? html`<a
                              class="rp-drawer-link"
                              href=${r.html_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              >View on GitHub</a
                            >`
                          : ""
                      }
                    </li>
                  `,
                )
          }
        </ul>
        ${
          this._drawerDone
            ? html`<div class="rp-drawer-footer">All versions loaded</div>`
            : html`<div class="rp-drawer-footer">
                <button
                  class="rp-btn rp-btn--history"
                  @click=${() => void this._loadMoreHistory()}
                  ?disabled=${this._drawerLoading}
                >
                  ${this._drawerLoading ? "Loading…" : "Load older versions"}
                </button>
              </div>`
        }
      </aside>
    `;
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
      padding: 14px;
      font-size: 13px;
      color: var(--muted-color, #8b93a1);
    }
    .rp-state--error {
      color: #e57373;
    }
    /* ── Full-width release cards ─────────────────────────────────────── */
    .rp-list {
      list-style: none;
      margin: 0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .rp-item {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      gap: 0;
    }
    /* The bordered card holds only the release content; the action buttons
       sit BELOW it as their own row. */
    .rp-card {
      position: relative;
      display: flex;
      flex-direction: column;
      min-width: 0;
      border: 1px solid var(--divider, #2d2d2d);
      background: var(--bg-secondary, #161616);
    }
    .rp-item--active .rp-card {
      border-color: var(--accent, #4f9cf9);
    }
    .rp-card-body {
      display: flex;
      flex-direction: column;
      padding: 12px;
    }
    .rp-item-head {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .rp-tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #d4d4d4);
      text-decoration: none;
    }
    a.rp-tag:hover {
      text-decoration: underline;
      color: var(--accent, #4f9cf9);
    }
    .rp-badge {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 1px 7px;
      border-radius: 999px;
    }
    .rp-badge--stable,
    .rp-badge--latest {
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
    .rp-date {
      margin-left: auto;
      font-size: 11px;
      color: var(--muted-color, #8b93a1);
    }
    .rp-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(111, 200, 114, 0.16);
      color: #6fc872;
    }
    .rp-body {
      margin-top: 8px;
      font-size: 12px;
      line-height: 1.5;
      color: color-mix(in srgb, var(--text-primary, #d4d4d4) 82%, #000);
      white-space: pre-wrap;
      word-break: break-word;
    }
    /* ── Card footer: boxed action buttons flush to the bottom edge ───── */
    .rp-card-foot {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0;
      flex-shrink: 0;
      min-height: 26px;
    }
    .rp-foot-left {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      gap: 8px;
    }
    .rp-progress {
      width: 80px;
      height: 6px;
      background: var(--bg-tertiary, #333);
      overflow: hidden;
    }
    .rp-progress-bar {
      display: block;
      height: 100%;
      background: var(--accent, #4f9cf9);
      transition: width 0.15s linear;
    }
    .rp-progress-label {
      font-size: 11px;
      color: var(--muted-color, #8b93a1);
    }
    .rp-foot-actions {
      display: flex;
      align-items: stretch;
      gap: 0;
    }
    /* Each action button is its own boxed element, flush against the card's
       bottom border (their top border is dropped so the card's bottom border
       doubles as the group's top line) and touching their neighbours
       (adjacent buttons collapse their shared edge to a single 1px line). */
    .rp-foot-btn {
      border: 1px solid var(--divider, #333);
      border-top: none;
      background: transparent;
      color: var(--text-secondary, #999);
      font: inherit;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 12px;
      min-height: 26px;
      cursor: pointer;
      user-select: none;
    }
    .rp-foot-actions .rp-foot-btn + .rp-foot-btn {
      border-left: none;
    }
    .rp-foot-btn:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .rp-foot-btn--download {
      color: #6fc872;
    }
    .rp-foot-btn--update {
      color: #6aa9ff;
    }
    .rp-downloaded-note {
      font-size: 11px;
      color: #6aa9ff;
      white-space: nowrap;
    }
    /* ── Bottom bar: status + refresh square button ───────────────────── */
    .rp-footer {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      height: 34px;
      padding-left: 10px;
      border-top: 1px solid var(--divider, #333);
      background: var(--bg-secondary, #161616);
    }
    .rp-footer-status {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      font-size: 11px;
      color: var(--text-secondary, #888);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rp-installed {
      white-space: nowrap;
    }
    .rp-installed-version {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      color: var(--text-primary, #d4d4d4);
    }
    .rp-stale {
      color: var(--muted-color, #8b93a1);
    }
    .rp-error {
      color: #e57373;
    }
    .rp-footer-spacer {
      flex: 1;
    }
    .rp-refresh {
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
    .rp-refresh:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .rp-refresh svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    /* ── History drawer ───────────────────────────────────────────────── */
    .rp-drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 50;
    }
    .rp-drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(440px, 80vw);
      background: var(--bg-primary, #1a1a1a);
      border-left: 1px solid var(--divider, #2d2d2d);
      box-shadow: -12px 0 30px rgba(0, 0, 0, 0.35);
      z-index: 51;
      display: flex;
      flex-direction: column;
      padding: 14px 16px;
      box-sizing: border-box;
    }
    .rp-drawer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .rp-drawer-title {
      font-size: 14px;
      font-weight: 600;
    }
    .rp-drawer-list {
      list-style: none;
      margin: 0;
      padding: 0;
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .rp-drawer-item {
      border: 1px solid var(--divider, #2d2d2d);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--bg-secondary, #1e1e1e);
    }
    .rp-drawer-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .rp-drawer-link {
      display: inline-block;
      margin-top: 6px;
      font-size: 12px;
      color: var(--accent, #4f9cf9);
      text-decoration: none;
    }
    .rp-drawer-link:hover {
      text-decoration: underline;
    }
    .rp-drawer-footer {
      padding-top: 10px;
      border-top: 1px solid var(--divider, #2d2d2d);
      text-align: center;
    }
    .rp-btn {
      font: inherit;
      font-size: 12px;
      color: var(--text-primary, #d4d4d4);
      background: var(--bg-secondary, #252526);
      border: 1px solid var(--divider, #454545);
      border-radius: 6px;
      padding: 3px 10px;
      cursor: pointer;
    }
    .rp-btn:hover {
      border-color: var(--accent, #4f9cf9);
    }
    .rp-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;
}
