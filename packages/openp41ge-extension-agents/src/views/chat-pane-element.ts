/**
 * chat-pane-element.ts — `<agents-chat-pane>`, the chat tab's element: an
 * `<agents-chat>` run by a `ChatPane` (chat-pane.ts) while connected, and
 * the tab's render function.
 */

import { html, type TemplateResult } from "lit";
import { registerAgentsChat, type AgentsChat } from "../chat/ui/agents-chat.js";
import { ChatPane, str, type ChatPaneHost } from "./chat-pane.js";

/** `<agents-chat-pane>`: an `<agents-chat>` run by a `ChatPane` while connected. */
export class AgentsChatPane extends HTMLElement {
  private _host: ChatPaneHost | null = null;
  private _pane: ChatPane | null = null;

  /** The surface host (set by the render function; starts the pane once
   *  the element is also connected). */
  get host(): ChatPaneHost | null {
    return this._host;
  }

  set host(host: ChatPaneHost | null) {
    this._host = host;
    if (this.isConnected) this.connectedCallback();
  }

  connectedCallback(): void {
    if (!this._host || this._pane) return;
    registerAgentsChat();
    const el = document.createElement("agents-chat") as AgentsChat;
    el.style.cssText = "width:100%;height:100%";
    this.replaceChildren(el);
    const pane = new ChatPane(this._host, el);
    el.addEventListener("chat:send", (e) => {
      const detail = (e as CustomEvent<{ text?: string; thinkingLevel?: string }>).detail;
      pane.send(detail?.text ?? "", detail?.thinkingLevel);
    });
    el.addEventListener("chat:abort", () => pane.abort());
    el.addEventListener("chat:open-log", (e) => {
      const errorId = (e as CustomEvent<{ errorId?: string }>).detail?.errorId;
      if (errorId) pane.openLog(errorId);
    });
    el.addEventListener("chat:tools-change", (e) => {
      const tools = (e as CustomEvent<{ tools?: string[] }>).detail?.tools;
      if (tools) pane.toolsChanged(tools);
    });
    this._pane = pane;
    pane.start();
    requestAnimationFrame(() => el.focusInput());
  }

  disconnectedCallback(): void {
    this._pane?.stop();
    this._pane = null;
    this.replaceChildren();
  }
}

if (!customElements.get("agents-chat-pane")) {
  customElements.define("agents-chat-pane", AgentsChatPane);
}

/** The tab's params: its chat. */
export function chatParams(params: Readonly<Record<string, unknown>>): { chatId: string } | null {
  const chatId = str(params.chatId);
  return chatId ? { chatId } : null;
}

/** The chat render function. */
export function renderChat(host: ChatPaneHost): TemplateResult {
  if (!chatParams(host.context ?? {})) {
    return html`<div
      style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted,#777);font-size:12px"
    >
      No chat selected
    </div>`;
  }
  return html`<agents-chat-pane
    style="display:block;width:100%;height:100%"
    .host=${host}
  ></agents-chat-pane>`;
}
