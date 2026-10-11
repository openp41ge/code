/**
 * openp41ge-migrations-pane — the manager window's Migrations tab.
 *
 * What the data migrations (the data-migrations plan) did to this data
 * folder: its data version next to the app's, the last failure, and each
 * instruction set that ran, newest first, with when and what it did. Read
 * only — migrations run in the migration window at startup.
 *
 * Test seam: override the static `deps`. By default the
 * `window.openp41ge.dataMigrations` bridge is used.
 */
import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "migrations-pane");

type Status = Awaited<ReturnType<Window["openp41ge"]["dataMigrations"]["status"]>>;

/** Injectable seams used by the pane. Tests replace these via the static. */
export interface MigrationsPaneDeps {
  status(): Promise<Status>;
}

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

@customElement("openp41ge-migrations-pane")
export class Openp41geMigrationsPane extends LitElement {
  static deps: MigrationsPaneDeps | null = null;

  @state() private _status: Status | null = null;
  @state() private _error = "";

  private get _deps(): MigrationsPaneDeps {
    return (
      Openp41geMigrationsPane.deps ?? {
        status: () => window.openp41ge.dataMigrations.status(),
      }
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    try {
      this._status = await this._deps.status();
      this._error = "";
    } catch (err) {
      log.warn("migrations status failed:", err);
      this._error = String(err);
    }
  }

  override render(): TemplateResult {
    const s = this._status;
    const applied = s ? [...s.applied].reverse() : [];
    return html`
      <div class="mp">
        <div class="mp-scroll">
          ${
            s
              ? html`<div class="mp-versions">
                    <span
                      >${s.dataVersion ? `Data version ${s.dataVersion}` : "Data version not recorded"}</span
                    >
                    <span class="mp-sep">·</span>
                    <span>App ${s.appVersion}</span>
                  </div>
                  <ul class="mp-list">
                    ${
                      s.failed
                        ? html`<li class="mp-item mp-item--failed">
                            <div class="mp-title">Failed: ${s.failed.id}</div>
                            <div class="mp-meta">${when(s.failed.at)}</div>
                            <div class="mp-error">${s.failed.error}</div>
                          </li>`
                        : nothing
                    }
                    ${applied.map(
                      (a) =>
                        html`<li class="mp-item">
                          <div class="mp-title">${a.description ?? a.id}</div>
                          <div class="mp-meta">${a.id} · ${when(a.at)}</div>
                          ${
                            a.done.length > 0
                              ? html`<ul class="mp-done">
                                  ${a.done.map((line) => html`<li>${line}</li>`)}
                                </ul>`
                              : html`<div class="mp-meta">Nothing needed changing.</div>`
                          }
                        </li>`,
                    )}
                  </ul>
                  ${
                    applied.length === 0 && !s.failed
                      ? html`<p class="mp-state">
                          No data migrations have run on this data folder.
                        </p>`
                      : nothing
                  }`
              : nothing
          }
        </div>
        <footer class="mp-footer">
          <span class="mp-footer-status"
            >${this._error ? html`<span class="mp-error">${this._error}</span>` : nothing}</span
          >
          <span class="mp-footer-spacer"></span>
          <button
            class="mp-refresh"
            aria-label="Refresh"
            title="Refresh"
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
    `;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .mp {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .mp-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .mp-versions {
      padding: 12px 14px;
      font-size: 12px;
      color: var(--text-secondary, #999);
      border-bottom: 1px solid var(--divider, #2d2d2d);
    }
    .mp-sep {
      margin: 0 6px;
    }
    .mp-state {
      margin: 0;
      padding: 14px;
      font-size: 13px;
      color: var(--muted-color, #8b93a1);
    }
    .mp-list {
      list-style: none;
      margin: 0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .mp-item {
      padding: 10px 12px;
      border: 1px solid var(--divider, #2d2d2d);
      background: var(--bg-secondary, #161616);
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .mp-item--failed {
      border-color: rgba(244, 71, 71, 0.5);
    }
    .mp-title {
      font-size: 13px;
      color: var(--text-primary, #d4d4d4);
    }
    .mp-meta {
      font-size: 11px;
      color: var(--text-secondary, #888);
    }
    .mp-error {
      font-size: 12px;
      color: var(--accent-error, #f44747);
      overflow-wrap: anywhere;
    }
    .mp-done {
      margin: 2px 0 0;
      padding-left: 16px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-secondary, #aaa);
      overflow-wrap: anywhere;
    }
    .mp-footer {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      height: 34px;
      padding-left: 10px;
      border-top: 1px solid var(--divider, #333);
      background: var(--bg-secondary, #161616);
    }
    .mp-footer-status {
      min-width: 0;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mp-footer-spacer {
      flex: 1;
    }
    .mp-refresh {
      border: none;
      border-left: 1px solid var(--divider, #333);
      border-radius: 0;
      background: transparent;
      color: var(--text-secondary, #999);
      height: 100%;
      aspect-ratio: 1 / 1;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .mp-refresh:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .mp-refresh svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-migrations-pane": Openp41geMigrationsPane;
  }
}
