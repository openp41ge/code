/**
 * chat-search-sidebar.ts — the Search chats sidebar (`sidebar:search`):
 * search the workspace's chats, laid out as the History sidebar.
 *
 *   - Search row (as tall as the app's bottom bars): the query, searched as
 *     you type, with regex and match-case toggles.
 *   - Results bar: what was searched, or how many chats match.
 *   - Results: each matching chat (title, how many messages / tool calls
 *     match, when it was last used); a click opens it as a preview, and it
 *     drags as a `chat-thread` payload.
 * `<agents-chat-search>` keeps a `ChatSearchModel` while connected.
 */

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { defaultChatTitle as formatTime } from "../chat/title.js";
import {
  ChatSearchModel,
  searchSummary,
  type ChatSearchHit,
  type ChatSearchHost,
} from "./chat-search-model.js";
import { CHAT_DRAG_SOURCE_ID } from "./chats-sidebar.js";
import { CASE_ICON, REGEX_ICON } from "./icons.js";

const STYLES = html`<style>
  .acs {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-size: 13px;
  }
  .acs-row {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 35px;
    box-sizing: border-box;
    padding: 0 10px;
    border-bottom: 1px solid var(--divider, #2a2a2a);
  }
  .acs .acs-input:focus-visible {
    outline: none;
  }
  .acs-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 26px;
    padding: 0;
    font-size: 12px;
    color: var(--text-primary, #ccc);
    background: transparent;
    border: none;
    outline: none;
  }
  .acs-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary, #888);
  }
  .acs-toggle:hover {
    color: var(--text-primary, #ddd);
  }
  .acs-toggle.on {
    color: #e3e3e3;
  }
  .acs-status {
    flex-shrink: 0;
    height: 20px;
    box-sizing: border-box;
    line-height: 19px;
    padding: 0 10px;
    border-bottom: 1px solid var(--divider, #2a2a2a);
    font-size: 11px;
    color: var(--text-muted, #6b6b6b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acs-status.error {
    color: var(--error, #e53e3e);
  }
  .acs-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .acs-result {
    padding: 7px 10px;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--divider, #2a2a2a);
  }
  .acs-result:hover {
    background: var(--bg-hover, #2a2d2e);
  }
  .acs-title,
  .acs-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acs-title {
    color: var(--text-primary, #ccc);
  }
  .acs-meta {
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.3;
    color: var(--text-muted, #777);
  }
</style>`;

/** "2 messages · 1 tool call" — what matched in a chat. */
function matchCounts(hit: ChatSearchHit): string {
  const parts: string[] = [];
  if (hit.messages) parts.push(`${hit.messages} message${hit.messages === 1 ? "" : "s"}`);
  if (hit.toolCalls) parts.push(`${hit.toolCalls} tool call${hit.toolCalls === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export class AgentsChatSearch extends LitElement {
  static override properties = { host: { attribute: false } };

  declare host: ChatSearchHost | null;

  private _model: ChatSearchModel | null = null;

  constructor() {
    super();
    this.host = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._model?.stop();
    this._model = null;
  }

  protected override willUpdate(): void {
    this._start();
  }

  protected override firstUpdated(): void {
    requestAnimationFrame(() => this.querySelector<HTMLInputElement>(".acs-input")?.focus());
  }

  private _start(): void {
    if (this._model || !this.host || !this.isConnected) return;
    this._model = new ChatSearchModel(this.host, () => this.requestUpdate());
    void this._model.start();
  }

  protected override render(): TemplateResult {
    const m = this._model;
    if (!m) return html``;
    const s = m.state;
    const summary = searchSummary(s);
    return html`${STYLES}
      <div class="acs">
        <div class="acs-row">
          <input
            class="acs-input"
            type="text"
            placeholder="Search chats…"
            spellcheck="false"
            .value=${live(s.query)}
            @input=${(e: Event) => void m.setQuery((e.target as HTMLInputElement).value)}
          />
          ${this._toggle(m, "regex", REGEX_ICON, "Regex search")}
          ${this._toggle(m, "caseSensitive", CASE_ICON, "Match case")}
        </div>
        <div class="acs-status ${s.error ? "error" : ""}" role="status" title=${summary}>
          ${summary}
        </div>
        <div class="acs-results">
          ${s.results ? s.results.map((r) => this._result(m, r)) : nothing}
        </div>
      </div>`;
  }

  private _toggle(
    m: ChatSearchModel,
    option: "regex" | "caseSensitive",
    icon: string,
    label: string,
  ): TemplateResult {
    const on = m.state[option];
    return html`<button
      type="button"
      class="acs-toggle ${on ? "on" : ""}"
      title=${label}
      aria-label=${label}
      aria-pressed=${on ? "true" : "false"}
      @click=${() => void m.toggle(option)}
    >
      ${unsafeHTML(icon)}
    </button>`;
  }

  private _result(m: ChatSearchModel, hit: ChatSearchHit): TemplateResult {
    const counts = matchCounts(hit);
    return html`<div
      class="acs-result"
      data-chat-id=${hit.chat.id}
      data-chat-title=${hit.chat.title}
      data-drag-source-id=${CHAT_DRAG_SOURCE_ID}
      title=${hit.chat.title}
      @click=${() => m.openChat(hit.chat.id)}
    >
      <div class="acs-title">${hit.chat.title}</div>
      <div class="acs-meta">${counts ? `${counts} · ` : ""}${formatTime(hit.chat.updatedAt)}</div>
    </div>`;
  }
}

if (!customElements.get("agents-chat-search")) {
  customElements.define("agents-chat-search", AgentsChatSearch);
}

/** The Search chats render function. */
export function renderChatSearch(host: ChatSearchHost): TemplateResult {
  return html`<agents-chat-search
    style="display:block;width:100%;height:100%"
    .host=${host}
  ></agents-chat-search>`;
}
