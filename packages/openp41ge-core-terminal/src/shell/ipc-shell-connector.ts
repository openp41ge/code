/**
 * IpcShellConnector — bridges xterm.js to the Electron main process
 * via window.openp41ge.terminal (exposed through the preload contextBridge).
 *
 * Usage:
 *   const connector = new IpcShellConnector("pane-123");
 *   connector.spawn();
 *   connector.write("ls -la\r");
 *   connector.onOutput((data) => terminal.write(data));
 *   connector.onExit((code) => console.log("exited with", code));
 */

import type { ShellConnector } from "./shell-connector";

export class IpcShellConnector implements ShellConnector {
  private _paneId: string;
  private _unsubs: Array<() => void> = [];
  private _outputListeners: Set<(data: string) => void> = new Set();
  private _exitListeners: Set<(code: number | null) => void> = new Set();
  private _unsubOutput: (() => void) | null = null;
  private _unsubExit: (() => void) | null = null;

  constructor(paneId: string) {
    this._paneId = paneId;
  }

  /** The pane ID this connector is bound to. */
  get paneId(): string {
    return this._paneId;
  }

  private _subscribed = false;

  spawn(): void {
    const api = this._getTerminalAPI();
    if (!api) return;

    // Subscribe once — idempotent
    if (!this._subscribed) {
      this._subscribed = true;
      this._unsubOutput = api.onData(this._paneId, (data: string) => {
        for (const fn of this._outputListeners) fn(data);
      });

      this._unsubExit = api.onExit(this._paneId, (code: number | null) => {
        for (const fn of this._exitListeners) fn(code);
      });
    }

    api.spawn(this._paneId);
  }

  write(data: string): void {
    const api = this._getTerminalAPI();
    if (!api) return;
    api.write(this._paneId, data);
  }

  resize(cols: number, rows: number): void {
    const api = this._getTerminalAPI();
    if (!api) return;
    api.resize(this._paneId, cols, rows);
  }

  kill(): void {
    const api = this._getTerminalAPI();
    if (api) api.kill(this._paneId);

    this._unsubOutput?.();
    this._unsubOutput = null;
    this._unsubExit?.();
    this._unsubExit = null;

    this._outputListeners.clear();
    this._exitListeners.clear();
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];
    this._subscribed = false;
  }

  onOutput(callback: (data: string) => void): () => void {
    this._outputListeners.add(callback);
    const unsub = () => this._outputListeners.delete(callback);
    this._unsubs.push(unsub);
    return unsub;
  }

  onExit(callback: (code: number | null) => void): () => void {
    this._exitListeners.add(callback);
    const unsub = () => this._exitListeners.delete(callback);
    this._unsubs.push(unsub);
    return unsub;
  }

  /**
   * Detect whether the IPC bridge is available.
   */
  static isAvailable(): boolean {
    return typeof window !== "undefined" && typeof window.openp41ge?.terminal !== "undefined";
  }

  private _getTerminalAPI(): WindowOpenp41geTerminal | null {
    if (typeof window === "undefined") return null;
    return window.openp41ge?.terminal ?? null;
  }
}

/** The shape of window.openp41ge.terminal exposed by the preload. */
interface WindowOpenp41geTerminal {
  spawn(paneId: string): void;
  write(paneId: string, data: string): void;
  resize(paneId: string, cols: number, rows: number): void;
  kill(paneId: string): void;
  onData(paneId: string, callback: (data: string) => void): () => void;
  onExit(paneId: string, callback: (code: number | null) => void): () => void;
}
