/**
 * <openp41ge-empty-state> — landing page shown in the grid when no tabs are open.
 *
 * Displays:
 *   - "Open Project" button → dispatches `empty-state:open-project`
 *   - Recent projects list (data passed via `.recents` property)
 *   - "Clone Repository" button → dispatches `empty-state:clone-repo`
 *
 * Events (bubbling, composed):
 *   - `empty-state:open-project` — user wants to open the project picker
 *   - `empty-state:clone-repo` — user wants to clone a repository
 *
 * This component is in the uikit package and communicates with the host
 * app exclusively through CustomEvents. No IPC access.
 */

import { LitElement, html, css } from "lit";
import { property } from "lit/decorators.js";

export interface RecentProject {
  name: string;
  openedAt: string;
}

export class Openp41geEmptyState extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: flex-start;
      height: 100%;
      background: var(--bg-primary, #161616);
      padding: 40px 32px;
      box-sizing: border-box;
      overflow: hidden;
      user-select: none;
      font-family: var(--font-ui);
      color: var(--text-primary, #e0e0e0);
    }

    .container {
      max-width: 400px;
      width: 100%;
    }

    .title {
      font-size: 15px;
      font-weight: 500;
      color: var(--text-primary, #e0e0e0);
      margin: 0 0 6px 0;
    }

    .subtitle {
      font-size: 12px;
      color: var(--text-secondary, #999);
      margin: 0 0 24px 0;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border: 1px solid var(--border-color, #444);
      border-radius: 6px;
      background: var(--bg-secondary, #161616);
      color: var(--text-primary, #e0e0e0);
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition:
        background 0.15s,
        border-color 0.15s;
      margin: 4px;
    }

    .action-btn:hover {
      background: var(--bg-hover, #333);
      border-color: var(--accent, #4a9eff);
    }

    .action-btn:focus-visible {
      outline: 2px solid var(--accent, #4a9eff);
      outline-offset: 2px;
    }

    .action-btn svg {
      flex-shrink: 0;
    }

    .divider {
      height: 1px;
      background: var(--border-divider, #333);
      margin: 24px 0;
    }

    .recents-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary, #666);
      margin: 0 0 12px 0;
      text-align: left;
    }

    .recents-list {
      list-style: none;
      margin: 0;
      padding: 0;
      text-align: left;
    }

    .recent-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-primary, #e0e0e0);
      transition: background 0.1s;
    }

    .recent-item:hover {
      background: var(--bg-hover, #333);
    }

    .recent-item .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .recent-item .date {
      flex-shrink: 0;
      font-size: 11px;
      color: var(--text-secondary, #666);
    }

    .recent-item .remove-btn {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--text-secondary, #555);
      font-size: 14px;
      cursor: pointer;
      opacity: 0;
      transition:
        opacity 0.1s,
        color 0.1s,
        background 0.1s;
      line-height: 1;
      padding: 0;
    }

    .recent-item:hover .remove-btn {
      opacity: 1;
    }

    .recent-item .remove-btn:hover {
      color: #e06c75;
      background: rgba(224, 108, 117, 0.15);
    }

    .no-recents {
      font-size: 12px;
      color: var(--text-secondary, #666);
      text-align: left;
    }
  `;

  @property({ type: Array }) recents: RecentProject[] = [];

  private _openProject(): void {
    this.dispatchEvent(
      new CustomEvent("empty-state:open-project", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _cloneRepo(): void {
    this.dispatchEvent(
      new CustomEvent("empty-state:clone-repo", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openRecent(name: string): void {
    this.dispatchEvent(
      new CustomEvent("empty-state:open-recent", {
        bubbles: true,
        composed: true,
        detail: { name },
      }),
    );
  }

  private _removeRecent(name: string, e: Event): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("empty-state:remove-recent", {
        bubbles: true,
        composed: true,
        detail: { name },
      }),
    );
  }

  private _formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      const days = Math.floor(diff / 86400000);
      if (days === 0) return "Today";
      if (days === 1) return "Yesterday";
      if (days < 7) return `${days} days ago`;
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  render() {
    const showRecents = this.recents.length > 0;

    return html`
      <div class="container">
        <p class="title">No open tabs</p>
        <p class="subtitle">Open a project or start editing</p>

        <button class="action-btn" @click=${this._openProject}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"
            />
          </svg>
          Open Project
        </button>

        <button class="action-btn" @click=${this._cloneRepo}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M4 1c.55 0 1 .45 1 1v1h7.5c.827 0 1.5.673 1.5 1.5v8c0 .827-.673 1.5-1.5 1.5h-11c-.827 0-1.5-.673-1.5-1.5V3c0-.55.45-1 1-1h3zm0 1.5H2v10h11v-8H5v1.25c0 .345.28.625.625.625h3.75c.345 0 .625-.28.625-.625V2.5H4zm.5 1v.625c0 .069.056.125.125.125h3.75a.125.125 0 0 0 .125-.125V2.5h-4v1zM2 12.5v1h11v-1H2z"
            />
          </svg>
          Clone Repository
        </button>

        <div class="divider"></div>
        <p class="recents-title">Recent projects</p>
        ${
          showRecents
            ? html`
                <ul class="recents-list">
                  ${this.recents.map(
                    (r) => html`
                      <li class="recent-item" @click=${() => this._openRecent(r.name)}>
                        <span class="name">${r.name}</span>
                        <span class="date">${this._formatDate(r.openedAt)}</span>
                        <button
                          class="remove-btn"
                          title="Remove from recent projects"
                          @click=${(e: MouseEvent) => this._removeRecent(r.name, e)}
                        >
                          ×
                        </button>
                      </li>
                    `,
                  )}
                </ul>
              `
            : html`<p class="no-recents">No recent projects</p>`
        }
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-empty-state")) {
  customElements.define("openp41ge-empty-state", Openp41geEmptyState);
}
