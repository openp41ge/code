/**
 * <openp41ge-log-detail-drawer> — one log entry's details (source, system,
 * process, level, time; the message and its stack in copyable code blocks),
 * as a drawer sliding in from the right over a dimming mask.
 *
 * It fills its positioned parent: the host places it (a log tab over
 * the grid cell whose row was clicked, a log grid tab over its own content).
 * Clicking the mask or the close button fires `drawer-close`.
 *
 * Renders into its light DOM, with its styles added once to the document or
 * shadow root it is in.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { createLogger, type LogViewEntry } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "log-detail-drawer");

/** What the drawer shows for one entry. */
export interface LogDetail {
  /** First line of the message (the headline shown in the log row). */
  readonly message: string;
  /** The lines after the first — typically an appended stack trace. */
  readonly stack: string;
  readonly source: string;
  readonly system: string;
  readonly process: string;
  readonly levelLabel: string;
  readonly timestamp: number;
}

/** A clicked row's entry as the drawer shows it. */
export function logDetailFromEntry(entry: LogViewEntry): LogDetail {
  const nl = entry.message.indexOf("\n");
  return {
    message: nl < 0 ? entry.message : entry.message.slice(0, nl),
    stack: nl < 0 ? "" : entry.message.slice(nl + 1),
    source: entry.source,
    system: entry.system,
    process: entry.process,
    levelLabel: entry.levelLabel,
    timestamp: entry.timestamp,
  };
}

/**
 * Decode the common HTML entities (named + numeric) that may appear in log
 * text, so e.g. `&quot;` renders as `"` rather than the literal entity. The
 * result is rendered through Lit's text interpolation (a text node, not
 * parsed HTML), so decoding remains XSS-safe — it only unescapes entities.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:quot|amp|lt|gt|apos|nbsp|#(\d+)|#x([0-9a-fA-F]+));/g,
    (m, dec: string | undefined, hex: string | undefined) => {
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      switch (m) {
        case "&quot;":
          return '"';
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&apos;":
          return "'";
        case "&nbsp;":
          return "\u00a0";
        default:
          return m;
      }
    },
  );
}

/** Copy button icon for the code blocks (user-provided Material icon). */
const COPY_ICON = html` <svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor"
  aria-hidden="true"
>
  <path
    d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"
  />
</svg>`;

/** Check mark shown briefly after a successful copy. */
const CHECK_ICON = html` <svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor"
  aria-hidden="true"
>
  <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
</svg>`;

/** Marks the injected style element (one per document / shadow root). */
const STYLE_ATTR = "data-openp41ge-log-detail-drawer";

const STYLES = `
openp41ge-log-detail-drawer {
  display: contents;
}
  .lw-detail-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Allow highlighting / selecting log content so it can be copied. */
    user-select: text;
  }
  .lw-sec-title {
    color: var(--text-muted, #888);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: var(--font-ui, sans-serif);
    margin-bottom: 6px;
  }
  /* The block and its dangling copy button share a column, so the button's
     top edge can sit flush against the block's bottom edge. */
  .lw-codeblock-wrap {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  /* Square copy button hanging off the block's bottom-right corner: a
     bordered frame in its own right whose top edge touches the block's
     bottom edge. The -1px top margin merges the button's top border with
     the block's bottom border into one continuous line (a tab attached
     to the block). */
  .lw-copy-btn {
    align-self: flex-end;
    position: relative;
    overflow: visible;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: 26px;
    height: 24px;
    margin: -1px 0 0;
    padding: 0;
    border: 1px solid var(--border-divider, #2d2d2d);
    border-radius: 0;
    background: var(--bg-surface, #161616);
    color: var(--text-secondary, #999);
    cursor: pointer;
  }
  .lw-copy-btn svg {
    width: 12px;
    height: 12px;
  }
  .lw-copy-btn:hover,
  .lw-copy-btn:focus-visible {
    color: var(--text-primary, #fff);
    background: var(--bg-hover-strong, #2a2a2a);
  }
  .lw-copy-btn.copied {
    color: #6ecb6e;
  }
  /* Square code block for the Message / Stack details: monospace content
     on a surface background with a straight-edge border. The <pre> inside
     scrolls; the bordered wrapper is NOT a scroll container. */
  .lw-codeblock {
    position: relative;
    box-sizing: border-box;
    margin: 0;
    border: 1px solid var(--border-divider, #2d2d2d);
    border-radius: 0;
    background: var(--bg-surface, #161616);
    color: var(--text-primary, #d4d4d4);
    font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace;
    font-size: 12px;
    line-height: 1.5;
    user-select: text;
    cursor: text;
  }
  .lw-codeblock pre {
    margin: 0;
    padding: 8px 10px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
    font: inherit;
    color: inherit;
    user-select: text;
  }
  .lw-detail-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
  }
  /* Detail drawer — one per grid cell. Each is wrapped in a cell-sized
     overlay, so the drawer slides in from ITS OWN cell's right edge (not
     the grid's) and is clipped to that cell, never spilling into
     neighboring columns. Spans 80% of the cell's width. It overlays the
     cell's tab bar, so it carries a top bar matching the tab bar's 35px
     height (title + close). */
  .lw-drawer-wrap {
    position: absolute;
    z-index: 100;
  }
  .lw-drawer-mask {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    animation: lw-drawer-fade 0.18s ease-out;
  }
  @keyframes lw-drawer-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .lw-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 80%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary, #1e1e1e);
    color: var(--text-primary, #d4d4d4);
    border-left: 1px solid var(--border-divider, #2d2d2d);
    box-shadow: -2px 0 12px rgba(0, 0, 0, 0.45);
    z-index: 101;
    animation: lw-drawer-in 0.18s ease-out;
  }
  @keyframes lw-drawer-in {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
  .lw-drawer-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    /* Matches the cell tab bar's height (35px tabs + 1px border). */
    height: 35px;
    box-sizing: border-box;
    padding: 0 0 0 12px;
    border-bottom: 1px solid var(--border-divider, #2d2d2d);
    background: var(--bg-surface, #161616);
    color: var(--text-primary, #d4d4d4);
    font-size: 12px;
  }
  .lw-drawer-head-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-ui, sans-serif);
    font-weight: 600;
  }
  /* Empty bottom bar mirroring the top bar's 35px height and surface
     background (with a divider on its body-facing edge). */
  .lw-drawer-foot {
    flex-shrink: 0;
    height: 35px;
    box-sizing: border-box;
    border-top: 1px solid var(--border-divider, #2d2d2d);
    background: var(--bg-surface, #161616);
  }
  /* Square close button filling the head's full height, flush against the
     drawer's right edge. A left border separates it from the title. */
  .lw-drawer-close {
    position: relative;
    overflow: visible;
    flex-shrink: 0;
    align-self: stretch;
    box-sizing: border-box;
    width: 35px;
    height: 35px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    border-left: 1px solid var(--border-divider, #2d2d2d);
    border-radius: 0;
    color: var(--text-secondary, #999);
    cursor: pointer;
    padding: 0;
  }
  .lw-drawer-close:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--text-primary, #fff);
  }
`;

export class Openp41geLogDetailDrawer extends LitElement {
  static override properties = { detail: { attribute: false }, _copied: { state: true } };

  /** The entry shown. */
  declare detail: LogDetail | null;
  /** The code block whose text was just copied (its check shows briefly). */
  declare private _copied: string | null;
  private _copiedTimer: number | null = null;

  constructor() {
    super();
    this.detail = null;
    this._copied = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const root = this.getRootNode() as Document | ShadowRoot;
    const parent = root instanceof Document ? root.head : root;
    if (parent && !parent.querySelector(`style[${STYLE_ATTR}]`)) {
      const style = document.createElement("style");
      style.setAttribute(STYLE_ATTR, "");
      style.textContent = STYLES;
      parent.appendChild(style);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._copiedTimer !== null) window.clearTimeout(this._copiedTimer);
    this._copiedTimer = null;
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("drawer-close"));
  }

  /** Copy a code block's decoded text to the clipboard and flash a check. */
  private async _copy(key: string, text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        legacyCopy(text);
      }
    } catch (err) {
      log.warn("log detail clipboard write failed; falling back:", err);
      legacyCopy(text);
    }
    this._copied = key;
    if (this._copiedTimer !== null) window.clearTimeout(this._copiedTimer);
    this._copiedTimer = window.setTimeout(() => {
      this._copied = null;
      this._copiedTimer = null;
    }, 1200);
  }

  /** A labelled code block (square frame) with a copy button hanging beneath
   *  its bottom-right corner. */
  private _codeblock(opts: {
    key: string;
    title: string;
    text: string;
    testid: string;
    buttonTestid: string;
    ariaLabel: string;
  }): TemplateResult {
    const copied = this._copied === opts.key;
    return html`
      <div class="lw-codeblock-wrap">
        <div class="lw-sec-title">${opts.title}</div>
        <div class="lw-codeblock" data-testid=${opts.testid}>
          <pre>${decodeEntities(opts.text)}</pre>
        </div>
        <button
          type="button"
          class="lw-copy-btn${copied ? " copied" : ""}"
          aria-label=${opts.ariaLabel}
          data-testid=${opts.buttonTestid}
          @click=${() => this._copy(opts.key, decodeEntities(opts.text))}
        >
          ${copied ? CHECK_ICON : COPY_ICON}
        </button>
      </div>
    `;
  }

  override render(): TemplateResult | typeof nothing {
    const d = this.detail;
    if (!d) return nothing;
    return html`
      <div class="lw-drawer-mask" @click=${() => this._close()}></div>
      <aside class="lw-drawer" data-testid="lw-detail-drawer">
        <div class="lw-drawer-head">
          <span class="lw-drawer-head-title" data-testid="lw-drawer-title">Log details</span>
          <button
            type="button"
            class="lw-drawer-close"
            aria-label="Close details"
            data-testid="lw-drawer-close"
            @click=${() => this._close()}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        <div class="lw-detail-body">
          <div class="lw-detail-meta">
            <div><span class="lw-sec-title">Source </span>${decodeEntities(d.source)}</div>
            <div><span class="lw-sec-title">System </span>${decodeEntities(d.system)}</div>
            <div><span class="lw-sec-title">Process </span>${decodeEntities(d.process)}</div>
            <div><span class="lw-sec-title">Level </span>${decodeEntities(d.levelLabel)}</div>
            <div>
              <span class="lw-sec-title">Time </span>${new Date(d.timestamp).toLocaleString()}
            </div>
          </div>
          ${this._codeblock({
            key: "message",
            title: "Message",
            text: d.message,
            testid: "lw-codeblock-message",
            buttonTestid: "lw-copy-message",
            ariaLabel: "Copy message",
          })}
          ${
            d.stack
              ? this._codeblock({
                  key: "stack",
                  title: "Stack",
                  text: d.stack,
                  testid: "lw-codeblock-stack",
                  buttonTestid: "lw-copy-stack",
                  ariaLabel: "Copy stack",
                })
              : nothing
          }
        </div>
        <div class="lw-drawer-foot" data-testid="lw-drawer-foot"></div>
      </aside>
    `;
  }
}

/** Clipboard fallback for environments without the async Clipboard API. */
function legacyCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    log.debug("log detail legacy copy failed:", err);
  }
  ta.remove();
}

if (!customElements.get("openp41ge-log-detail-drawer")) {
  customElements.define("openp41ge-log-detail-drawer", Openp41geLogDetailDrawer);
}
