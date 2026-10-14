/**
 * <openp41ge-log-search-pane> — the Log Search sidebar tab: a search across
 * the buffered logs of every stream. A hit opens its stream (`onOpen`).
 */

import { html, type TemplateResult } from "lit";
import { queryLog, type LogEntry } from "openp41ge-core-logger";
import { LiveLogPane } from "./log-sidebar-pane-base";

export class Openp41geLogSearchPane extends LiveLogPane {
  static override properties = { _query: { state: true } };

  /** Open a hit's stream, its find bar on the query. */
  onOpen: ((system: string, query: string) => void) | null = null;

  declare private _query: string;

  constructor() {
    super();
    this._query = "";
  }

  private _hit(e: LogEntry, query: string): TemplateResult {
    return html`
      <div
        class="lsp-row lsp-hit"
        data-system=${e.system}
        title="Open ${e.system} focused on this match"
        @click=${() => this.onOpen?.(e.system, query)}
      >
        <span class="lsp-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
        <span class="lsp-hit-sys">${e.system}</span>
        <span class="lsp-msg">${String(e.text ?? e.message)}</span>
      </div>
    `;
  }

  override render(): TemplateResult {
    const query = this._query.trim();
    const hits = query ? queryLog({ search: query, limit: 200 }) : [];
    return html`
      <div class="lsp-search-box">
        <input
          type="text"
          class="lsp-search-input"
          placeholder="Search all streams…"
          .value=${this._query}
          @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="lsp-list">
        ${
          !query
            ? html`<div class="lsp-empty">Type to search all streams.</div>`
            : hits.length === 0
              ? html`<div class="lsp-empty">No matches.</div>`
              : hits.map((e) => this._hit(e, query))
        }
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-log-search-pane")) {
  customElements.define("openp41ge-log-search-pane", Openp41geLogSearchPane);
}
