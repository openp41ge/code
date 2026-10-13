/**
 * openp41ge-migrations-pane — the manager window's Migrations tab.
 *
 * The data updates (migrations/README.md) of this data folder: its data
 * version next to the app's, whether it is up to date (or the last update
 * couldn't be finished, and where to get the app again), and how many
 * updates ran and when the last did — never what they were (that stays in
 * the journal and the logs). Read only — updates run in the migration
 * window at startup. A status that can't be read is said in a toast; the
 * bottom bar holds buttons, never messages.
 *
 * Test seam: override the static `deps`. By default the
 * `window.openp41ge.dataMigrations` bridge is used.
 */
import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createLogger } from "openp41ge-core-logger";
import { toastService } from "./openp41ge-toast";

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

/** One line: up to date or not, and how many updates ran and when. */
function summary(s: Status): string {
  if (s.failed) {
    return "This version of openp41ge code needs to update your data, and the update couldn't be finished. Download the latest version from GitHub and install it again.";
  }
  if (s.updates === 0) return "Your data is up to date. No data updates have run on it.";
  const count = s.updates === 1 ? "1 data update" : `${s.updates} data updates`;
  return `Your data is up to date. ${count} ran on it${s.lastUpdateAt ? `, the last on ${when(s.lastUpdateAt)}` : ""}.`;
}

@customElement("openp41ge-migrations-pane")
export class Openp41geMigrationsPane extends LitElement {
  static deps: MigrationsPaneDeps | null = null;

  @state() private _status: Status | null = null;

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
    } catch (err) {
      log.warn("migrations status failed:", err);
      toastService.show("Couldn't read the data update status", "error", 5000);
    }
  }

  override render(): TemplateResult {
    const s = this._status;
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
                  <p class="mp-state ${s.failed ? "mp-state--failed" : ""}">${summary(s)}</p>`
              : nothing
          }
        </div>
        <footer class="mp-footer">
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
      line-height: 18px;
      color: var(--muted-color, #8b93a1);
    }
    .mp-state--failed {
      color: var(--accent-error, #f44747);
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
