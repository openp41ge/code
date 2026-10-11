/**
 * TerminalController — xterm.js + child process shell via IPC.
 *
 * Lifecycle:
 *   mount(container)
 *     → creates xterm.js Terminal, opens in container
 *     → spawns shell in main process (child_process)
 *     → pipes I/O via IPC
 *   unmount()
 *     → xterm.dispose() (detaches DOM)
 *     → shell continues running (survives tab switch)
 *   setVisible(true)
 *     → terminal.fit() to reflow to container size
 *     → flush any buffered output
 *   setVisible(false)
 *     → output buffered in memory, not pushed to xterm
 *
 * Shell is killed when the pane is removed from the workspace
 * (removeColumnPane → pane removed → controller unregistered).
 */

import { BaseController } from "../../controllers/base-controller";
import type { TabController } from "../../controllers/types";
import { paneHeaderButton } from "../../components/pane-header-button";
import { getWorkspace, emitEvent } from "../../app";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "terminal-controller");

import type { TabId } from "../../../layout/types";

export class TerminalController extends BaseController implements TabController {
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private bufferedOutput: string[] = [];
  private unsubData: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private _onDataHandler: ((data: string) => void) | null = null;

  mount(container: HTMLElement): void {
    this.container = container;

    // Set up container as flex column with the pane header and terminal area
    container.style.cssText =
      "width:100%;height:100%;display:flex;flex-direction:column;background:var(--bg-primary);overflow:hidden;";

    // Create header bar (same as PlaceholderController for consistency)
    const label = "Terminal";
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:0 0 0 8px;height:28px;background:var(--bg-tertiary);border-bottom:1px solid var(--border-divider);flex-shrink:0;user-select:none;cursor:grab;";
    header.innerHTML = `
      <span class="pane-label" style="font-size:11px;color:var(--text-secondary);letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
    `;
    container.appendChild(header);

    const closeBtn = paneHeaderButton({
      content: "\u00D7",
      className: "pane-close",
      title: "Close",
      onClick: () => {
        const ws = getWorkspace();
        if (!ws) return;
        for (const win of ws.windows) {
          for (const p of win.grid.placements) {
            if (p.tabIds.includes(this.tabId as TabId)) {
              emitEvent("tab-remove-column", { windowId: win.id, tabId: this.tabId });
              return;
            }
          }
        }
      },
    });
    header.appendChild(closeBtn);

    // Create terminal area container
    const termContainer = document.createElement("div");
    termContainer.style.cssText = "flex:1;min-height:0;position:relative;";
    container.appendChild(termContainer);

    // Create xterm.js terminal with dark theme
    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#161616",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#161616",
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
    });

    // Fit addon for auto-sizing
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open the terminal in the terminal container
    this.terminal.open(termContainer);

    // Initial fit — use requestAnimationFrame to ensure layout is complete
    requestAnimationFrame(() => {
      try {
        this.fitAddon?.fit();
      } catch (err) {
        // Container may not be fully laid out yet
        log.debug("terminal initial fit failed (container not ready):", err);
      }
    });

    // Wire up terminal input → main process
    this._onDataHandler = (data: string) => {
      window.openp41ge.terminal.write(this.tabId, data);
    };
    this.terminal.onData(this._onDataHandler);

    // Spawn shell in main process
    window.openp41ge.terminal.spawn(this.tabId);

    // Subscribe to shell output
    this.unsubData = window.openp41ge.terminal.onData(this.tabId, (data: string) => {
      if (this.terminal) {
        this.terminal.write(data);
      } else {
        this.bufferedOutput.push(data);
      }
    });

    this.unsubExit = window.openp41ge.terminal.onExit(this.tabId, (code: number | null) => {
      if (this.terminal) {
        this.terminal.write(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[22m\r\n`);
      }
    });
  }

  unmount(): void {
    // Unsubscribe from IPC
    this.unsubData?.();
    this.unsubData = null;
    this.unsubExit?.();
    this.unsubExit = null;

    // Dispose xterm.js (detaches from DOM)
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    this._onDataHandler = null;

    // Shell continues running — survives tab switch.
    // It will be killed when the pane is removed from the workspace
    // (removeColumnPane triggers terminal:kill via cleanup).

    this.container = null;
  }

  setVisible(visible: boolean): void {
    if (visible && this.terminal && this.fitAddon) {
      // Re-fit terminal to container after tab switch
      try {
        this.fitAddon.fit();
      } catch (err) {
        // Container may not be in DOM yet
        log.debug("terminal re-fit failed (container not in DOM):", err);
      }
      // Flush buffered output
      if (this.bufferedOutput.length > 0) {
        for (const chunk of this.bufferedOutput) {
          this.terminal.write(chunk);
        }
        this.bufferedOutput = [];
      }
      // Refresh screen (fix any rendering artifacts after re-mount)
      const rows = this.terminal.rows;
      if (rows > 0) {
        this.terminal.refresh(0, rows - 1);
      }
    }
  }
}
