/**
 * chats-sidebar.ts — the Agents sidebar (`sidebar:chats`): the workspace's
 * chats.
 *
 *   - "New chat" (top row) creates a chat and opens it pinned.
 *   - A row opens its chat as a preview; a double click pins it. A chat open
 *     in another window says so and does not open here.
 *   - Rows drag as `chat-thread` payloads (drop one on the grid to open it).
 *   - The bottom bar's settings button (at the edge facing the grid) opens
 *     the extension's config.
 * `<agents-chats>` keeps a `ChatsModel` while connected.
 */

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { defaultChatTitle as formatTime } from "../chat/title.js";
import type { ChatSummary } from "../chat/types.js";
import { ChatsModel, type ChatsHost } from "./chats-model.js";
import { PLUS_ICON, SETTINGS_ICON } from "./icons.js";
import { innerSide } from "./inner-side.js";

/** `data-drag-source-id` of chat rows. */
export const CHAT_DRAG_SOURCE_ID = "chat";

/** The surface host, as far as the sidebar uses it. */
export interface ChatsSidebarHost extends ChatsHost {
  readonly config: { openEditor(): void };
}

const STYLES = html`<style>
  .ac {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-size: 13px;
  }
  .ac-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .ac-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 7px 8px;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--divider, #2a2a2a);
  }
  .ac-row:hover {
    background: var(--bg-hover, #2a2d2e);
  }
  .ac-row.here {
    background: var(--bg-hover, #282828);
  }
  .ac-row.elsewhere {
    cursor: default;
  }
  .ac-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .ac-title,
  .ac-desc,
  .ac-date {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ac-title {
    color: var(--text-primary, #ccc);
  }
  .ac-new .ac-title {
    color: var(--text-muted, #777);
  }
  .ac-desc {
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.3;
    color: var(--text-muted, #777);
  }
  .ac-date {
    margin-top: 2px;
    font-size: 10px;
    line-height: 1.3;
    color: var(--text-muted, #777);
  }
  .ac-plus {
    flex-shrink: 0;
    align-self: center;
    display: inline-flex;
    color: var(--text-muted, #777);
  }
  .ac-note {
    padding: 8px 10px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-muted, #777);
  }
  .ac-note.error {
    color: var(--error, #e53e3e);
  }
  .ac-footer {
    flex-shrink: 0;
    height: 34px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    border-top: 1px solid var(--divider, #333);
    background: var(--bg-secondary, #161616);
  }
  .ac-footer.right {
    flex-direction: row-reverse;
  }
  .ac-button {
    width: 34px;
    height: 33px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
  }
  .ac-footer.left .ac-button {
    border-right: 1px solid var(--divider, #333);
  }
  .ac-footer.right .ac-button {
    border-left: 1px solid var(--divider, #333);
  }
  .ac-button:hover {
    background: var(--bg-hover, #2a2d2e);
    color: var(--text-primary, #ddd);
  }
</style>`;

export class AgentsChats extends LitElement {
  static override properties = {
    host: { attribute: false },
    _side: { state: true },
  };

  declare host: ChatsSidebarHost | null;
  declare _side: "left" | "right";

  private _model: ChatsModel | null = null;

  constructor() {
    super();
    this.host = null;
    this._side = "left";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this._place);
    this._start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._place);
    this._model?.stop();
    this._model = null;
  }

  protected override willUpdate(): void {
    this._start();
  }

  protected override firstUpdated(): void {
    this._place();
  }

  private _start(): void {
    if (this._model || !this.host || !this.isConnected) return;
    this._model = new ChatsModel(this.host, () => this.requestUpdate());
    this._model.start();
  }

  private _place = (): void => {
    this._side = innerSide(this.getBoundingClientRect(), window.innerWidth);
  };

  protected override render(): TemplateResult {
    const m = this._model;
    return html`${STYLES}
      <div class="ac">
        <div class="ac-row ac-new" title="New chat" @click=${() => void m?.newChat()}>
          <div class="ac-text">
            <div class="ac-title">New chat</div>
            <div class="ac-desc">No description</div>
          </div>
          <span class="ac-plus" aria-hidden="true">${unsafeHTML(PLUS_ICON)}</span>
        </div>
        <div class="ac-list">${m ? this._list(m) : nothing}</div>
        <div class="ac-footer ${this._side}">
          <button
            type="button"
            class="ac-button"
            title="Agent settings"
            aria-label="Agent settings"
            @click=${() => this.host?.config.openEditor()}
          >
            ${unsafeHTML(SETTINGS_ICON)}
          </button>
        </div>
      </div>`;
  }

  private _list(m: ChatsModel): TemplateResult | TemplateResult[] {
    const { chats, open, error } = m.state;
    if (error) return html`<div class="ac-note error">${error}</div>`;
    if (!chats) return html`<div class="ac-note">Loading chats…</div>`;
    if (chats.length === 0) return html`<div class="ac-note">No chats yet</div>`;
    return chats.map((chat) => this._row(m, chat, open[chat.id]));
  }

  private _row(
    m: ChatsModel,
    chat: ChatSummary,
    where: "here" | "elsewhere" | undefined,
  ): TemplateResult {
    const description = (chat.description ?? "").trim() || "No description";
    return html`<div
      class="ac-row ${where ?? ""}"
      data-chat-id=${chat.id}
      data-chat-title=${chat.title}
      data-drag-source-id=${CHAT_DRAG_SOURCE_ID}
      title=${where === "elsewhere" ? `“${chat.title}” is open in another window` : chat.title}
      @click=${() => m.openChat(chat.id)}
      @dblclick=${() => m.openChat(chat.id, true)}
    >
      <div class="ac-text">
        <div class="ac-title">${chat.title}</div>
        <div class="ac-desc">${description}</div>
        <div class="ac-date">
          ${where === "elsewhere" ? "Open in another window · " : ""}${formatTime(chat.updatedAt)}
        </div>
      </div>
    </div>`;
  }
}

if (!customElements.get("agents-chats")) customElements.define("agents-chats", AgentsChats);

/** The Agents sidebar render function. */
export function renderChats(host: ChatsSidebarHost): TemplateResult {
  return html`<agents-chats
    style="display:block;width:100%;height:100%"
    .host=${host}
  ></agents-chats>`;
}
