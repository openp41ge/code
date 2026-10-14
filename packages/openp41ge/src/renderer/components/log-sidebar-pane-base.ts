/**
 * The base of the Log Streams and Log Search sidebar panes
 * (<openp41ge-log-streams-pane>, <openp41ge-log-search-pane>): they render
 * into their light DOM, with their styles added once to the document or
 * shadow root they are in, and re-render as streams register and entries
 * arrive.
 */

import { LitElement } from "lit";
import { subscribeLogStreams, subscribeLogs } from "openp41ge-core-logger";

const STYLE_ATTR = "data-openp41ge-log-sidebar-panes";

const STYLES = `
.lsp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 0; }
.lsp-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; font-family: var(--font-ui, sans-serif); font-size: 12px; color: var(--text-primary, #ccc); }
.lsp-row:hover { background: var(--bg-hover, #262626); }
.lsp-sys { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsp-count { flex-shrink: 0; color: var(--text-muted, #888); font-size: 11px; background: var(--bg-primary, #161616); border-radius: 8px; padding: 1px 7px; }
.lsp-empty { padding: 12px; color: var(--text-muted, #888); font-size: 12px; font-style: italic; font-family: var(--font-ui, sans-serif); }
.lsp-search-box { flex-shrink: 0; padding: 8px 10px; border-bottom: 1px solid var(--border-divider, #2d2d2d); }
.lsp-search-input { width: 100%; padding: 6px 10px; border: 1px solid var(--border-divider, #333); border-radius: 5px; background: var(--bg-primary, #1e1e1e); color: var(--text-primary, #d4d4d4); font-size: 12px; font-family: var(--font-ui, sans-serif); outline: none; box-sizing: border-box; }
.lsp-search-input:focus { border-color: var(--accent, #4fc1ff); }
.lsp-hit { align-items: flex-start; }
.lsp-time { flex-shrink: 0; color: var(--text-muted, #888); font-size: 11px; font-variant-numeric: tabular-nums; }
.lsp-hit-sys { flex-shrink: 0; color: var(--accent, #4fc1ff); font-size: 11px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsp-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary, #aaa); }
`;

/** Add the panes' styles to the document or shadow root `el` is in, once. */
function installStyles(el: Element): void {
  const root = el.getRootNode() as Document | ShadowRoot;
  const parent = root instanceof Document ? root.head : root;
  if (!parent || parent.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent = STYLES;
  parent.appendChild(style);
}

/** A pane that re-renders as streams register and entries arrive. */
export abstract class LiveLogPane extends LitElement {
  private _offs: Array<() => void> = [];

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    installStyles(this);
    this._offs.push(
      subscribeLogStreams(() => this.requestUpdate()),
      subscribeLogs(() => this.requestUpdate()),
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._offs.forEach((off) => off());
    this._offs = [];
  }
}
