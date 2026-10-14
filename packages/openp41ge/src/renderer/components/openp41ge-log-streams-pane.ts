/**
 * <openp41ge-log-streams-pane> — the Log Streams sidebar tab: every registered
 * log stream with its entry count. A click opens the stream (`onOpen`); with
 * `dragSourceId` set, rows are platform drag sources (`openp41ge/log-stream`
 * from `data-system`).
 */

import { html, nothing, type TemplateResult } from "lit";
import { listLogStreams } from "openp41ge-core-logger";
import { LiveLogPane } from "./log-sidebar-pane-base";

export class Openp41geLogStreamsPane extends LiveLogPane {
  /** Open a stream (a row click). */
  onOpen: ((system: string) => void) | null = null;
  /** When set, rows are platform drag sources with this id. */
  dragSourceId: string | null = null;

  override render(): TemplateResult {
    const streams = listLogStreams();
    return html`
      <div class="lsp-list">
        ${
          streams.length === 0
            ? html`<div class="lsp-empty">No streams registered.</div>`
            : streams.map(
                (s) => html`
                  <div
                    class="lsp-row"
                    data-system=${s.system}
                    data-drag-source-id=${this.dragSourceId ?? nothing}
                    title="Click to preview · drag to the grid to open"
                    @click=${() => this.onOpen?.(s.system)}
                  >
                    <span class="lsp-sys">${s.system}</span>
                    <span class="lsp-count">${s.entryCount}</span>
                  </div>
                `,
              )
        }
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-log-streams-pane")) {
  customElements.define("openp41ge-log-streams-pane", Openp41geLogStreamsPane);
}
