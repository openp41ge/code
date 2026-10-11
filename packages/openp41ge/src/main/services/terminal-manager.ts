import { spawn, type ChildProcess } from "child_process";
import { createLogger } from "openp41ge-core-logger";
import type {
  ITerminalManager,
  TerminalOutput,
  TerminalExitInfo,
} from "../interfaces/terminal-manager.js";

const log = createLogger("openp41ge", "terminal-manager");

/**
 * Manages shell processes for terminal panes.
 *
 * Each pane gets one shell process. Output is fanned out to all listeners.
 */
export class TerminalManager implements ITerminalManager {
  private readonly _terminals = new Map<string, ChildProcess>();
  private readonly _dataListeners = new Set<(output: TerminalOutput) => void>();
  private readonly _exitListeners = new Set<(info: TerminalExitInfo) => void>();

  spawn(paneId: string): void {
    if (this._terminals.has(paneId)) return;

    const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
    const proc = spawn(shell, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    });
    this._terminals.set(paneId, proc);

    proc.stdout?.on("data", (data: Buffer) => {
      const output: TerminalOutput = { paneId, data: data.toString() };
      for (const fn of this._dataListeners) fn(output);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const output: TerminalOutput = { paneId, data: data.toString() };
      for (const fn of this._dataListeners) fn(output);
    });

    proc.on("exit", (code: number | null) => {
      this._terminals.delete(paneId);
      const info: TerminalExitInfo = { paneId, code };
      for (const fn of this._exitListeners) fn(info);
    });

    proc.on("error", () => {
      this._terminals.delete(paneId);
    });
  }

  write(paneId: string, data: string): void {
    const proc = this._terminals.get(paneId);
    if (proc?.stdin?.writable) {
      proc.stdin.write(data);
    }
  }

  resize(paneId: string, _cols: number, _rows: number): void {
    const proc = this._terminals.get(paneId);
    if (proc?.stdin?.writable) {
      try {
        proc.kill("SIGWINCH");
      } catch (err) {
        // Windows: no SIGWINCH, ignore
        log.debug("SIGWINCH unsupported (Windows); ignoring:", err);
      }
    }
  }

  kill(paneId: string): void {
    const proc = this._terminals.get(paneId);
    if (proc) {
      proc.kill();
      this._terminals.delete(paneId);
      this._notifyExit(paneId, -1);
    }
  }

  killByPaneId(paneId: string): void {
    this.kill(paneId);
  }

  onData(callback: (output: TerminalOutput) => void): () => void {
    this._dataListeners.add(callback);
    return () => this._dataListeners.delete(callback);
  }

  onExit(callback: (info: TerminalExitInfo) => void): () => void {
    this._exitListeners.add(callback);
    return () => this._exitListeners.delete(callback);
  }

  dispose(): void {
    for (const [paneId, proc] of this._terminals) {
      proc.kill();
      this._notifyExit(paneId, -1);
    }
    this._terminals.clear();
    this._dataListeners.clear();
    this._exitListeners.clear();
  }

  private _notifyExit(paneId: string, code: number): void {
    const info: TerminalExitInfo = { paneId, code };
    for (const fn of this._exitListeners) fn(info);
  }
}
