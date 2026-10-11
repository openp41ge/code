/**
 * <openp41ge-terminal> — Terminal emulator web component (Lit).
 *
 * Wraps xterm.js with the FitAddon to provide a self-contained terminal
 * emulator that can be mounted inside a tab.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { Terminal, type ITerminalOptions, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ShellConnector } from "../shell/shell-connector";
import { IpcShellConnector } from "../shell/ipc-shell-connector";
import { BUILT_IN_THEMES } from "../themes";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge-terminal", "openp41ge-terminal");

export type TerminalDataHandler = (data: string) => void;

export interface Openp41geTerminalOptions {
  terminal?: Partial<ITerminalOptions>;
  showHeader?: boolean;
  headerLabel?: string;
  autoRestart?: boolean;
  clearOnRestart?: boolean;
}

class Openp41geTerminal extends LitElement {
  private _terminal: Terminal | null = null;
  private _fitAddon: FitAddon | null = null;
  private _termContainer: HTMLElement | null = null;
  private _dataHandler: TerminalDataHandler | null = null;
  private _unsubData: (() => void) | null = null;
  private _unsubResize: (() => void) | null = null;
  private _unsubTitle: (() => void) | null = null;
  private _options: Openp41geTerminalOptions = {};

  private _connector: ShellConnector | null = null;
  private _connectorUnsubOutput: (() => void) | null = null;
  private _connectorUnsubExit: (() => void) | null = null;
  private _shellExited = false;
  private _autoRestarting = false;

  @property({ type: String, attribute: "pane-id" }) paneId = "";
  private _headerLabel = "Terminal";
  @state() private _exitMessage = "";
  @state() private _showExitBanner = false;

  get terminal(): Terminal | null {
    return this._terminal;
  }
  get cols(): number {
    return this._terminal?.cols ?? 0;
  }
  get rows(): number {
    return this._terminal?.rows ?? 0;
  }
  get connector(): ShellConnector | null {
    return this._connector;
  }

  setOptions(options: Openp41geTerminalOptions): void {
    this._options = options;
  }

  setConnector(connector: ShellConnector): void {
    this._connector = connector;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Force synchronous render for test compatibility
    this.performUpdate();
    this._initTerminal();
    this._connectShell();
    requestAnimationFrame(() => this._fit());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._disconnectShell();
    this._destroyTerminal();
  }

  firstUpdated(): void {
    this._termContainer = this.renderRoot.querySelector(".st-term-container");
    if (this._termContainer && this._terminal) {
      this._terminal.open(this._termContainer);
      requestAnimationFrame(() => this._fit());
    }
  }

  onData(handler: TerminalDataHandler): void {
    this._dataHandler = handler;
  }
  write(data: string | Uint8Array): void {
    this._terminal?.write(data);
  }
  writeln(data: string | Uint8Array): void {
    this._terminal?.writeln(data);
  }
  clear(): void {
    this._terminal?.clear();
  }
  focus(): void {
    this._terminal?.focus();
  }
  blur(): void {
    this._terminal?.blur();
  }
  resize(cols: number, rows: number): void {
    this._terminal?.resize(cols, rows);
  }
  fit(): void {
    this._fit();
  }

  setTheme(theme: Partial<ITheme> | string): void {
    if (!this._terminal) return;
    let themeObj: Partial<ITheme>;
    if (typeof theme === "string") {
      const bt = BUILT_IN_THEMES[theme];
      if (!bt) {
        log.warn(`unknown theme "${theme}"`);
        return;
      }
      themeObj = bt;
    } else {
      themeObj = theme;
    }
    this._terminal.options.theme = { ...themeObj };
  }

  render(): TemplateResult {
    const showHeader = this._options.showHeader !== false;
    return html`
      <style>
        :host {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #1e1e1e;
          overflow: hidden;
          font-family: Menlo, Monaco, "Courier New", monospace;
        }
        .st-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 0 0 8px;
          height: 28px;
          background: #222;
          border-bottom: 1px solid #2a2a2a;
          flex-shrink: 0;
          user-select: none;
        }
        .st-header-label {
          font-size: 11px;
          color: #888;
          letter-spacing: 0.04em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .st-close-btn {
          flex-shrink: 0;
          min-width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          background: transparent;
          color: #666;
          cursor: pointer;
          border: none;
          font-size: 16px;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          transition:
            background 0.1s,
            color 0.1s;
          user-select: none;
        }
        .st-close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
        }
        .st-term-container {
          flex: 1;
          min-height: 0;
          position: relative;
        }
        .st-term-container .xterm {
          padding: 4px;
          height: 100%;
        }
        .st-term-container .xterm-viewport {
          scrollbar-width: thin;
          scrollbar-color: #424242 transparent;
        }
        .st-exit-banner {
          display: ${this._showExitBanner ? "flex" : "none"};
          align-items: center;
          justify-content: space-between;
          padding: 4px 12px;
          background: #2d2d2d;
          border-top: 1px solid #3a3a3a;
          font-size: 11px;
          color: #888;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          flex-shrink: 0;
        }
        .st-restart-btn {
          background: transparent;
          border: 1px solid #555;
          border-radius: 3px;
          color: #aaa;
          cursor: pointer;
          font-size: 11px;
          padding: 2px 8px;
          font-family: inherit;
          transition:
            background 0.1s,
            color 0.1s;
        }
        .st-restart-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
          border-color: #888;
        }
      </style>
      ${
        showHeader
          ? html`
              <div class="st-header">
                <span class="st-header-label"
                  >${this._options.headerLabel ?? this._headerLabel}</span
                >
                <div
                  class="st-close-btn"
                  title="Close"
                  @click=${() => this.dispatchEvent(new CustomEvent("terminal-close", { bubbles: true, composed: true }))}
                >
                  &times;
                </div>
              </div>
            `
          : ""
      }
      <div class="st-term-container"></div>
      <div class="st-exit-banner" id="exit-banner">
        <span class="st-exit-message" id="exit-message">${this._exitMessage}</span>
        <button class="st-restart-btn" @click=${() => this._restartShell()}>Restart</button>
      </div>
    `;
  }

  private _initTerminal(): void {
    // Dynamically find the container (may have been created by render via firstUpdated)
    this._termContainer = this.renderRoot.querySelector(".st-term-container");
    if (!this._termContainer) return;

    const defaultOptions: ITerminalOptions = {
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#4ec9b0",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#9cdcfe",
        white: "#d4d4d4",
        brightBlack: "#808080",
        brightRed: "#f44747",
        brightGreen: "#4ec9b0",
        brightYellow: "#dcdcaa",
        brightBlue: "#569cd6",
        brightMagenta: "#c586c0",
        brightCyan: "#9cdcfe",
        brightWhite: "#ffffff",
      },
      allowTransparency: false,
      scrollback: 5000,
    };

    this._terminal = new Terminal({ ...defaultOptions, ...(this._options.terminal ?? {}) });
    this._fitAddon = new FitAddon();
    this._terminal.loadAddon(this._fitAddon);

    this._unsubData = this._terminal.onData((data: string) => {
      if (this._connector && !this._shellExited) this._connector.write(data);
      this._dataHandler?.(data);
    }) as unknown as () => void;

    this._unsubResize = this._terminal.onResize(({ cols, rows }) => {
      this._connector?.resize(cols, rows);
      this.dispatchEvent(
        new CustomEvent("terminal-resize", {
          bubbles: true,
          composed: true,
          detail: { cols, rows },
        }),
      );
    }) as unknown as () => void;

    this._unsubTitle = this._terminal.onTitleChange((title: string) => {
      this.dispatchEvent(
        new CustomEvent("terminal-title", { bubbles: true, composed: true, detail: { title } }),
      );
      this._headerLabel = title;
    }) as unknown as () => void;
  }

  private _destroyTerminal(): void {
    this._unsubData?.();
    this._unsubData = null;
    this._unsubResize?.();
    this._unsubResize = null;
    this._unsubTitle?.();
    this._unsubTitle = null;
    this._fitAddon?.dispose();
    this._fitAddon = null;
    this._terminal?.dispose();
    this._terminal = null;
    this._dataHandler = null;
  }

  private _connectShell(): void {
    if (!this._connector && IpcShellConnector.isAvailable()) {
      const paneId = this.getAttribute("pane-id") || crypto.randomUUID();
      this._connector = new IpcShellConnector(paneId);
    }
    if (!this._connector) return;

    this._shellExited = false;
    this._autoRestarting = false;

    this._connectorUnsubOutput = this._connector.onOutput((data: string) =>
      this._terminal?.write(data),
    );

    this._connectorUnsubExit = this._connector.onExit((code: number | null) => {
      this._shellExited = true;
      this.dispatchEvent(
        new CustomEvent("terminal-exit", { bubbles: true, composed: true, detail: { code } }),
      );
      if (this._options.autoRestart) {
        this._autoRestarting = true;
        this._restartShell();
      } else this._showExitMessage(code);
    });

    this._connector.spawn();
  }

  private _disconnectShell(): void {
    this._connector?.kill();
    this._connectorUnsubOutput?.();
    this._connectorUnsubOutput = null;
    this._connectorUnsubExit?.();
    this._connectorUnsubExit = null;
  }

  private _restartShell(): void {
    this._showExitBanner = false;
    this._exitMessage = "";
    this._shellExited = false;
    if (this._options.clearOnRestart) this._terminal?.clear();
    this._connector?.spawn();
    this._autoRestarting = false;
  }

  /** @internal exposed for testing */
  private _showExitMessage(code: number | null): void {
    this._exitMessage = code !== null ? `Process exited with code ${code}.` : "Process exited.";
    this._showExitBanner = true;
  }

  private _fit(): void {
    try {
      this._fitAddon?.fit();
    } catch {
      /* container not laid out yet */
    }
  }
}

export function registerOpenp41geTerminal(): void {
  if (!customElements.get("openp41ge-terminal")) {
    customElements.define("openp41ge-terminal", Openp41geTerminal);
  }
}

registerOpenp41geTerminal();

export { Openp41geTerminal };
